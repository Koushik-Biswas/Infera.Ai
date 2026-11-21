/**
 * Outbound replies through the conversation's channel provider.
 *
 * `sendOutbound` is used by `POST /api/v1/conversations/:id/reply` (a member
 * typed it) and by the `send_reply` job (automation `reply` action, which the
 * automations module only enqueues when the workspace allows external actions —
 * rule 8). Every attempt is audited (`message.send`). A message is stored only
 * after the provider confirmed it (rule 9: never claim success without
 * confirmation); it's stored as `processed` and is not re-processed.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Actor } from "@/lib/shared/types";
import type { Database } from "../db";
import { channels, conversations, messages, type ChannelRow, type ConversationRow } from "../db/schema";
import { ApiError } from "../api/handler";
import { writeAudit } from "../audit";
import { log } from "../http";
import { newId } from "../ids";
import { bumpUsage } from "../usage";
import { sendSlackText, sendTelegramText, sendTwilioText, sendWhatsAppText, type SendResult } from "./providers";
import { decryptSecrets } from "./registry";
import { cleanBody, obj, str } from "./util";
import { getLiveSender } from "../sync/live";
import { sendMetaText } from "./meta-graph";
import { unipileSend } from "./unipile";
import { unipileCreds } from "./linkedin";
import { sealText, searchTokens } from "../data/sealed";

export const UNSUPPORTED_REPLY = "Replies are not supported on this channel";
export const MAX_REPLY_CHARS = 4000;
const SMS_MAX_CHARS = 1600;

export type SendOutboundInput = { workspaceId: string; conversationId: string; text: string; actor: Actor };
export type SendOutboundResult = {
  messageId: string;
  delivered: boolean;
  error?: string;
  /** True when the failure is temporary (network, rate limit, provider 5xx) and a retry may succeed. */
  retryable?: boolean;
  /** Machine-readable failure reason. */
  code?: "unsupported" | "paused" | "not_configured" | "invalid" | "provider_error";
};

export const supportsReplies = (type: ChannelRow["type"]) => type === "whatsapp_cloud" || type === "whatsapp_web" || type === "telegram" || type === "slack" || type === "sms_twilio" || type === "messenger" || type === "instagram" || type === "telegram_user" || type === "email_imap" || type === "linkedin";

/** Twilio needs a sender: Messaging Service, configured number, or the number the customer last wrote to. */
async function twilioSender(db: Database, channel: ChannelRow, conv: ConversationRow): Promise<{ from: string | null; messagingServiceSid: string | null }> {
  const cfg = obj(channel.config);
  const messagingServiceSid = str(cfg.messagingServiceSid);
  if (messagingServiceSid) return { from: null, messagingServiceSid };
  const viaWhatsApp = conv.externalId.toLowerCase().startsWith("whatsapp:");
  const configured = str(cfg.phoneNumber);
  if (configured) return { from: viaWhatsApp && !configured.startsWith("whatsapp:") ? `whatsapp:${configured}` : configured, messagingServiceSid: null };
  const last = await db
    .select({ raw: messages.raw })
    .from(messages)
    .where(and(eq(messages.workspaceId, conv.workspaceId), eq(messages.conversationId, conv.id), eq(messages.direction, "inbound")))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  return { from: str(obj(last[0]?.raw).to), messagingServiceSid: null };
}

async function deliver(db: Database, channel: ChannelRow, conv: ConversationRow, text: string): Promise<SendResult | { ok: false; error: string; retryable: false; code: SendOutboundResult["code"] }> {
  const secrets = decryptSecrets(channel);
  const missing = (what: string) => ({ ok: false as const, error: `Channel is missing ${what} needed to send replies.`, retryable: false as const, code: "not_configured" as const });
  switch (channel.type) {
    case "whatsapp_cloud":
      if (!secrets.accessToken || !channel.externalId) return missing("the access token");
      return sendWhatsAppText({ phoneNumberId: channel.externalId, accessToken: secrets.accessToken, to: conv.externalId, text });
    case "linkedin": {
      const creds = unipileCreds(channel);
      if (!creds) return missing("the Unipile API key");
      return unipileSend(creds, { chatId: conv.externalId, text, accountId: typeof channel.config?.accountId === "string" ? channel.config.accountId : null });
    }
    case "email_imap": {
      // LinkedIn notification threads can't be answered by email.
      if (conv.externalId.startsWith("linkedin:")) return { ok: false, error: "This came from a LinkedIn notification email — reply on LinkedIn (or connect LinkedIn via Unipile).", retryable: false, code: "unsupported" };
      const live = getLiveSender(channel.id);
      if (!live) return { ok: false, error: "The mailbox isn't connected right now. Reconnect it under Channels, then try again.", retryable: true, status: null };
      const to = conv.externalId.split("|")[0];
      if (!to.includes("@")) return { ok: false, error: "This conversation has no email address to reply to.", retryable: false, code: "invalid" };
      const [last] = await db
        .select({ raw: messages.raw })
        .from(messages)
        .where(and(eq(messages.workspaceId, conv.workspaceId), eq(messages.conversationId, conv.id), eq(messages.direction, "inbound")))
        .orderBy(desc(messages.sentAt))
        .limit(1);
      const r0 = obj(last?.raw);
      const inReplyTo = str(r0.messageId)?.replace(/^<|>$/g, "");
      const references = Array.isArray(r0.references) ? r0.references.filter((x): x is string => typeof x === "string") : [];
      const subject = conv.title ? (/^re:/i.test(conv.title) ? conv.title : `Re: ${conv.title}`) : "";
      try {
        const r = await live.sendText(to, text, { subject, ...(inReplyTo ? { inReplyTo: `<${inReplyTo}>`, references } : {}) });
        return { ok: true, providerMessageId: r.providerMessageId };
      } catch (e) {
        return { ok: false, error: `The mail server didn't accept the message: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, retryable: true, status: null };
      }
    }
    case "telegram_user": {
      const live = getLiveSender(channel.id);
      if (!live) return { ok: false, error: "Telegram isn't connected right now. Reconnect it under Channels, then try again.", retryable: true, status: null };
      try {
        const r = await live.sendText(conv.externalId, text);
        return { ok: true, providerMessageId: r.providerMessageId };
      } catch (e) {
        return { ok: false, error: `Telegram didn't accept the message: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, retryable: true, status: null };
      }
    }
    case "whatsapp_web": {
      // The linked-device socket lives in the process holding the channel's lease (lib/server/sync/manager.ts).
      const live = getLiveSender(channel.id);
      if (!live) return { ok: false, error: "WhatsApp isn't connected right now. Reconnect it under Channels, then try again.", retryable: true, status: null };
      try {
        const r = await live.sendText(conv.externalId, text);
        return { ok: true, providerMessageId: r.providerMessageId };
      } catch (e) {
        return { ok: false, error: `WhatsApp didn't accept the message: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, retryable: true, status: null };
      }
    }
    case "messenger":
    case "instagram":
      if (!secrets.pageAccessToken) return missing("the Page access token");
      return sendMetaText({ pageAccessToken: secrets.pageAccessToken, recipientId: conv.externalId, text, platform: channel.type });
    case "telegram":
      if (!secrets.botToken) return missing("the bot token");
      return sendTelegramText({ botToken: secrets.botToken, chatId: conv.externalId, text });
    case "slack":
      if (!secrets.botToken) return missing("a bot token");
      return sendSlackText({ botToken: secrets.botToken, channel: conv.externalId, text });
    case "sms_twilio": {
      if (!secrets.authToken || !secrets.accountSid) return missing("the Account SID and auth token");
      if (text.length > SMS_MAX_CHARS) return { ok: false, error: `SMS replies are limited to ${SMS_MAX_CHARS} characters.`, retryable: false, code: "invalid" };
      const sender = await twilioSender(db, channel, conv);
      if (!sender.from && !sender.messagingServiceSid) return missing("a sending phone number (set config.phoneNumber)");
      return sendTwilioText({ accountSid: secrets.accountSid, authToken: secrets.authToken, to: conv.externalId, ...sender, text });
    }
    default:
      return { ok: false, error: UNSUPPORTED_REPLY, retryable: false, code: "unsupported" };
  }
}

/**
 * Sends `text` to the conversation's counterpart. Throws ApiError 404 when the
 * conversation isn't in the workspace; every other failure is returned as
 * `{ delivered: false, error }`.
 */
export async function sendOutbound(db: Database, input: SendOutboundInput): Promise<SendOutboundResult> {
  const convRows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, input.conversationId), eq(conversations.workspaceId, input.workspaceId)))
    .limit(1);
  const conv = convRows[0];
  if (!conv) throw new ApiError(404, "not_found", "Conversation not found.");
  const chRows = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, conv.channelId), eq(channels.workspaceId, input.workspaceId)))
    .limit(1);
  const channel = chRows[0];
  if (!channel) throw new ApiError(404, "not_found", "Conversation not found.");

  const text = cleanBody(input.text, MAX_REPLY_CHARS + 1);
  const audit = (conn: Database, messageId: string | null, delivered: boolean, extra: Record<string, unknown>) =>
    writeAudit(conn, {
      workspaceId: input.workspaceId,
      actor: input.actor,
      action: "message.send",
      targetType: messageId ? "message" : "conversation",
      targetId: messageId ?? conv.id,
      // The text itself stays in the message row; the audit log only records the fact and its size.
      after: { delivered, length: text.length },
      meta: { conversationId: conv.id, channelId: channel.id, channelType: channel.type, ...extra },
    });

  let failure: SendOutboundResult | null = null;
  if (!supportsReplies(channel.type)) failure = { messageId: "", delivered: false, error: UNSUPPORTED_REPLY, retryable: false, code: "unsupported" };
  else if (!text) failure = { messageId: "", delivered: false, error: "Reply text is empty.", retryable: false, code: "invalid" };
  else if (text.length > MAX_REPLY_CHARS) failure = { messageId: "", delivered: false, error: `Replies are limited to ${MAX_REPLY_CHARS} characters.`, retryable: false, code: "invalid" };
  else if (channel.status === "paused") failure = { messageId: "", delivered: false, error: "This channel is paused.", retryable: false, code: "paused" };
  if (failure) {
    await audit(db, null, false, { error: failure.error, code: failure.code });
    return failure;
  }

  const sent = await deliver(db, channel, conv, text);
  if (!sent.ok) {
    const code = "code" in sent ? sent.code : "provider_error";
    await audit(db, null, false, { error: sent.error, code, retryable: sent.retryable, providerStatus: "status" in sent ? sent.status : null });
    // Credentials rejected → surface on the channel so admins see why replies fail.
    if ("status" in sent && (sent.status === 401 || sent.status === 403)) {
      await db
        .update(channels)
        .set({ lastError: sent.error.slice(0, 500), updatedAt: new Date() })
        .where(eq(channels.id, channel.id));
    }
    log("warn", "outbound_failed", { channelId: channel.id, channelType: channel.type, retryable: sent.retryable, code });
    return { messageId: "", delivered: false, error: sent.error, retryable: sent.retryable, code };
  }

  const now = new Date();
  const newMessageId = newId("msg");
  const externalId = sent.providerMessageId ?? `out_${newMessageId}`;
  const messageId = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(messages)
      .values({
        id: newMessageId,
        workspaceId: input.workspaceId,
        channelId: channel.id,
        conversationId: conv.id,
        contactId: conv.isGroup ? null : conv.contactId,
        externalId,
        direction: "outbound",
        senderName: (input.actor.label ?? "Infera").slice(0, 200),
        senderHandle: null,
        kind: "text",
        text: sealText(text),
        searchTokens: searchTokens(text),
        attachments: [],
        sentAt: now,
        receivedAt: now,
        status: "processed",
        raw: { provider: channel.type, outbound: true, actorType: input.actor.type },
      })
      .onConflictDoNothing({ target: [messages.channelId, messages.externalId] })
      .returning({ id: messages.id });
    // The provider id is already stored (e.g. an echo webhook arrived first): reuse that row.
    const id =
      inserted[0]?.id ??
      (
        await tx
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.channelId, channel.id), eq(messages.externalId, externalId)))
          .limit(1)
      )[0]?.id ??
      newMessageId;
    await tx
      .update(conversations)
      .set({
        lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${now.toISOString()}::timestamptz), ${now.toISOString()}::timestamptz)`,
        lastMessagePreview: sealText(text.replace(/\s+/g, " ").slice(0, 140)),
        // Replying implies the conversation was read.
        unreadCount: 0,
        updatedAt: now,
      })
      .where(eq(conversations.id, conv.id));
    if (channel.lastError) await tx.update(channels).set({ lastError: null, updatedAt: now }).where(eq(channels.id, channel.id));
    await audit(tx, id, true, { providerMessageId: sent.providerMessageId });
    return id;
  });
  await bumpUsage(input.workspaceId, { messages_sent: 1 }, db).catch(() => {});
  return { messageId, delivered: true };
}
