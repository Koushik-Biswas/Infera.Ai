/**
 * Ingestion: one normalised inbound message → stored, deduplicated, queued.
 *
 * Every channel (webhooks, REST API, chat imports, test messages) ends here, so
 * the guarantees hold everywhere:
 *  - idempotent: (channelId, externalId) is unique → provider retries and
 *    re-imports are reported as `duplicate` and never processed twice (rule 18);
 *  - atomic: contact, conversation, message, files, event, job and the
 *    `message.received` domain event commit together or not at all;
 *  - traceable: the message keeps its provider id + trimmed raw payload, and
 *    the event row links processing results back to it (rule 10);
 *  - tenant-safe: the channel must belong to `input.workspaceId` (rule 6).
 *
 * Nothing here interprets the text — classification/extraction is the
 * pipeline's job (process_message).
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { sourceOf, type Actor, type AttachmentDTO, type ChannelType, type MessageKind } from "@/lib/shared/types";
import type { Database } from "../db";
import { channels, contacts, conversations, events, files, messages, type ChannelRow, type ContactRow, type ConversationRow } from "../db/schema";
import { emitDomainEvent } from "../events/bus";
import { enqueue } from "../jobs/queue";
import { newId } from "../ids";
import { maxMediaBytes } from "../env";
import { log } from "../http";
import { normalizePhone } from "../records/coerce";
import { bumpUsage } from "../usage";
import { sealBytes, sealText, searchTokens } from "../data/sealed";
import type { IngestResult, InboundMessage } from "./types";
import { cleanBody, cleanMime, cleanStr, kindForMime, normalizeExternalId, sanitizeJson, sha256, withNotes } from "./util";

export const MAX_TEXT_CHARS = 20_000;
export const MAX_ATTACHMENTS = 20;
const FUTURE_SKEW_MS = 5 * 60_000;
const PREVIEW_CHARS = 140;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export class ChannelNotFoundError extends Error {
  constructor() {
    super("Channel not found in this workspace.");
  }
}

function normalizeEmail(v: unknown): string | null {
  const s = cleanStr(v, 320).toLowerCase();
  return s && s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}

function inferKind(input: InboundMessage): MessageKind {
  if (input.kind) return input.kind;
  const first = input.attachments?.[0];
  return first ? kindForMime(first.mime) : "text";
}

function previewOf(text: string, kind: MessageKind, attachments: AttachmentDTO[]): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t) return t.slice(0, PREVIEW_CHARS);
  if (attachments[0]) return `[${kind}] ${attachments[0].name}`.slice(0, PREVIEW_CHARS);
  return `[${kind}]`;
}

/** Serialises concurrent first-contact creation for identities without a unique index (handle-only senders). */
async function lockKey(tx: Database, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

async function contactBy(tx: Database, workspaceId: string, where: SQL): Promise<ContactRow | null> {
  const rows = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), where))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Finds the sender's contact by phone, then email, then channel handle, creating
 * it if needed. Missing identifiers on an existing contact are filled in (never
 * overwritten — rule 4). Concurrent webhooks converge on one contact through the
 * unique (workspace, phone) / (workspace, email) indexes.
 */
async function upsertContact(tx: Database, workspaceId: string, channelType: ChannelType, sender: InboundMessage["sender"]): Promise<ContactRow | null> {
  const phone = sender.phone ? normalizePhone(cleanStr(sender.phone, 64).replace(/^(whatsapp|tel|sms):/i, "")) : null;
  const email = normalizeEmail(sender.email);
  const handle = cleanStr(sender.externalId ?? "", 200) || null;
  const name = cleanStr(sender.name ?? "", 200);
  if (!phone && !email && !handle) return null;

  const byPhone = () => (phone ? contactBy(tx, workspaceId, eq(contacts.phone, phone)) : Promise.resolve(null));
  const byEmail = () => (email ? contactBy(tx, workspaceId, eq(contacts.email, email)) : Promise.resolve(null));
  // `@>` lets a GIN index on handles serve this lookup.
  const byHandle = () => (handle ? contactBy(tx, workspaceId, sql`${contacts.handles} @> ${JSON.stringify({ [channelType]: handle })}::jsonb`) : Promise.resolve(null));

  if (!phone && !email) await lockKey(tx, `contact:${workspaceId}:${channelType}:${handle}`);
  let found = (await byPhone()) ?? (await byEmail()) ?? (await byHandle());

  if (!found) {
    const inserted = await tx
      .insert(contacts)
      .values({
        id: newId("ctc"),
        workspaceId,
        displayName: name || phone || email || handle || "",
        phone,
        email,
        handles: handle ? { [channelType]: handle } : {},
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return inserted[0];
    // Lost a race on the phone/email unique index: the other transaction's row wins.
    found = (await byPhone()) ?? (await byEmail());
    if (!found) throw new Error("Contact upsert failed");
  }

  const patch: Partial<Pick<ContactRow, "displayName" | "handles" | "phone" | "email">> = {};
  if (!found.displayName && name) patch.displayName = name;
  if (handle && !found.handles?.[channelType]) patch.handles = { ...(found.handles ?? {}), [channelType]: handle };
  const identity: Partial<Pick<ContactRow, "phone" | "email">> = {};
  if (phone && !found.phone) identity.phone = phone;
  if (email && !found.email) identity.email = email;
  if (!Object.keys(patch).length && !Object.keys(identity).length) return found;

  const target = and(eq(contacts.id, found.id), eq(contacts.workspaceId, workspaceId));
  const now = new Date();
  if (Object.keys(identity).length) {
    try {
      // Savepoint: if that phone/email was just claimed by another contact, keep the rest of the merge.
      await tx.transaction(async (sp) => {
        await sp
          .update(contacts)
          .set({ ...patch, ...identity, updatedAt: now })
          .where(target);
      });
      return { ...found, ...patch, ...identity, updatedAt: now };
    } catch {
      if (!Object.keys(patch).length) return found;
    }
  }
  await tx
    .update(contacts)
    .set({ ...patch, updatedAt: now })
    .where(target);
  return { ...found, ...patch, updatedAt: now };
}

async function upsertConversation(
  tx: Database,
  input: { workspaceId: string; channelId: string; externalId: string; title: string; isGroup: boolean; contactId: string | null; agentsEnabled: boolean },
): Promise<ConversationRow> {
  const inserted = await tx
    .insert(conversations)
    .values({
      id: newId("cnv"),
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      externalId: input.externalId,
      title: input.title || input.externalId,
      isGroup: input.isGroup,
      contactId: input.isGroup ? null : input.contactId,
      agentsEnabled: input.agentsEnabled,
    })
    .onConflictDoNothing({ target: [conversations.channelId, conversations.externalId] })
    .returning();
  if (inserted[0]) return inserted[0];
  const rows = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.channelId, input.channelId), eq(conversations.externalId, input.externalId), eq(conversations.workspaceId, input.workspaceId)))
    .limit(1);
  if (!rows[0]) throw new Error("Conversation upsert failed");
  return rows[0];
}

async function existingMessage(db: Database, workspaceId: string, channelId: string, externalId: string): Promise<IngestResult | null> {
  const rows = await db
    .select({ id: messages.id, eventId: messages.eventId, conversationId: messages.conversationId, contactId: messages.contactId })
    .from(messages)
    .where(and(eq(messages.channelId, channelId), eq(messages.externalId, externalId), eq(messages.workspaceId, workspaceId)))
    .limit(1);
  const m = rows[0];
  return m ? { messageId: m.id, eventId: m.eventId, conversationId: m.conversationId, duplicate: true, contactId: m.contactId } : null;
}

/**
 * Persists one message idempotently and queues it for processing.
 * Throws ChannelNotFoundError if the channel isn't in `input.workspaceId`.
 */
export async function ingestInboundMessage(db: Database, input: InboundMessage): Promise<IngestResult> {
  const chRows = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, input.channelId), eq(channels.workspaceId, input.workspaceId)))
    .limit(1);
  const channel: ChannelRow | undefined = chRows[0];
  if (!channel) throw new ChannelNotFoundError();

  const externalId = normalizeExternalId(input.externalId);
  // Fast path for provider retries: no contact/conversation writes at all.
  const known = await existingMessage(db, input.workspaceId, channel.id, externalId);
  if (known) return known;

  const now = new Date();
  const notes: Record<string, unknown> = {};
  let sentAt = input.sentAt instanceof Date && !Number.isNaN(input.sentAt.getTime()) ? input.sentAt : now;
  if (sentAt !== input.sentAt) notes.sentAtInvalid = true;
  if (sentAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    // Never trust a future timestamp (clock skew or forged): clamp, keep the original for traceability.
    notes.sentAtClamped = sentAt.toISOString();
    sentAt = now;
  }
  const direction: "inbound" | "outbound" = input.direction ?? (input.sender.isMe ? "outbound" : "inbound");
  const isGroup = Boolean(input.conversation.isGroup);
  const text = cleanBody(input.text, MAX_TEXT_CHARS);
  if (typeof input.text === "string" && input.text.length > MAX_TEXT_CHARS) notes.textTruncated = input.text.length;
  const kind = inferKind(input);
  const convExternalId = normalizeExternalId(input.conversation.externalId);
  const senderName = cleanStr(input.sender.name ?? "", 200);
  const senderHandle = cleanStr(input.sender.externalId ?? input.sender.phone ?? input.sender.email ?? "", 200) || null;
  if (input.replyToExternalId) notes.replyTo = cleanStr(input.replyToExternalId, 255);

  // Attachments: bytes ≤ maxMediaBytes() are stored in `files`; provider media ids are kept for the lazy download.
  const cap = maxMediaBytes();
  const fileRows: { id: string; name: string; mime: string; size: number; sha256: string; data: Buffer }[] = [];
  const attachments: AttachmentDTO[] = [];
  const media: { i: number; providerId: string }[] = [];
  const oversized: number[] = [];
  for (const [i, a] of (input.attachments ?? []).slice(0, MAX_ATTACHMENTS).entries()) {
    const name = cleanStr(a.name, 255) || `attachment-${i + 1}`;
    const mime = cleanMime(a.mime);
    let fileId: string | null = null;
    let size = typeof a.size === "number" && Number.isFinite(a.size) && a.size >= 0 ? Math.floor(a.size) : null;
    if (a.data && a.data.length) {
      size = a.data.length;
      if (a.data.length <= cap) {
        fileId = newId("fil");
        fileRows.push({ id: fileId, name, mime, size: a.data.length, sha256: sha256(a.data), data: a.data });
      } else oversized.push(i);
    }
    if (!fileId && a.providerId) media.push({ i, providerId: cleanStr(a.providerId, 500) });
    const url = a.url && /^https?:\/\//i.test(a.url) ? cleanStr(a.url, 2000) : null;
    attachments.push({ name, mime, size, fileId, url });
  }
  if ((input.attachments?.length ?? 0) > MAX_ATTACHMENTS) notes.attachmentsDropped = (input.attachments?.length ?? 0) - MAX_ATTACHMENTS;
  if (media.length) notes.media = media;
  if (oversized.length) notes.oversizedAttachments = oversized;

  const skipRequested = Boolean(input.skipProcessing);
  const source = input.source ?? sourceOf[channel.type];
  const actor: Actor = input.actor ?? { type: "system", id: channel.id, label: `${channel.type} channel` };
  const preview = previewOf(text, kind, attachments);
  const raw = sanitizeJson(withNotes(input.raw, notes));

  const result = await db.transaction(async (tx): Promise<IngestResult> => {
    const contact = direction === "inbound" && !input.sender.isMe ? await upsertContact(tx, input.workspaceId, channel.type, input.sender) : null;
    const title = cleanStr(input.conversation.title ?? (isGroup || direction === "outbound" ? "" : senderName), 200);
    const conv = await upsertConversation(tx, { workspaceId: input.workspaceId, channelId: channel.id, externalId: convExternalId, title, isGroup, contactId: contact?.id ?? null, agentsEnabled: channel.config?.chatSelection !== "selected" });
    // "Agents on selected chats": messages of chats without agents are stored and searchable, never extracted.
    const skip = skipRequested || !conv.agentsEnabled;
    // 1:1 chats: the counterpart is the conversation's contact (outbound messages are about them too).
    const contactId = contact?.id ?? (conv.isGroup ? null : conv.contactId);

    const messageId = newId("msg");
    const eventId = newId("evt");
    const inserted = await tx
      .insert(messages)
      .values({
        id: messageId,
        workspaceId: input.workspaceId,
        channelId: channel.id,
        conversationId: conv.id,
        contactId,
        externalId,
        direction,
        senderName: senderName || (direction === "outbound" ? "You" : senderHandle ?? ""),
        senderHandle,
        kind,
        // Sealed at rest; searchable through the blind index (lib/server/data/sealed.ts).
        text: sealText(text),
        searchTokens: searchTokens([text, ...attachments.map((a) => a.name)].join(" ")),
        attachments,
        sentAt,
        receivedAt: now,
        status: skip ? "received" : "queued",
        eventId,
        raw,
      })
      .onConflictDoNothing({ target: [messages.channelId, messages.externalId] })
      .returning({ id: messages.id });
    if (!inserted[0]) {
      // A concurrent delivery of the same message won the race.
      const dup = await existingMessage(tx, input.workspaceId, channel.id, externalId);
      if (!dup) throw new Error("Duplicate message vanished");
      return dup;
    }

    if (fileRows.length) {
      await tx.insert(files).values(fileRows.map((f) => ({ ...f, data: sealBytes(f.data), workspaceId: input.workspaceId, messageId })));
    }

    // Explicit millisecond timestamp: keyset cursors (ISO, ms precision) then compare exactly.
    await tx.insert(events).values({ id: eventId, workspaceId: input.workspaceId, messageId, source, status: skip ? "skipped" : "queued", createdAt: now });

    // Conversation: fill a placeholder title / missing contact, keep preview of the newest message.
    const convPatch: Partial<ConversationRow> = {};
    if (title && (conv.title === conv.externalId || !conv.title)) convPatch.title = title;
    else if (isGroup && input.conversation.title && title && conv.title !== title) convPatch.title = title; // group renamed
    if (!conv.isGroup && !conv.contactId && contact) convPatch.contactId = contact.id;
    const sentIso = sentAt.toISOString();
    await tx
      .update(conversations)
      .set({
        ...convPatch,
        lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${sentIso}::timestamptz), ${sentIso}::timestamptz)`,
        lastMessagePreview: sql`case when ${conversations.lastMessageAt} is null or ${conversations.lastMessageAt} <= ${sentIso}::timestamptz then ${sealText(preview)} else ${conversations.lastMessagePreview} end`,
        ...(direction === "inbound" && !input.historical ? { unreadCount: sql`${conversations.unreadCount} + 1` } : {}),
        updatedAt: now,
      })
      .where(eq(conversations.id, conv.id));

    if (!skip) {
      await enqueue(tx, {
        type: "process_message",
        payload: { eventId },
        workspaceId: input.workspaceId,
        priority: input.priority ?? 50,
        runAt: input.processAt,
        dedupeKey: `pm:${eventId}`,
      });
    }
    if (!input.historical) {
      await emitDomainEvent(tx, { type: "message.received", workspaceId: input.workspaceId, actor, data: { messageId, eventId } });
    }
    return { messageId, eventId, conversationId: conv.id, duplicate: false, contactId };
  });

  if (!result.duplicate && !input.historical) {
    // (Historical imports record these totals once per import.)
    // Outside the transaction: these rows are hot (one per channel / per workspace) and must not serialise ingestion.
    await db
      .update(channels)
      .set({ lastEventAt: now })
      .where(and(eq(channels.id, channel.id), sql`(${channels.lastEventAt} is null or ${channels.lastEventAt} < now() - interval '30 seconds')`))
      .catch((e: unknown) => log("warn", "channel_touch_failed", { channelId: channel.id, message: e instanceof Error ? e.message : String(e) }));
    await bumpUsage(input.workspaceId, { messages_ingested: 1 }, db).catch(() => {});
  }
  return result;
}
