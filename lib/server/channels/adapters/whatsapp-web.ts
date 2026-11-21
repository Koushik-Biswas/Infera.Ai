/**
 * WhatsApp linked device (Baileys, EXPERIMENTAL) — pure message conversion.
 *
 * The connector (lib/server/sync/connectors/whatsapp-web.ts) resolves who a
 * message belongs to (LID → phone number, names, group subjects) and hands the
 * results to `parseLinkedDeviceMessage()`, which only looks at the message
 * content. No Baileys runtime import here, so it is cheap to load and test.
 *
 * Conversation id = the chat JID (`<digits>@s.whatsapp.net`, `<id>@g.us`, or
 * `<id>@lid` when WhatsApp hides the number) — replies are sent to it as-is.
 * Message id = WhatsApp's `key.id`, so the echo of a reply sent from Infera
 * is recognised as the same message.
 */
import type { MessageKind } from "@/lib/shared/types";
import type { InboundAttachment, ParsedInbound } from "../types";
import { cleanMime, extForMime } from "../util";

/** Protobuf objects are class instances, so `obj()` from util (plain objects only) doesn't fit. */
type Rec = Record<string, unknown>;
const o = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** number | Long | string → number (NaN-safe). */
export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) return Number.isFinite(Number(v)) ? Number(v) : null;
  if (v && typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") {
    const n = (v as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** `919876543210@s.whatsapp.net` / `919876543210:12@s.whatsapp.net` → `+919876543210`; anything else → null. */
export function phoneFromJid(jid: string | null | undefined): string | null {
  const m = jid?.match(/^(\d{6,15})(?::\d+)?@(s\.whatsapp\.net|c\.us|hosted)$/);
  return m ? `+${m[1]}` : null;
}

/** Chats Infera never imports: status updates, broadcast lists, channels (newsletters), calls/system. */
export function isIgnoredJid(jid: string | null | undefined): boolean {
  if (!jid) return true;
  return jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter") || jid.endsWith("@call") || jid === "0@s.whatsapp.net";
}

export const isGroupJid = (jid: string) => jid.endsWith("@g.us");

/** Unwraps ephemeral / view-once / document-with-caption / edit containers. */
export function unwrapContent(message: unknown): Rec | null {
  let m = o(message);
  for (let i = 0; i < 6; i++) {
    const inner =
      o(m.ephemeralMessage).message ??
      o(m.viewOnceMessage).message ??
      o(m.viewOnceMessageV2).message ??
      o(m.viewOnceMessageV2Extension).message ??
      o(m.documentWithCaptionMessage).message ??
      o(m.groupMentionedMessage).message ??
      o(m.botInvokeMessage).message ??
      o(m.lottieStickerMessage).message;
    if (!inner) break;
    m = o(inner);
  }
  return Object.keys(m).length ? m : null;
}

/** "BEGIN:VCARD … FN:Asha … TEL;waid=91…:+91 98…" → "Asha, +91 98…". */
function vcardSummary(displayName: string | null, vcard: string | null): string {
  const lines = (vcard ?? "").split(/\r?\n/);
  const fn = lines.find((l) => /^FN[:;]/i.test(l))?.replace(/^FN[^:]*:/i, "").trim() || null;
  const org = lines.find((l) => /^ORG[:;]/i.test(l))?.replace(/^ORG[^:]*:/i, "").replace(/;+$/, "").trim() || null;
  const tels = lines.filter((l) => /^(item\d+\.)?TEL[:;]/i.test(l)).map((l) => l.slice(l.lastIndexOf(":") + 1).trim());
  const emails = lines.filter((l) => /^(item\d+\.)?EMAIL[:;]/i.test(l)).map((l) => l.slice(l.lastIndexOf(":") + 1).trim());
  return [displayName ?? fn, org, ...tels, ...emails].filter(Boolean).join(", ");
}

const MEDIA_TYPES = [
  ["imageMessage", "image", "image/jpeg"],
  ["videoMessage", "video", "video/mp4"],
  ["audioMessage", "audio", "audio/ogg"],
  ["documentMessage", "document", "application/octet-stream"],
  ["stickerMessage", "sticker", "image/webp"],
  ["ptvMessage", "video", "video/mp4"],
] as const;

export type MediaInfo = { field: (typeof MEDIA_TYPES)[number][0]; kind: MessageKind; name: string; mime: string; size: number | null };

/** The single media item of a message (null for text/contacts/locations). */
export function mediaInfo(content: Rec | null, messageId: string): MediaInfo | null {
  if (!content) return null;
  for (const [field, kind, fallback] of MEDIA_TYPES) {
    const m = content[field];
    if (!m) continue;
    const media = o(m);
    const mime = cleanMime(s(media.mimetype)?.split(";")[0], fallback);
    const fileName = s(media.fileName) ?? s(media.title);
    const name = fileName ?? `${kind}-${messageId}.${extForMime(mime)}`;
    return { field, kind: field === "audioMessage" && media.ptt ? "audio" : kind, name: name.slice(0, 200), mime, size: toNum(media.fileLength) };
  }
  return null;
}

/** Text, kind and quoted message of a message's content. `null` = nothing worth importing. */
export function contentText(content: Rec | null): { text: string; kind: MessageKind; replyTo: string | null } | null {
  if (!content) return null;
  const ctxInfo = (v: unknown) => s(o(o(v).contextInfo).stanzaId);

  if (s(content.conversation)) return { text: content.conversation as string, kind: "text", replyTo: null };
  const ext = o(content.extendedTextMessage);
  if (s(ext.text)) return { text: ext.text as string, kind: "text", replyTo: ctxInfo(ext) };

  for (const [field, kind] of MEDIA_TYPES) {
    if (!content[field]) continue;
    const m = o(content[field]);
    return { text: s(m.caption) ?? "", kind, replyTo: ctxInfo(m) };
  }

  if (content.contactMessage) {
    const c = o(content.contactMessage);
    return { text: `Contact: ${vcardSummary(s(c.displayName), s(c.vcard))}`.trim(), kind: "contact", replyTo: ctxInfo(c) };
  }
  if (content.contactsArrayMessage) {
    const list = Array.isArray(o(content.contactsArrayMessage).contacts) ? (o(content.contactsArrayMessage).contacts as unknown[]) : [];
    const text = list.map((c) => `Contact: ${vcardSummary(s(o(c).displayName), s(o(c).vcard))}`).join("\n");
    return { text: text || "Contacts", kind: "contact", replyTo: null };
  }
  const loc = content.locationMessage ?? content.liveLocationMessage;
  if (loc) {
    const l = o(loc);
    const lat = toNum(l.degreesLatitude);
    const lng = toNum(l.degreesLongitude);
    const label = [s(l.name), s(l.address), s(l.caption)].filter(Boolean).join(", ");
    return { text: [lat !== null && lng !== null ? `📍 ${lat},${lng}` : "📍", label].filter(Boolean).join(" "), kind: "location", replyTo: ctxInfo(l) };
  }
  const poll = content.pollCreationMessage ?? content.pollCreationMessageV2 ?? content.pollCreationMessageV3;
  if (poll) {
    const p = o(poll);
    const options = (Array.isArray(p.options) ? p.options : []).map((x) => s(o(x).optionName)).filter(Boolean);
    return { text: [`Poll: ${s(p.name) ?? ""}`.trim(), ...options.map((x) => `- ${x}`)].join("\n"), kind: "text", replyTo: null };
  }
  const reply =
    s(o(content.buttonsResponseMessage).selectedDisplayText) ??
    s(o(o(content.listResponseMessage).singleSelectReply).selectedRowId) ??
    s(o(content.listResponseMessage).title) ??
    s(o(content.templateButtonReplyMessage).selectedDisplayText);
  if (reply) return { text: reply, kind: "text", replyTo: null };
  if (content.orderMessage) {
    const ord = o(content.orderMessage);
    const total = toNum(ord.totalAmount1000);
    const parts = [s(ord.orderTitle) ?? "Order", toNum(ord.itemCount) ? `${toNum(ord.itemCount)} item(s)` : null, total !== null ? `${total / 1000} ${s(ord.totalCurrencyCode) ?? ""}`.trim() : null, s(ord.message)];
    return { text: parts.filter(Boolean).join(" — "), kind: "text", replyTo: null };
  }
  if (content.productMessage) {
    const p = o(o(content.productMessage).product);
    const price = toNum(p.priceAmount1000);
    const parts = ["Product:", s(p.title), price !== null ? `${price / 1000} ${s(p.currencyCode) ?? ""}`.trim() : null, s(p.description)];
    return { text: parts.filter(Boolean).join(" "), kind: "text", replyTo: null };
  }
  // Reactions, protocol messages (deletes/edits/key shares), receipts, call logs …: not conversation content.
  return null;
}

/** Who a message belongs to — resolved by the connector (needs the socket for LID → phone lookups). */
export type ResolvedParties = {
  /** Canonical chat id (phone JID when known, else LID / group JID). */
  chatJid: string;
  chatTitle: string | null;
  /** Sender identity (null for own messages). */
  sender: { jid: string | null; phone: string | null; name: string | null } | null;
};

export type LinkedDeviceMessage = {
  key?: { id?: string | null; fromMe?: boolean | null; remoteJid?: string | null; participant?: string | null } | null;
  message?: unknown;
  messageTimestamp?: unknown;
  pushName?: string | null;
  messageStubType?: unknown;
};

/**
 * Converts one Baileys `WAMessage`. Returns null for anything that isn't
 * conversation content (reactions, receipts, system stubs, deletes, status).
 * Media is described (name/mime/size); the connector adds the bytes when it downloads them.
 */
export function parseLinkedDeviceMessage(m: LinkedDeviceMessage, who: ResolvedParties, opts: { historical?: boolean } = {}): ParsedInbound | null {
  const id = s(m.key?.id);
  if (!id || isIgnoredJid(who.chatJid)) return null;
  const content = unwrapContent(m.message);
  const body = contentText(content);
  if (!body) return null;
  const media = mediaInfo(content, id);
  if (!body.text.trim() && !media) return null;

  const ts = toNum(m.messageTimestamp);
  const sentAt = ts && ts > 0 ? new Date(ts * 1000) : new Date();
  const fromMe = Boolean(m.key?.fromMe);
  const isGroup = isGroupJid(who.chatJid);
  const attachments: InboundAttachment[] = media ? [{ name: media.name, mime: media.mime, size: media.size, providerId: id }] : [];

  return {
    externalId: id,
    direction: fromMe ? "outbound" : "inbound",
    conversation: { externalId: who.chatJid, title: who.chatTitle, isGroup },
    sender: fromMe ? { isMe: true, name: "You" } : { externalId: who.sender?.jid ?? null, phone: who.sender?.phone ?? null, name: who.sender?.name ?? s(m.pushName) },
    kind: media?.kind ?? body.kind,
    text: body.text,
    attachments,
    sentAt,
    replyToExternalId: body.replyTo,
    historical: opts.historical,
    // Never the message content: just enough to debug routing.
    raw: { provider: "whatsapp_web", type: content ? Object.keys(content).filter((k) => k !== "messageContextInfo")[0] ?? null : null, isGroup, fromMe },
  };
}
