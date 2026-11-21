/**
 * Meta WhatsApp Business Cloud API — pure payload parsing + signature checks.
 *
 * Webhook payload: `{ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value }] }] }`
 * where `value` has `metadata.phone_number_id` (→ channel.externalId), `contacts[]`
 * (wa_id + profile name), `messages[]` and `statuses[]` (delivery receipts, ignored).
 *
 * Conversations are 1:1 with the customer (conversation id = customer's wa_id).
 */
import type { MessageKind } from "@/lib/shared/types";
import { hmacHex, safeEqual } from "../../crypto";
import type { InboundAttachment, ParsedInbound } from "../types";
import { arr, cleanMime, extForMime, num, obj, parseTimestamp, str } from "../util";

export type WhatsAppBatch = { phoneNumberId: string; displayPhoneNumber: string | null; messages: ParsedInbound[] };

/** `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(appSecret, rawBody)>`, compared in constant time. */
export function verifyWhatsAppSignature(rawBody: Buffer | string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const m = header.trim().match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return false;
  return safeEqual(hmacHex("sha256", appSecret, rawBody), m[1].toLowerCase());
}

/** GET subscription handshake: returns the challenge to echo, or null if the token doesn't match. */
export function whatsappVerifyChallenge(query: URLSearchParams, verifyToken: string): string | null {
  if (!verifyToken) return null;
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token") ?? "";
  const challenge = query.get("hub.challenge");
  if (mode !== "subscribe" || challenge === null || challenge.length > 1000) return null;
  return safeEqual(token, verifyToken) ? challenge : null;
}

const MEDIA_KIND: Record<string, MessageKind> = { image: "image", video: "video", audio: "audio", document: "document", sticker: "sticker" };

function mediaAttachment(type: string, m: Record<string, unknown>): InboundAttachment | null {
  const id = str(m.id);
  if (!id) return null;
  const mime = cleanMime(m.mime_type, type === "image" ? "image/jpeg" : type === "audio" ? "audio/ogg" : type === "video" ? "video/mp4" : type === "sticker" ? "image/webp" : "application/octet-stream");
  const filename = str(m.filename);
  return { name: filename || `${type}-${id}.${extForMime(mime)}`, mime, providerId: id, size: num(m.file_size) };
}

function contactCardText(c: Record<string, unknown>): string {
  const name = str(obj(c.name).formatted_name) ?? [str(obj(c.name).first_name), str(obj(c.name).last_name)].filter(Boolean).join(" ");
  const phones = arr(c.phones)
    .map((p) => str(obj(p).phone) ?? (str(obj(p).wa_id) ? `+${str(obj(p).wa_id)}` : null))
    .filter((p): p is string => Boolean(p));
  const emails = arr(c.emails)
    .map((e) => str(obj(e).email))
    .filter((e): e is string => Boolean(e));
  const org = str(obj(c.org).company);
  return ["Contact:", [name, org, ...phones, ...emails].filter(Boolean).join(", ")].join(" ").trim();
}

/** Converts one `messages[]` entry. Returns null for reactions, unsupported and empty messages. */
export function parseWhatsAppMessage(m: Record<string, unknown>, profileNames: Map<string, string>): ParsedInbound | null {
  const id = str(m.id);
  const from = str(m.from);
  const type = str(m.type) ?? "";
  if (!id || !from) return null;
  let text = "";
  let kind: MessageKind = "text";
  const attachments: InboundAttachment[] = [];

  switch (type) {
    case "text":
      text = str(obj(m.text).body) ?? "";
      break;
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker": {
      const media = obj(m[type]);
      const a = mediaAttachment(type, media);
      if (a) attachments.push(a);
      text = str(media.caption) ?? "";
      kind = MEDIA_KIND[type];
      break;
    }
    case "location": {
      const l = obj(m.location);
      const lat = num(l.latitude);
      const lng = num(l.longitude);
      const label = [str(l.name), str(l.address)].filter(Boolean).join(", ");
      text = [lat !== null && lng !== null ? `📍 ${lat},${lng}` : "📍", label].filter(Boolean).join(" ");
      kind = "location";
      break;
    }
    case "contacts":
      text = arr(m.contacts)
        .map((c) => contactCardText(obj(c)))
        .join("\n");
      kind = "contact";
      break;
    case "interactive": {
      const i = obj(m.interactive);
      const reply = obj(i.button_reply ?? i.list_reply ?? i.nfm_reply);
      text = [str(reply.title), str(reply.description)].filter(Boolean).join(" — ") || str(reply.body) || "";
      break;
    }
    case "button":
      text = str(obj(m.button).text) ?? str(obj(m.button).payload) ?? "";
      break;
    case "order": {
      // Catalog order: product ids, quantities and prices exactly as sent by WhatsApp.
      const o = obj(m.order);
      const lines = arr(o.product_items).map((p) => {
        const it = obj(p);
        const price = num(it.item_price);
        return `- ${str(it.product_retailer_id) ?? "item"} x${num(it.quantity) ?? 1}${price !== null ? ` @ ${price} ${str(it.currency) ?? ""}`.trimEnd() : ""}`;
      });
      text = [str(o.text), lines.length ? `Order:\n${lines.join("\n")}` : ""].filter(Boolean).join("\n");
      break;
    }
    case "system":
      text = str(obj(m.system).body) ?? "";
      kind = "system";
      break;
    default:
      // reaction, unsupported, unknown, ephemeral… carry no business content.
      return null;
  }
  if (!text.trim() && !attachments.length) return null;

  const name = profileNames.get(from) ?? null;
  const ts = parseTimestamp(m.timestamp);
  const context = obj(m.context);
  return {
    externalId: id,
    direction: "inbound",
    conversation: { externalId: from, title: name ?? `+${from}`, isGroup: false },
    sender: { externalId: from, name, phone: `+${from.replace(/^\+/, "")}` },
    kind,
    text,
    attachments,
    sentAt: ts ?? new Date(),
    replyToExternalId: str(context.id),
    // Trimmed provider payload (no secrets in it): the message object only.
    raw: { provider: "whatsapp_cloud", type, message: m },
  };
}

/** Full webhook payload → messages grouped by receiving phone number. Statuses and reactions are dropped. */
export function parseWhatsAppPayload(payload: unknown): WhatsAppBatch[] {
  const p = obj(payload);
  if (p.object !== undefined && p.object !== "whatsapp_business_account") return [];
  const out = new Map<string, WhatsAppBatch>();
  for (const entry of arr(p.entry)) {
    for (const change of arr(obj(entry).changes)) {
      const c = obj(change);
      if (c.field !== undefined && c.field !== "messages") continue;
      const value = obj(c.value);
      const meta = obj(value.metadata);
      const phoneNumberId = str(meta.phone_number_id);
      if (!phoneNumberId) continue;
      const names = new Map<string, string>();
      for (const ct of arr(value.contacts)) {
        const waId = str(obj(ct).wa_id);
        const name = str(obj(obj(ct).profile).name);
        if (waId && name) names.set(waId, name);
      }
      const batch = out.get(phoneNumberId) ?? { phoneNumberId, displayPhoneNumber: str(meta.display_phone_number), messages: [] };
      for (const msg of arr(value.messages)) {
        const parsed = parseWhatsAppMessage(obj(msg), names);
        if (parsed) batch.messages.push(parsed);
      }
      out.set(phoneNumberId, batch);
    }
  }
  return [...out.values()];
}
