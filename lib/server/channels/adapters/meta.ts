/**
 * Meta Messenger (Facebook Page) and Instagram Direct — official Messenger
 * Platform webhooks, pure parsing + signature checks.
 *
 * Payload: `{ object: "page" | "instagram", entry: [{ id, time, messaging: [event] }] }`
 *   event = { sender: { id }, recipient: { id }, timestamp, message?: { mid, text, attachments, is_echo, reply_to }, postback? }
 * `entry.id` is the Page id (Messenger) or the Instagram professional account id.
 *
 * Conversations are 1:1 with the customer: conversation id = the customer's
 * page-scoped id (PSID / IGSID) — `sender.id` for incoming messages, and
 * `recipient.id` for echoes of messages the business sent (from Meta Business
 * Suite, the Instagram app or Infera itself).
 */
import type { MessageKind } from "@/lib/shared/types";
import { hmacHex, safeEqual } from "../../crypto";
import type { InboundAttachment, ParsedInbound } from "../types";
import { arr, num, obj, str } from "../util";

export type MetaPlatform = "messenger" | "instagram";

/** `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(appSecret, rawBody)>`, compared in constant time. */
export function verifyMetaSignature(rawBody: Buffer | string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const m = header.trim().match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return false;
  return safeEqual(hmacHex("sha256", appSecret, rawBody), m[1].toLowerCase());
}

/** GET subscription handshake: the challenge to echo, or null if the token doesn't match. */
export function metaVerifyChallenge(query: URLSearchParams, verifyToken: string): string | null {
  if (!verifyToken) return null;
  const challenge = query.get("hub.challenge");
  if (query.get("hub.mode") !== "subscribe" || challenge === null || challenge.length > 1000) return null;
  return safeEqual(query.get("hub.verify_token") ?? "", verifyToken) ? challenge : null;
}

const KIND: Record<string, MessageKind> = { image: "image", video: "video", audio: "audio", file: "document", sticker: "sticker", ig_reel: "video", reel: "video", story_mention: "image", share: "text" };
const MIME: Record<string, string> = { image: "image/jpeg", video: "video/mp4", audio: "audio/mp4", file: "application/octet-stream", sticker: "image/png", ig_reel: "video/mp4", reel: "video/mp4", story_mention: "image/jpeg" };

/** Only Meta's CDNs — attachment URLs are fetched server-side, so never follow arbitrary hosts (SSRF). */
export function isMetaCdnUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /(^|\.)(fbcdn\.net|fbsbx\.com|cdninstagram\.com|facebook\.com|instagram\.com)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function attachmentsOf(raw: unknown[], mid: string): { attachments: InboundAttachment[]; kind: MessageKind | null; lines: string[] } {
  const attachments: InboundAttachment[] = [];
  const lines: string[] = [];
  let kind: MessageKind | null = null;
  raw.forEach((a, i) => {
    const at = obj(a);
    const type = str(at.type) ?? "file";
    const payload = obj(at.payload);
    const url = str(payload.url);
    if (type === "location") {
      const c = obj(payload.coordinates);
      const lat = num(c.lat);
      const lng = num(c.long);
      lines.push(lat !== null && lng !== null ? `📍 ${lat},${lng}` : "📍 Location");
      kind ??= "location";
      return;
    }
    if (type === "fallback" || type === "template" || type === "share") {
      const title = str(payload.title) ?? str(at.title);
      if (title || url) lines.push([title, url && !isMetaCdnUrl(url) ? url : null].filter(Boolean).join(" — "));
      return;
    }
    if (!url) return;
    const mime = MIME[type] ?? "application/octet-stream";
    const ext = mime.split("/")[1]?.replace("octet-stream", "bin") ?? "bin";
    attachments.push({ name: str(payload.title) ?? `${type}-${mid.slice(-8)}-${i + 1}.${ext}`, mime, url: isMetaCdnUrl(url) ? url : null, providerId: isMetaCdnUrl(url) ? url : null });
    kind ??= KIND[type] ?? "document";
  });
  return { attachments, kind, lines };
}

/** One `messaging[]` event. Null for reads, deliveries, reactions, typing and empty events. */
export function parseMetaEvent(ev: Record<string, unknown>, platform: MetaPlatform, names: Map<string, string> = new Map()): ParsedInbound | null {
  const senderId = str(obj(ev.sender).id);
  const recipientId = str(obj(ev.recipient).id);
  const ts = num(ev.timestamp);
  if (!senderId || !recipientId) return null;
  const sentAt = ts ? new Date(ts) : new Date();

  const msg = obj(ev.message);
  const postback = obj(ev.postback);
  let mid: string | null;
  let text: string;
  let kind: MessageKind = "text";
  let attachments: InboundAttachment[] = [];
  let replyTo: string | null = null;
  const echo = msg.is_echo === true;

  if (Object.keys(msg).length) {
    if (msg.is_deleted === true) return null;
    mid = str(msg.mid);
    const a = attachmentsOf(arr(msg.attachments), mid ?? "");
    attachments = a.attachments;
    text = [str(msg.text) ?? "", ...a.lines].filter(Boolean).join("\n");
    kind = a.kind ?? "text";
    const qr = str(obj(msg.quick_reply).payload);
    if (!text && qr) text = qr;
    replyTo = str(obj(msg.reply_to).mid);
  } else if (Object.keys(postback).length) {
    mid = str(postback.mid) ?? `pb:${senderId}:${ts ?? Date.now()}`;
    text = str(postback.title) ?? str(postback.payload) ?? "";
  } else {
    return null; // read / delivery / reaction / referral / typing
  }
  if (!mid || (!text.trim() && !attachments.length)) return null;

  // Echo = sent by the business: the customer is the recipient.
  const customer = echo ? recipientId : senderId;
  const name = names.get(customer) ?? null;
  return {
    externalId: mid,
    direction: echo ? "outbound" : "inbound",
    conversation: { externalId: customer, title: name, isGroup: false },
    sender: echo ? { isMe: true, name: "You" } : { externalId: customer, name },
    kind,
    text,
    attachments,
    sentAt,
    replyToExternalId: replyTo,
    raw: { provider: platform, echo, appId: echo ? (num(msg.app_id) ?? null) : null },
  };
}

export type MetaBatch = { accountId: string; platform: MetaPlatform; messages: ParsedInbound[]; customerIds: string[] };

/** Whole webhook body → one batch per entry (Page / Instagram account). */
export function parseMetaPayload(payload: unknown, names: Map<string, string> = new Map()): MetaBatch[] {
  const body = obj(payload);
  const object = str(body.object);
  if (object !== "page" && object !== "instagram") return [];
  const platform: MetaPlatform = object === "page" ? "messenger" : "instagram";
  return arr(body.entry).flatMap((e) => {
    const entry = obj(e);
    const accountId = str(entry.id);
    if (!accountId) return [];
    const events = arr(entry.messaging).map(obj);
    const messages = events.map((ev) => parseMetaEvent(ev, platform, names)).filter((m): m is ParsedInbound => m !== null);
    return [{ accountId, platform, messages, customerIds: [...new Set(messages.map((m) => m.conversation.externalId))] }];
  });
}
