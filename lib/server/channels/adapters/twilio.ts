/**
 * Twilio Messaging (SMS/MMS, and WhatsApp via Twilio) — pure parsing + signature check.
 *
 * Signature: `X-Twilio-Signature = base64(HMAC-SHA1(authToken, fullUrl + Σ sorted(key + value)))`
 * over the POSTed form parameters. The full URL is the one configured in Twilio,
 * so the route tries the public APP_URL form and the URL as received.
 */
import { hmacBase64, safeEqual } from "../../crypto";
import type { InboundAttachment, ParsedInbound } from "../types";
import { cleanMime, extForMime, kindForMime } from "../util";

export function twilioSignature(url: string, params: [string, string][], authToken: string): string {
  const sorted = [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return hmacBase64("sha1", authToken, url + sorted.map(([k, v]) => k + v).join(""));
}

export function verifyTwilioSignature(urls: string[], params: [string, string][], signature: string | null, authToken: string): boolean {
  if (!signature || !authToken) return false;
  let ok = false;
  // Check every candidate (no early exit) so timing doesn't reveal which form matched.
  for (const url of urls) if (safeEqual(twilioSignature(url, params, authToken), signature.trim())) ok = true;
  return ok;
}

/** "whatsapp:+14155550123" → "+14155550123". */
export const twilioAddressPhone = (v: string) => v.replace(/^(whatsapp|sms|mms|messenger):/i, "").trim();

export function parseTwilioForm(params: Record<string, string>): ParsedInbound | null {
  const sid = params.MessageSid ?? params.SmsMessageSid ?? params.SmsSid;
  const from = params.From;
  if (!sid || !from) return null;
  const body = params.Body ?? "";
  const attachments: InboundAttachment[] = [];
  const numMedia = Math.min(10, Math.max(0, Number(params.NumMedia ?? 0) || 0));
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`];
    if (!url) continue;
    const mime = cleanMime(params[`MediaContentType${i}`]);
    // providerId: the auth-protected media URL, downloaded lazily with the channel credentials.
    attachments.push({ name: `media-${i + 1}.${extForMime(mime)}`, mime, url, providerId: url });
  }
  if (!body.trim() && !attachments.length) return null;
  const phone = twilioAddressPhone(from);
  const location = params.Latitude && params.Longitude ? `📍 ${params.Latitude},${params.Longitude}${params.Label ? ` ${params.Label}` : ""}` : "";
  return {
    externalId: sid,
    direction: "inbound",
    // Keep the provider address (with any "whatsapp:" prefix) so replies go back on the same transport.
    conversation: { externalId: from, title: params.ProfileName || phone, isGroup: false },
    sender: { externalId: from, name: params.ProfileName || null, phone: /^\+?\d{7,15}$/.test(phone) ? phone : null },
    kind: location ? "location" : !body.trim() && attachments[0] ? kindForMime(attachments[0].mime) : "text",
    text: [body, location].filter(Boolean).join("\n"),
    attachments,
    sentAt: new Date(),
    raw: { provider: "sms_twilio", to: params.To ?? null, numMedia, accountSid: params.AccountSid ?? null, messagingServiceSid: params.MessagingServiceSid ?? null },
  };
}
