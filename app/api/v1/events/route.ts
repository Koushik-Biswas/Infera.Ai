/**
 * POST /api/v1/events — ingest a message from any source (API key scope "ingest", or a member session).
 *   { channel_id?, source?, conversation: { id, name?, is_group? }, sender: { id?, name?, phone?, email?, is_me? },
 *     message: { id, text, sent_at?, direction?, attachments?: [{ name, mime, url?, size? }] } }
 *   (camelCase aliases channelId / isGroup / isMe / sentAt are accepted too)
 *   → 202 { event_id, message_id, conversation_id, status: "queued" }
 *   → 200 { …, status: "duplicate" } when (channel, message.id) was already ingested.
 *   ?sync=1 → processes inline (≤ 25 s) and returns `{ …, status: result.status, result: ProcessingResult }`.
 *   Without channel_id the workspace's default "API" channel is used (created on demand).
 *
 * GET /api/v1/events?status=&source=&since=&until=&messageId=&cursor=&limit= (viewer / API read) → Page<EventDTO>
 */
import { z } from "zod";
import { and, desc, eq, gte, lt, lte, or, type SQL } from "drizzle-orm";
import { EVENT_STATUSES, SOURCES, type EventDTO, type ProcessingResult } from "@/lib/shared/types";
import { conflict, decodeCursor, encodeCursor, jsonResponse, notFound, pageLimit, unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { events, type EventRow } from "@/lib/server/db/schema";
import { log } from "@/lib/server/http";
import { kickSoon } from "@/lib/server/jobs/kick";
import { processEvent } from "@/lib/server/pipeline/run";
import { ingestInboundMessage, MAX_TEXT_CHARS } from "@/lib/server/channels/ingest";
import { ensureApiChannel, getWorkspaceChannel } from "@/lib/server/channels/registry";
import { parseTimestamp } from "@/lib/server/channels/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYNC_TIMEOUT_MS = 25_000;
/** With ?sync=1 the durable job is a fallback that runs only after the inline attempt had time to finish. */
const SYNC_JOB_DELAY_MS = 120_000;

/* ------------------------------- Mapping ------------------------------- */

function toEventDTO(r: EventRow): EventDTO {
  return {
    id: r.id,
    messageId: r.messageId,
    source: r.source,
    status: r.status,
    attempts: r.attempts,
    result: r.result ?? null,
    error: r.error,
    durationMs: r.durationMs,
    model: r.model,
    createdAt: r.createdAt.toISOString(),
    processedAt: r.processedAt ? r.processedAt.toISOString() : null,
  };
}

/* -------------------------------- Ingest ------------------------------- */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Accepts camelCase aliases for the documented snake_case keys. */
function alias(v: unknown, map: Record<string, string>): unknown {
  if (!isObj(v)) return v;
  const out = { ...v };
  for (const [from, to] of Object.entries(map)) {
    if (out[to] === undefined && out[from] !== undefined) out[to] = out[from];
    delete out[from];
  }
  return out;
}

const idLike = z
  .union([z.string(), z.number().int()])
  .transform((v) => String(v).trim())
  .pipe(z.string().min(1, "is required").max(200));

const Attachment = z.object({
  name: z.string().trim().min(1).max(255),
  mime: z.string().trim().max(200).optional(),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => /^https?:\/\/[^\s]+$/i.test(u), "must be an http(s) URL")
    .optional(),
  size: z.number().int().min(0).optional(),
});

const Body = z.preprocess(
  (v) => {
    const top = alias(v, { channelId: "channel_id" });
    if (!isObj(top)) return top;
    return {
      ...top,
      conversation: alias(top.conversation, { isGroup: "is_group" }),
      sender: alias(top.sender, { isMe: "is_me" }),
      message: alias(top.message, { sentAt: "sent_at" }),
    };
  },
  z.object({
    channel_id: z.string().trim().min(1).max(64).optional(),
    source: z.enum(SOURCES).optional(),
    conversation: z.object({ id: idLike, name: z.string().max(200).optional(), is_group: z.boolean().optional() }),
    sender: z
      .object({
        id: idLike.optional(),
        name: z.string().max(200).optional(),
        phone: z.string().max(40).optional(),
        email: z.string().max(320).optional(),
        is_me: z.boolean().optional(),
      })
      .default({}),
    message: z
      .object({
        id: idLike,
        text: z.string().max(MAX_TEXT_CHARS, `must be at most ${MAX_TEXT_CHARS} characters`).default(""),
        sent_at: z.union([z.string().max(64), z.number()]).optional(),
        direction: z.enum(["inbound", "outbound"]).optional(),
        attachments: z.array(Attachment).max(10).optional(),
      })
      .refine((m) => m.text.trim().length > 0 || (m.attachments?.length ?? 0) > 0, "message.text or message.attachments is required"),
  }),
);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), ms)))]).finally(() => clearTimeout(timer));
}

export const POST = workspaceRoute({ role: "member", scope: "ingest", maxBodyBytes: 512 * 1024, rateLimit: { limit: 1200, windowSec: 60 } }, async (c) => {
  const body = await c.body(Body);
  const sync = ["1", "true"].includes(c.query.get("sync") ?? "");

  let sentAt = new Date();
  if (body.message.sent_at !== undefined) {
    const d = parseTimestamp(body.message.sent_at);
    if (!d) throw unprocessable("message.sent_at must be an ISO-8601 date or a unix timestamp.", [{ path: "message.sent_at", message: "invalid date" }]);
    sentAt = d;
  }

  const channel = body.channel_id ? await getWorkspaceChannel(c.db, c.auth.workspaceId, body.channel_id) : await ensureApiChannel(c.db, c.auth.workspaceId);
  if (!channel) throw notFound("Channel");
  if (channel.type !== "api") throw unprocessable("Events can only be posted to API channels. Omit channel_id to use the default API channel.");
  if (channel.status === "paused") throw conflict("This channel is paused.");

  const r = await ingestInboundMessage(c.db, {
    workspaceId: c.auth.workspaceId,
    channelId: channel.id,
    externalId: body.message.id,
    direction: body.message.direction ?? (body.sender.is_me ? "outbound" : "inbound"),
    conversation: { externalId: body.conversation.id, title: body.conversation.name ?? null, isGroup: body.conversation.is_group ?? false },
    sender: { externalId: body.sender.id ?? null, name: body.sender.name ?? null, phone: body.sender.phone ?? null, email: body.sender.email ?? null, isMe: body.sender.is_me ?? false },
    text: body.message.text,
    attachments: body.message.attachments?.map((a) => ({ name: a.name, mime: a.mime ?? "application/octet-stream", url: a.url ?? null, size: a.size ?? null })),
    sentAt,
    actor: c.auth.actor,
    source: body.source,
    processAt: sync ? new Date(Date.now() + SYNC_JOB_DELAY_MS) : undefined,
    raw: { provider: "api", source: body.source ?? null, conversationName: body.conversation.name ?? null },
  });
  kickSoon();

  const ids = { event_id: r.eventId, message_id: r.messageId, conversation_id: r.conversationId };
  if (r.duplicate) {
    if (!sync || !r.eventId) return { ...ids, status: "duplicate" };
    const ev = await c.db.query.events.findFirst({ where: (e, { and: a, eq: e2 }) => a(e2(e.id, r.eventId!), e2(e.workspaceId, c.auth.workspaceId)) });
    return { ...ids, status: "duplicate", result: ev?.result ?? null };
  }
  if (!sync || !r.eventId) return jsonResponse({ ...ids, status: "queued" }, 202);

  let outcome: ProcessingResult | "timeout" | "error";
  try {
    outcome = await withTimeout(processEvent(r.eventId), SYNC_TIMEOUT_MS);
  } catch (e) {
    log("warn", "sync_processing_failed", { eventId: r.eventId, message: e instanceof Error ? e.message.slice(0, 200) : "error" });
    outcome = "error";
  }
  if (outcome === "timeout" || outcome === "error") {
    return jsonResponse({ ...ids, status: "queued", result: null, warning: outcome === "timeout" ? "Processing is taking longer than 25 s; it continues in the background." : "Processing did not complete; it will be retried in the background." }, 202);
  }
  return { ...ids, status: outcome.status, result: outcome };
});

/* --------------------------------- List -------------------------------- */

export const GET = workspaceRoute({ role: "viewer", scope: "read" }, async (c) => {
  const q = c.query;
  const limit = pageLimit(q);
  const where: SQL[] = [eq(events.workspaceId, c.auth.workspaceId)];

  const status = q.get("status");
  if (status) {
    const parsed = z.enum(EVENT_STATUSES).safeParse(status);
    if (!parsed.success) throw unprocessable(`status must be one of ${EVENT_STATUSES.join(", ")}.`);
    where.push(eq(events.status, parsed.data));
  }
  const source = q.get("source");
  if (source) {
    const parsed = z.enum(SOURCES).safeParse(source);
    if (!parsed.success) throw unprocessable(`source must be one of ${SOURCES.join(", ")}.`);
    where.push(eq(events.source, parsed.data));
  }
  for (const [key, op] of [
    ["since", gte],
    ["until", lte],
  ] as const) {
    const v = q.get(key);
    if (!v) continue;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw unprocessable(`${key} must be an ISO-8601 date.`);
    where.push(op(events.createdAt, d));
  }
  const messageId = q.get("messageId");
  if (messageId) where.push(eq(events.messageId, messageId.slice(0, 64)));
  const cursor = decodeCursor(q.get("cursor"));
  if (q.get("cursor") && !cursor) throw unprocessable("Invalid cursor.");
  if (cursor) where.push(or(lt(events.createdAt, cursor.at), and(eq(events.createdAt, cursor.at), lt(events.id, cursor.id)))!);

  const rows = await c.db
    .select()
    .from(events)
    .where(and(...where))
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page.map(toEventDTO), nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
});
