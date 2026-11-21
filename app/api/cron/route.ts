/**
 * GET|POST /api/cron — periodic work for serverless deployments (e.g. Vercel Cron).
 *
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Enqueues the scheduled jobs (hourly schedule tick, daily retention sweep; deduplicated
 * across instances) and drains the job queue for up to 25 s → { ran }.
 * 401 for a missing/wrong secret; 503 when CRON_SECRET isn't configured in production
 * (outside production an unset secret also yields 401 — the endpoint is never open).
 */
import { publicRoute, unauthorized, unavailable } from "@/lib/server/api/handler";
import { safeEqual, sha256Hex } from "@/lib/server/crypto";
import { cronSecret } from "@/lib/server/env";
import { drainJobs } from "@/lib/server/jobs/queue";
import { enqueueScheduledJobs } from "@/lib/server/jobs/scheduler";
import { log } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = publicRoute({ rateLimit: { limit: 30, windowSec: 60 } }, async (c) => {
  const secret = cronSecret();
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw unavailable("Cron is not configured. Set CRON_SECRET.");
    throw unauthorized("Invalid cron secret.");
  }
  const header = c.req.headers.get("authorization") ?? "";
  // Hash both sides so the comparison is constant-time regardless of length.
  if (!safeEqual(sha256Hex(header), sha256Hex(`Bearer ${secret}`))) throw unauthorized("Invalid cron secret.");

  const started = Date.now();
  await enqueueScheduledJobs();
  const ran = await drainJobs({ budgetMs: 25_000 });
  log("info", "cron_run", { ran, ms: Date.now() - started });
  return { ran };
});

export const GET = handler;
export const POST = handler;
