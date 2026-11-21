/**
 * LinkedIn messaging via Unipile (optional third-party connector; LinkedIn has no
 * messaging API for regular accounts). Docs: developer.unipile.com.
 *
 *   base  https://{dsn}/api/v1/…   header X-API-KEY
 *   POST  /hosted/accounts/link    → { url }  (hosted LinkedIn login; we set `name` = channel id)
 *   GET   /accounts                → find the account whose `name` is the channel id
 *   POST  /webhooks                → message_received → our /api/webhooks/unipile/:token (secret header)
 *   GET   /chats?account_id&account_type=LINKEDIN, GET /chats/:id/messages → history
 *   POST  /chats/:id/messages (multipart, `text`) → { message_id }
 *
 * Conversation id = Unipile chat_id. A message is ours when `is_sender` is true or
 * the sender's provider id equals the account's own user id.
 */
import type { ParsedInbound } from "./types";
import type { SendResult } from "./providers";
import { arr, num, obj, readResponseCapped, str, tryJson } from "./util";

export type UnipileCreds = { dsn: string; apiKey: string };
const TIMEOUT_MS = 15_000;

/** "api8.unipile.com:13851" (optionally with https://) → base URL. Only *.unipile.com hosts. */
export function unipileBase(dsn: string): string | null {
  const host = dsn.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return /^[a-z0-9-]+\.unipile\.com(:\d{2,5})?$/i.test(host) ? `https://${host}` : null;
}

type R = { ok: true; status: number; body: Record<string, unknown> } | { ok: false; status: number | null; error: string; retryable: boolean };

async function req(c: UnipileCreds, path: string, init: { method?: string; json?: unknown; form?: FormData; query?: Record<string, string> } = {}): Promise<R> {
  const base = unipileBase(c.dsn);
  if (!base) return { ok: false, status: null, error: "Invalid Unipile DSN.", retryable: false };
  const url = new URL(`${base}/api/v1/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.json !== undefined || init.form ? "POST" : "GET"),
      headers: { "X-API-KEY": c.apiKey, Accept: "application/json", ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
    const body = obj(tryJson((await readResponseCapped(res, 4 * 1024 * 1024))?.toString("utf8") ?? ""));
    if (res.ok) return { ok: true, status: res.status, body };
    const detail = str(body.detail) ?? str(body.title) ?? str(body.type) ?? `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: detail.slice(0, 300), retryable: res.status === 429 || res.status >= 500 };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, status: null, error: timeout ? "Unipile did not respond in time." : "Could not reach Unipile.", retryable: true };
  }
}

/** Hosted LinkedIn login link (expires; create one per click). */
export async function unipileHostedLink(c: UnipileCreds, input: { name: string; notifyUrl?: string | null; successUrl: string; failureUrl: string }): Promise<{ url: string } | { error: string }> {
  const base = unipileBase(c.dsn);
  const r = await req(c, "hosted/accounts/link", {
    json: {
      type: "create",
      providers: ["LINKEDIN"],
      api_url: base,
      expiresOn: new Date(Date.now() + 60 * 60_000).toISOString(),
      name: input.name,
      success_redirect_url: input.successUrl,
      failure_redirect_url: input.failureUrl,
      ...(input.notifyUrl ? { notify_url: input.notifyUrl } : {}),
    },
  });
  if (!r.ok) return { error: `Unipile: ${r.error}` };
  const url = str(r.body.url);
  return url && /^https:\/\//.test(url) ? { url } : { error: "Unipile did not return a login link." };
}

/** The LinkedIn account created by our hosted link (matched by `name` = channel id), newest first. */
export async function unipileFindAccount(c: UnipileCreds, name: string): Promise<{ id: string; userId: string | null; displayName: string | null } | null> {
  const r = await req(c, "accounts", { query: { limit: "250" } });
  if (!r.ok) return null;
  const items = arr(r.body.items).map(obj);
  const hit = items.filter((a) => str(a.name) === name && /linkedin/i.test(str(a.type) ?? "")).pop() ?? null;
  if (!hit) return null;
  const params = obj(obj(hit.connection_params).im);
  return { id: str(hit.id)!, userId: str(params.id) ?? str(params.publicIdentifier) ?? null, displayName: str(params.username) ?? str(hit.name) ?? null };
}

export async function unipileCreateWebhook(c: UnipileCreds, input: { requestUrl: string; secret: string; accountId: string; name: string }): Promise<{ id: string } | { error: string }> {
  const r = await req(c, "webhooks", {
    json: { request_url: input.requestUrl, source: "messaging", name: input.name, format: "json", account_ids: [input.accountId], enabled: true, events: ["message_received"], headers: [{ key: "X-Infera-Token", value: input.secret }] },
  });
  if (!r.ok) return { error: `Unipile webhook: ${r.error}` };
  return { id: str(r.body.webhook_id) ?? "" };
}

export async function unipileSend(c: UnipileCreds, input: { chatId: string; text: string; accountId?: string | null }): Promise<SendResult> {
  const form = new FormData();
  form.set("text", input.text);
  if (input.accountId) form.set("account_id", input.accountId);
  const r = await req(c, `chats/${encodeURIComponent(input.chatId)}/messages`, { form });
  if (r.ok) return { ok: true, providerMessageId: str(r.body.message_id) };
  return { ok: false, error: `LinkedIn (Unipile) rejected the message: ${r.error}`, retryable: r.retryable, status: r.status };
}

/* ------------------------------- Parsing -------------------------------- */

/** A `message_received` webhook event → Infera message. */
export function parseUnipileEvent(payload: unknown, accountId: string | null): ParsedInbound | null {
  const p = obj(payload);
  if (str(p.event) !== "message_received") return null;
  if (accountId && str(p.account_id) !== accountId) return null;
  const chatId = str(p.chat_id);
  const id = str(p.message_id);
  if (!chatId || !id) return null;
  const sender = obj(p.sender);
  const self = str(obj(p.account_info).user_id);
  const mine = p.is_sender === true || p.is_sender === 1 || (self !== null && str(sender.attendee_provider_id) === self);
  const attendees = arr(p.attendees).map(obj);
  const other = attendees.find((a) => str(a.attendee_provider_id) !== self) ?? (mine ? null : sender);
  const text = str(p.message) ?? "";
  const files = arr(p.attachments).map(obj).filter((a) => a.unavailable !== true);
  if (!text.trim() && !files.length) return null;
  const ts = Date.parse(str(p.timestamp) ?? "");
  const group = attendees.length > 2;
  return {
    externalId: id,
    direction: mine ? "outbound" : "inbound",
    conversation: { externalId: chatId, title: group ? null : (str(other?.attendee_name) ?? null), isGroup: group },
    sender: mine ? { isMe: true, name: "You" } : { externalId: str(sender.attendee_provider_id) ?? str(sender.attendee_id), name: str(sender.attendee_name) },
    kind: files.length && !text ? (/img|image/.test(str(files[0].type) ?? "") ? "image" : "document") : "text",
    text: text || files.map((f) => `[${str(f.type) ?? "file"}]`).join(" "),
    sentAt: Number.isFinite(ts) ? new Date(ts) : new Date(),
    source: "linkedin",
    raw: { provider: "unipile", accountType: str(p.account_type), profileUrl: mine ? null : str(sender.attendee_profile_url) },
  };
}

/** Recent LinkedIn chats + messages (history import), oldest first. */
export async function unipileHistory(c: UnipileCreds, input: { accountId: string; since: Date; maxChats?: number; perChat?: number }): Promise<{ messages: ParsedInbound[]; chats: number; error: string | null }> {
  const out: ParsedInbound[] = [];
  const maxChats = input.maxChats ?? 100;
  let chats = 0;
  let cursor: string | null = null;
  for (let page = 0; page < 10 && chats < maxChats; page++) {
    const r = await req(c, "chats", { query: { account_id: input.accountId, account_type: "LINKEDIN", limit: "50", after: input.since.toISOString(), ...(cursor ? { cursor } : {}) } });
    if (!r.ok) return { messages: out, chats, error: `LinkedIn (Unipile): ${r.error}` };
    for (const chat of arr(r.body.items).map(obj)) {
      if (chats >= maxChats) break;
      const chatId = str(chat.id);
      if (!chatId) continue;
      chats++;
      const title = str(chat.name);
      const mr = await req(c, `chats/${encodeURIComponent(chatId)}/messages`, { query: { limit: String(input.perChat ?? 50), after: input.since.toISOString() } });
      if (!mr.ok) continue;
      for (const m of arr(mr.body.items).map(obj)) {
        const id = str(m.id) ?? str(m.message_id);
        const ts = Date.parse(str(m.timestamp) ?? "");
        const text = str(m.text) ?? "";
        if (!id || !Number.isFinite(ts) || ts < input.since.getTime() || !text.trim() || m.deleted === true || m.is_event === true || m.is_event === 1) continue;
        const mine = m.is_sender === true || m.is_sender === 1;
        out.push({
          externalId: id,
          direction: mine ? "outbound" : "inbound",
          conversation: { externalId: chatId, title, isGroup: num(chat.type) === 1 },
          sender: mine ? { isMe: true, name: "You" } : { externalId: str(m.sender_id), name: title },
          text,
          sentAt: new Date(ts),
          historical: true,
          source: "linkedin",
          raw: { provider: "unipile", history: true },
        });
      }
    }
    cursor = str(r.body.cursor);
    if (!cursor) break;
  }
  out.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  return { messages: out, chats, error: null };
}
