/**
 * Plumbing shared by the public provider webhook routes (`app/api/webhooks/**`).
 *
 * Webhooks are not JSON-API routes: they read the raw body (needed for
 * signatures) with a size cap, verify before parsing, answer fast, and never
 * log payload contents. Errors are plain JSON; a 500 makes the provider retry,
 * which is safe because ingestion is idempotent.
 */
import { NextResponse } from "next/server";
import type { ChannelRow } from "../db/schema";
import { log } from "../http";
import { kickSoon } from "../jobs/kick";
import { rateLimit } from "../rate-limit";
import { ChannelNotFoundError, ingestInboundMessage } from "./ingest";
import { pendingMediaFor, scheduleMediaFetch, type PendingMedia } from "./media";
import type { Database } from "../db";
import type { ParsedInbound } from "./types";
import { BodyTooLargeError } from "./util";

export const WEBHOOK_MAX_BYTES = 1024 * 1024;
export const EMAIL_MAX_BYTES = 25 * 1024 * 1024;
/** Per-channel webhook rate limit. */
export const WEBHOOK_RATE = { limit: 600, windowSec: 60 };

const NO_STORE = { "Cache-Control": "no-store" };

export const webhookJson = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
export const webhookError = (status: number, code: string, message: string, headers: Record<string, string> = {}) => webhookJson({ error: { code, message } }, status, headers);
export const webhookText = (body: string, status = 200, contentType = "text/plain; charset=utf-8") => new NextResponse(body, { status, headers: { ...NO_STORE, "Content-Type": contentType } });

export const notFoundResponse = () => webhookError(404, "not_found", "Unknown webhook.");
export const badSignatureResponse = () => webhookError(401, "invalid_signature", "Signature verification failed.");

/** Applies the per-channel rate limit; returns a 429 response when exceeded. */
export async function channelRateLimit(channel: ChannelRow): Promise<Response | null> {
  const r = await rateLimit(`webhook:${channel.id}`, WEBHOOK_RATE.limit, WEBHOOK_RATE.windowSec);
  return r.ok ? null : webhookError(429, "rate_limited", "Too many requests.", { "Retry-After": String(r.retryAfter) });
}

/** Wraps a webhook handler: size errors → 413, anything unexpected → 500 (provider retries) with a PII-free log. */
export function webhookHandler<P>(name: string, fn: (req: Request, params: P) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      return await fn(req, ctx?.params ? await ctx.params : ({} as P));
    } catch (e) {
      if (e instanceof BodyTooLargeError) return webhookError(413, "too_large", "Request body is too large.");
      log("error", "webhook_error", { webhook: name, message: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) });
      return webhookError(500, "internal", "Webhook processing failed.");
    }
  };
}

export type IngestSummary = { received: number; ingested: number; duplicates: number };

/**
 * Ingests parsed messages for a channel, then schedules job processing and
 * media download after the response. Paused channels acknowledge but ignore.
 */
export async function ingestForChannel(db: Database, channel: ChannelRow, parsed: ParsedInbound[], webhook: string): Promise<IngestSummary> {
  const summary: IngestSummary = { received: parsed.length, ingested: 0, duplicates: 0 };
  if (!parsed.length || channel.status === "paused") return summary;
  const media: PendingMedia[] = [];
  for (const m of parsed) {
    try {
      const r = await ingestInboundMessage(db, { ...m, workspaceId: channel.workspaceId, channelId: channel.id });
      if (r.duplicate) summary.duplicates++;
      else summary.ingested++;
      const p = pendingMediaFor(channel.workspaceId, r, m);
      if (p) media.push(p);
    } catch (e) {
      if (e instanceof ChannelNotFoundError) break; // channel deleted mid-request
      throw e;
    }
  }
  if (summary.ingested) kickSoon();
  scheduleMediaFetch(channel, media);
  log("info", "webhook_ingested", { webhook, channelId: channel.id, ...summary });
  return summary;
}
