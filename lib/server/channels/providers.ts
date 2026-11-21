/**
 * Provider HTTP calls (WhatsApp Graph API, Telegram Bot API, Slack Web API,
 * Twilio REST). Every call has a 10 s timeout, never logs or returns tokens
 * (Telegram puts the bot token in the URL, so errors are rebuilt from scratch),
 * and classifies failures as retryable (network, 429, 5xx) or permanent.
 */
import { slackEscape } from "./adapters/slack";
import { obj, readResponseCapped, str, tryJson } from "./util";

export const PROVIDER_TIMEOUT_MS = 10_000;
export const GRAPH_API = "https://graph.facebook.com/v21.0";
export const TELEGRAM_API = "https://api.telegram.org";

export type SendResult = { ok: true; providerMessageId: string | null } | { ok: false; error: string; retryable: boolean; status: number | null };

/** fetch with timeout; network failures become a `SendResult`-style error without leaking the URL. */
async function call(url: string, init: RequestInit, provider: string): Promise<{ res: Response; body: unknown } | { error: string; retryable: true }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), cache: "no-store", redirect: "error" });
    const text = (await readResponseCapped(res, 1024 * 1024))?.toString("utf8") ?? "";
    return { res, body: tryJson(text) };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { error: timeout ? `${provider} did not respond in time.` : `Could not reach ${provider}.`, retryable: true };
  }
}

const transientStatus = (s: number) => s === 408 || s === 429 || s >= 500;
const clip = (s: string) => s.replace(/\s+/g, " ").slice(0, 300);

/* -------------------------------- WhatsApp -------------------------------- */

const WA_TRANSIENT_CODES = new Set([1, 2, 4, 80007, 130429, 131016, 131056, 133004]);

export async function sendWhatsAppText(input: { phoneNumberId: string; accessToken: string; to: string; text: string }): Promise<SendResult> {
  const r = await call(
    `${GRAPH_API}/${encodeURIComponent(input.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: input.to.replace(/^\+/, ""), type: "text", text: { body: input.text, preview_url: false } }),
    },
    "WhatsApp",
  );
  if ("error" in r) return { ok: false, error: r.error, retryable: true, status: null };
  const b = obj(r.body);
  if (r.res.ok) return { ok: true, providerMessageId: str(obj((b.messages as unknown[] | undefined)?.[0]).id) };
  const err = obj(b.error);
  const code = typeof err.code === "number" ? err.code : null;
  return {
    ok: false,
    error: `WhatsApp rejected the message${code ? ` (code ${code})` : ""}: ${clip(str(err.message) ?? `HTTP ${r.res.status}`)}`,
    retryable: transientStatus(r.res.status) || (code !== null && WA_TRANSIENT_CODES.has(code)),
    status: r.res.status,
  };
}

/** Graph API media id → bytes (two requests: metadata, then the signed URL). Null if missing/oversized. */
export async function fetchWhatsAppMedia(mediaId: string, accessToken: string, maxBytes: number): Promise<{ data: Buffer; mime: string | null } | null> {
  const meta = await call(`${GRAPH_API}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${accessToken}` } }, "WhatsApp");
  if ("error" in meta || !meta.res.ok) return null;
  const m = obj(meta.body);
  const url = str(m.url);
  const declared = typeof m.file_size === "number" ? m.file_size : null;
  if (!url || !/^https:\/\//i.test(url) || (declared !== null && declared > maxBytes)) return null;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    const data = await readResponseCapped(res, maxBytes);
    return data ? { data, mime: str(m.mime_type) } : null;
  } catch {
    return null;
  }
}

/* -------------------------------- Telegram -------------------------------- */

export async function sendTelegramText(input: { botToken: string; chatId: string; text: string }): Promise<SendResult> {
  const r = await call(
    `${TELEGRAM_API}/bot${input.botToken}/sendMessage`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: input.chatId, text: input.text, disable_web_page_preview: true }) },
    "Telegram",
  );
  if ("error" in r) return { ok: false, error: r.error, retryable: true, status: null };
  const b = obj(r.body);
  if (r.res.ok && b.ok === true) {
    const mid = str(obj(b.result).message_id);
    return { ok: true, providerMessageId: mid ? `${input.chatId}:${mid}` : null };
  }
  return { ok: false, error: `Telegram rejected the message: ${clip(str(b.description) ?? `HTTP ${r.res.status}`)}`, retryable: transientStatus(r.res.status), status: r.res.status };
}

/** Bot API file id → bytes via getFile (files > 20 MB can't be downloaded by bots). */
export async function fetchTelegramFile(fileId: string, botToken: string, maxBytes: number): Promise<{ data: Buffer; mime: string | null } | null> {
  const meta = await call(`${TELEGRAM_API}/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, {}, "Telegram");
  if ("error" in meta || !meta.res.ok) return null;
  const result = obj(obj(meta.body).result);
  const path = str(result.file_path);
  const declared = typeof result.file_size === "number" ? result.file_size : null;
  if (!path || /\.\.|^\//.test(path) || (declared !== null && declared > maxBytes)) return null;
  try {
    const res = await fetch(`${TELEGRAM_API}/file/bot${botToken}/${path.split("/").map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    const data = await readResponseCapped(res, maxBytes);
    return data ? { data, mime: null } : null;
  } catch {
    return null;
  }
}

/** Registers the bot webhook (explicit admin action on channel create/update). */
export async function registerTelegramWebhook(input: { botToken: string; url: string; secret: string }): Promise<{ ok: boolean; error?: string }> {
  if (!input.url.startsWith("https://")) return { ok: false, error: "Telegram requires an HTTPS webhook URL. Set APP_URL to your public https address." };
  const r = await call(
    `${TELEGRAM_API}/bot${input.botToken}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: input.url, secret_token: input.secret, allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"] }),
    },
    "Telegram",
  );
  if ("error" in r) return { ok: false, error: r.error };
  const b = obj(r.body);
  return r.res.ok && b.ok === true ? { ok: true } : { ok: false, error: `Telegram: ${clip(str(b.description) ?? `HTTP ${r.res.status}`)}` };
}

/* ---------------------------------- Slack ---------------------------------- */

const SLACK_TRANSIENT = new Set(["ratelimited", "rate_limited", "internal_error", "fatal_error", "service_unavailable", "request_timeout"]);

export async function sendSlackText(input: { botToken: string; channel: string; text: string }): Promise<SendResult> {
  const r = await call(
    "https://slack.com/api/chat.postMessage",
    { method: "POST", headers: { Authorization: `Bearer ${input.botToken}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel: input.channel, text: slackEscape(input.text) }) },
    "Slack",
  );
  if ("error" in r) return { ok: false, error: r.error, retryable: true, status: null };
  const b = obj(r.body);
  if (r.res.ok && b.ok === true) {
    const ts = str(b.ts);
    return { ok: true, providerMessageId: ts ? `${str(b.channel) ?? input.channel}:${ts}` : null };
  }
  const code = str(b.error) ?? `HTTP ${r.res.status}`;
  return { ok: false, error: `Slack rejected the message: ${clip(code)}`, retryable: transientStatus(r.res.status) || SLACK_TRANSIENT.has(code), status: r.res.status };
}

/* --------------------------------- Twilio --------------------------------- */

/** True only for https URLs on Twilio's API host — credentials are never sent anywhere else. */
export function isTwilioMediaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "api.twilio.com" || u.hostname.endsWith(".twilio.com")) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** MMS media (MediaUrlN) → bytes with Basic auth. Twilio redirects to its CDN; fetch drops the Authorization header cross-origin. */
export async function fetchTwilioMedia(url: string, accountSid: string, authToken: string, maxBytes: number): Promise<{ data: Buffer; mime: string | null } | null> {
  if (!isTwilioMediaUrl(url)) return null;
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` }, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    const data = await readResponseCapped(res, maxBytes);
    return data ? { data, mime: res.headers.get("content-type") } : null;
  } catch {
    return null;
  }
}

export async function sendTwilioText(input: { accountSid: string; authToken: string; to: string; from: string | null; messagingServiceSid: string | null; text: string }): Promise<SendResult> {
  const form = new URLSearchParams({ To: input.to, Body: input.text });
  if (input.messagingServiceSid) form.set("MessagingServiceSid", input.messagingServiceSid);
  else if (input.from) form.set("From", input.from);
  const r = await call(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
    "Twilio",
  );
  if ("error" in r) return { ok: false, error: r.error, retryable: true, status: null };
  const b = obj(r.body);
  if (r.res.ok) return { ok: true, providerMessageId: str(b.sid) };
  const code = typeof b.code === "number" ? b.code : null;
  return { ok: false, error: `Twilio rejected the message${code ? ` (code ${code})` : ""}: ${clip(str(b.message) ?? `HTTP ${r.res.status}`)}`, retryable: transientStatus(r.res.status), status: r.res.status };
}
