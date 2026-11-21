/**
 * Telegram Bot API — pure update parsing + secret-token check.
 *
 * Telegram sends `X-Telegram-Bot-Api-Secret-Token` (the `secret_token` given to
 * setWebhook) with every update. Message ids are only unique per chat, so the
 * stored external id is `<chat_id>:<message_id>` (edits get `:e<edit_date>`, so
 * a corrected amount is kept as a new fact instead of silently overwriting).
 */
import type { MessageKind } from "@/lib/shared/types";
import { safeEqual } from "../../crypto";
import type { InboundAttachment, ParsedInbound } from "../types";
import { arr, cleanMime, num, obj, parseTimestamp, str } from "../util";

export function verifyTelegramSecret(header: string | null, webhookSecret: string): boolean {
  if (!header || !webhookSecret) return false;
  return safeEqual(header, webhookSecret);
}

/** Bot id = the numeric part of the bot token ("123456:ABC..." → "123456"). */
export function telegramBotId(botToken: string): string | null {
  const m = botToken.trim().match(/^(\d{3,20}):[A-Za-z0-9_-]{20,}$/);
  return m ? m[1] : null;
}

const personName = (u: Record<string, unknown>) => [str(u.first_name), str(u.last_name)].filter(Boolean).join(" ") || (str(u.username) ? `@${str(u.username)}` : "");

/** Converts one Update. Returns null for updates without a usable message (callbacks, bot messages, service messages). */
export function parseTelegramUpdate(update: unknown): ParsedInbound | null {
  const u = obj(update);
  const edited = Boolean(u.edited_message ?? u.edited_channel_post);
  const m = obj(u.message ?? u.edited_message ?? u.channel_post ?? u.edited_channel_post);
  const chat = obj(m.chat);
  const chatId = str(chat.id);
  const messageId = str(m.message_id);
  if (!chatId || !messageId) return null;
  const from = obj(m.from);
  if (from.is_bot === true) return null;

  const chatType = str(chat.type) ?? "private";
  const isGroup = chatType !== "private";
  let text = str(m.text) ?? str(m.caption) ?? "";
  let kind: MessageKind = "text";
  const attachments: InboundAttachment[] = [];

  const photos = arr(m.photo).map(obj);
  if (photos.length) {
    // Telegram sends several sizes; keep the largest.
    const best = photos.reduce((a, b) => ((num(b.file_size) ?? (num(b.width) ?? 0) * (num(b.height) ?? 0)) > (num(a.file_size) ?? (num(a.width) ?? 0) * (num(a.height) ?? 0)) ? b : a));
    const fid = str(best.file_id);
    if (fid) attachments.push({ name: `photo-${str(best.file_unique_id) ?? messageId}.jpg`, mime: "image/jpeg", size: num(best.file_size), providerId: fid });
    kind = "image";
  }
  const fileLike: [string, MessageKind, string, string][] = [
    ["document", "document", "application/octet-stream", "bin"],
    ["voice", "audio", "audio/ogg", "ogg"],
    ["audio", "audio", "audio/mpeg", "mp3"],
    ["video", "video", "video/mp4", "mp4"],
    ["video_note", "video", "video/mp4", "mp4"],
    ["animation", "video", "video/mp4", "mp4"],
  ];
  for (const [key, k, defMime, ext] of fileLike) {
    const f = obj(m[key]);
    const fid = str(f.file_id);
    if (!fid) continue;
    const mime = cleanMime(f.mime_type, defMime);
    attachments.push({ name: str(f.file_name) ?? `${key}-${str(f.file_unique_id) ?? messageId}.${ext}`, mime, size: num(f.file_size), providerId: fid });
    if (kind === "text") kind = k;
  }
  if (m.sticker) {
    kind = "sticker";
    text ||= str(obj(m.sticker).emoji) ?? "";
  }
  const contact = obj(m.contact);
  if (str(contact.phone_number)) {
    kind = "contact";
    text = `Contact: ${[personName(contact), str(contact.phone_number)].filter(Boolean).join(", ")}`;
  }
  const venue = obj(m.venue);
  const loc = obj(m.location ?? venue.location);
  if (num(loc.latitude) !== null && num(loc.longitude) !== null) {
    kind = "location";
    text = [`📍 ${num(loc.latitude)},${num(loc.longitude)}`, [str(venue.title), str(venue.address)].filter(Boolean).join(", ")].filter(Boolean).join(" ");
  }
  if (!text.trim() && !attachments.length && kind === "text") return null;

  // Channel posts have no `from`; the channel itself is the sender.
  const senderChat = obj(m.sender_chat);
  const senderId = str(from.id) ?? str(senderChat.id) ?? chatId;
  const senderName = personName(from) || str(senderChat.title) || str(chat.title) || "";
  const editDate = str(m.edit_date);
  const reply = obj(m.reply_to_message);
  return {
    externalId: edited && editDate ? `${chatId}:${messageId}:e${editDate}` : `${chatId}:${messageId}`,
    direction: "inbound",
    conversation: { externalId: chatId, title: isGroup ? str(chat.title) ?? chatId : personName(chat) || senderName || chatId, isGroup },
    sender: { externalId: senderId, name: senderName || null },
    kind,
    text,
    attachments,
    sentAt: parseTimestamp(edited && editDate ? editDate : m.date) ?? new Date(),
    replyToExternalId: str(reply.message_id) ? `${chatId}:${str(reply.message_id)}` : null,
    raw: { provider: "telegram", updateId: str(u.update_id), chatType, edited, messageId },
  };
}
