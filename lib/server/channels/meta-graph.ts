/**
 * Meta Graph API calls for Messenger / Instagram channels:
 * replies, customer names, attachment download, recent-history import and
 * (optional) webhook registration. All official Messenger Platform endpoints.
 *
 * Graph version: META_GRAPH_VERSION (default v21.0 — Meta serves calls to a
 * retired version from the oldest supported one).
 */
import { arr, num, obj, readResponseCapped, str, tryJson } from "./util";
import type { InboundAttachment, ParsedInbound } from "./types";
import { isMetaCdnUrl, type MetaPlatform } from "./adapters/meta";
import type { SendResult } from "./providers";

const TIMEOUT_MS = 10_000;
const graphBase = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v21.0"}`;

type GraphResult = { ok: true; status: number; body: Record<string, unknown> } | { ok: false; status: number | null; error: string; code: number | null; retryable: boolean };

async function graph(path: string, init: { method?: "GET" | "POST"; token: string; json?: unknown; query?: Record<string, string> }): Promise<GraphResult> {
  const url = new URL(path.startsWith("https://") ? path : `${graphBase()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${init.token}`, ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
    const body = obj(tryJson((await readResponseCapped(res, 4 * 1024 * 1024))?.toString("utf8") ?? ""));
    if (res.ok) return { ok: true, status: res.status, body };
    const err = obj(body.error);
    const code = num(err.code);
    return { ok: false, status: res.status, code, error: (str(err.message) ?? `HTTP ${res.status}`).replace(/\s+/g, " ").slice(0, 300), retryable: res.status === 429 || res.status >= 500 || code === 2 || code === 4 || code === 613 };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, status: null, code: null, error: timeout ? "Meta did not respond in time." : "Could not reach Meta.", retryable: true };
  }
}

const label = (p: MetaPlatform) => (p === "instagram" ? "Instagram" : "Messenger");

/* ------------------------------- Replies -------------------------------- */

/** Text reply to a customer (PSID / IGSID). Meta only allows replies within 24 h of the customer's last message. */
export async function sendMetaText(input: { pageAccessToken: string; recipientId: string; text: string; platform: MetaPlatform }): Promise<SendResult> {
  const r = await graph("me/messages", { method: "POST", token: input.pageAccessToken, json: { recipient: { id: input.recipientId }, messaging_type: "RESPONSE", message: { text: input.text } } });
  if (r.ok) return { ok: true, providerMessageId: str(r.body.message_id) };
  const window = r.code === 10 || /outside of allowed window|24 hour/i.test(r.error);
  return {
    ok: false,
    error: window ? `${label(input.platform)} only allows replies within 24 hours of the customer's last message.` : `${label(input.platform)} rejected the message${r.code ? ` (code ${r.code})` : ""}: ${r.error}`,
    retryable: r.retryable,
    status: r.status,
  };
}

/* -------------------------------- Names --------------------------------- */

const g = globalThis as unknown as { __inferaMetaNames?: Map<string, { name: string | null; at: number }> };
const nameCache = (g.__inferaMetaNames ??= new Map());
const NAME_TTL_MS = 24 * 3600_000;

/** Customer display names (webhooks carry only ids). Best effort, cached for a day, ≤ 10 lookups per call. */
export async function metaNames(input: { pageAccessToken: string; platform: MetaPlatform; ids: string[] }): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const now = Date.now();
  const todo: string[] = [];
  for (const id of input.ids) {
    const c = nameCache.get(id);
    if (c && now - c.at < NAME_TTL_MS) {
      if (c.name) out.set(id, c.name);
    } else todo.push(id);
  }
  await Promise.all(
    todo.slice(0, 10).map(async (id) => {
      const r = await graph(encodeURIComponent(id), { token: input.pageAccessToken, query: { fields: input.platform === "instagram" ? "name,username" : "first_name,last_name,name" } });
      const name = r.ok ? (str(r.body.name) ?? ([str(r.body.first_name), str(r.body.last_name)].filter(Boolean).join(" ") || (str(r.body.username) ? `@${str(r.body.username)}` : null))) : null;
      nameCache.set(id, { name, at: now });
      if (nameCache.size > 5000) nameCache.delete(nameCache.keys().next().value!);
      if (name) out.set(id, name);
    }),
  );
  return out;
}

/* -------------------------------- Media --------------------------------- */

/** Attachment bytes from Meta's CDN (signed URLs; only Meta hosts are fetched). */
export async function fetchMetaCdn(url: string, maxBytes: number): Promise<{ data: Buffer; mime: string | null } | null> {
  if (!isMetaCdnUrl(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store", redirect: "follow" });
    if (!res.ok || !isMetaCdnUrl(res.url)) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) return null;
    const data = await readResponseCapped(res, maxBytes);
    return data ? { data, mime: res.headers.get("content-type")?.split(";")[0] ?? null } : null;
  } catch {
    return null;
  }
}

/* ------------------------------- History -------------------------------- */

export type MetaHistory = { messages: ParsedInbound[]; conversations: number; error: string | null };

/**
 * Recent conversations of a Page (Messenger) or its linked Instagram account, newest first:
 * up to `maxConversations` conversations × `perConversation` messages, no older than `since`.
 * `accountId` = the Page id (Messenger) or Instagram account id — messages from it are outbound.
 */
export async function fetchMetaHistory(input: { pageId: string; accountId: string; pageAccessToken: string; platform: MetaPlatform; since: Date; maxConversations?: number; perConversation?: number }): Promise<MetaHistory> {
  const maxConv = input.maxConversations ?? 100;
  const per = input.perConversation ?? 50;
  const out: ParsedInbound[] = [];
  let conversations = 0;
  let next: string | null = null;
  const fields = `participants,updated_time,messages.limit(${per}){id,created_time,from,to,message,attachments{mime_type,name,image_data,video_data,file_url}}`;
  for (let page = 0; page < 10 && conversations < maxConv; page++) {
    const r: GraphResult = next
      ? await graph(next, { token: input.pageAccessToken })
      : await graph(`${encodeURIComponent(input.pageId)}/conversations`, { token: input.pageAccessToken, query: { platform: input.platform, fields, limit: "25" } });
    if (!r.ok) return { messages: out, conversations, error: `${label(input.platform)}: ${r.error}` };
    const data = arr(r.body.data).map(obj);
    let reachedOld = false;
    for (const conv of data) {
      if (conversations >= maxConv) break;
      const updated = Date.parse(str(conv.updated_time) ?? "");
      if (Number.isFinite(updated) && updated < input.since.getTime()) {
        reachedOld = true;
        break;
      }
      conversations++;
      const participants = arr(obj(conv.participants).data).map(obj);
      const customer = participants.find((p) => str(p.id) !== input.accountId && str(p.id) !== input.pageId);
      const customerId = str(customer?.id);
      if (!customerId) continue;
      const customerName = str(customer?.name) ?? (str(customer?.username) ? `@${str(customer?.username)}` : null);
      for (const m of arr(obj(conv.messages).data).map(obj)) {
        const id = str(m.id);
        const at = Date.parse(str(m.created_time) ?? "");
        if (!id || !Number.isFinite(at) || at < input.since.getTime()) continue;
        const fromId = str(obj(m.from).id);
        const outbound = fromId === input.accountId || fromId === input.pageId;
        const attachments: InboundAttachment[] = arr(obj(m.attachments).data).flatMap((a) => {
          const at_ = obj(a);
          const url = str(obj(at_.image_data).url) ?? str(obj(at_.video_data).url) ?? str(at_.file_url);
          if (!url || !isMetaCdnUrl(url)) return [];
          return [{ name: str(at_.name) ?? `attachment-${id.slice(-8)}`, mime: str(at_.mime_type) ?? "application/octet-stream", url, providerId: url }];
        });
        const text = str(m.message) ?? "";
        if (!text.trim() && !attachments.length) continue;
        out.push({
          externalId: id,
          direction: outbound ? "outbound" : "inbound",
          conversation: { externalId: customerId, title: customerName, isGroup: false },
          sender: outbound ? { isMe: true, name: "You" } : { externalId: customerId, name: customerName },
          kind: attachments[0] ? (attachments[0].mime.startsWith("image/") ? "image" : attachments[0].mime.startsWith("video/") ? "video" : attachments[0].mime.startsWith("audio/") ? "audio" : "document") : "text",
          text,
          attachments,
          sentAt: new Date(at),
          historical: true,
          raw: { provider: input.platform, history: true },
        });
      }
    }
    next = str(obj(r.body.paging).next);
    if (!next || reachedOld || !next.startsWith("https://graph.facebook.com/")) break;
  }
  // Oldest first, so contacts and conversations form in order.
  out.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  return { messages: out, conversations, error: null };
}

/** Instagram professional account linked to a Page (null if none). */
export async function instagramAccountOf(pageId: string, pageAccessToken: string): Promise<string | null> {
  const r = await graph(encodeURIComponent(pageId), { token: pageAccessToken, query: { fields: "instagram_business_account" } });
  return r.ok ? str(obj(r.body.instagram_business_account).id) : null;
}

/* ------------------------- Webhook registration ------------------------- */

export type MetaRegistration = { ok: boolean; steps: { step: string; ok: boolean; error?: string }[] };

/**
 * Points the Meta app's webhook at this channel and subscribes the Page to it:
 *   POST /{app-id}/subscriptions (app token) → Meta calls our GET verify endpoint (needs a public HTTPS URL)
 *   POST /{page-id}/subscribed_apps (page token)
 */
export async function registerMetaWebhook(input: { appId: string; appSecret: string; pageId: string; pageAccessToken: string; callbackUrl: string; verifyToken: string; platform: MetaPlatform }): Promise<MetaRegistration> {
  const steps: MetaRegistration["steps"] = [];
  const appToken = `${input.appId}|${input.appSecret}`;
  const fields = input.platform === "instagram" ? "messages,messaging_postbacks" : "messages,message_echoes,messaging_postbacks";
  const sub = await graph(`${encodeURIComponent(input.appId)}/subscriptions`, {
    method: "POST",
    token: appToken,
    query: { object: input.platform === "instagram" ? "instagram" : "page", callback_url: input.callbackUrl, verify_token: input.verifyToken, fields, include_values: "true" },
  });
  steps.push({ step: "app_webhook", ok: sub.ok, ...(sub.ok ? {} : { error: sub.error }) });
  const page = await graph(`${encodeURIComponent(input.pageId)}/subscribed_apps`, { method: "POST", token: input.pageAccessToken, query: { subscribed_fields: "messages,message_echoes,messaging_postbacks" } });
  steps.push({ step: "page_subscription", ok: page.ok, ...(page.ok ? {} : { error: page.error }) });
  return { ok: steps.every((s) => s.ok), steps };
}
