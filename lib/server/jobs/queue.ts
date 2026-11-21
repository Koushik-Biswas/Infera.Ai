/**
 * Durable job queue on Postgres (no Redis needed).
 *
 * - enqueue() inside a transaction → the job exists iff the transaction commits.
 * - Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so any number of server
 *   instances can run them concurrently without double-processing.
 * - Failed jobs retry with exponential backoff; after `maxAttempts` they are
 *   marked "dead" (kept for inspection). Crashed workers' jobs are reclaimed
 *   once their lock expires.
 *
 * Where jobs run:
 *  - long-running server (Docker, VM): startWorker() from instrumentation.ts polls every second;
 *  - serverless: webhook routes call kickJobs() via `after()`, and /api/cron drains the queue.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, getDbState, type Database } from "../db";
import { jobs, type JobRow } from "../db/schema";

export const JOB_TYPES = [
  "process_message",
  "domain_event",
  "deliver_webhook",
  "send_reply",
  "reminder",
  "retention_sweep",
  "schedule_tick",
  "backfill_collection",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type JobHandler = (payload: Record<string, unknown>, job: JobRow) => Promise<void>;

/** Throw this from a handler to fail permanently (no retry). */
export class PermanentJobError extends Error {}

export type EnqueueInput = {
  type: JobType;
  payload: Record<string, unknown>;
  workspaceId?: string | null;
  runAt?: Date;
  /** Lower runs first. Default 100; interactive work uses 10-50, bulk backfills 200+. */
  priority?: number;
  maxAttempts?: number;
  /** Idempotency key — a second enqueue with the same key is ignored (returns null). */
  dedupeKey?: string;
};

export async function enqueue(db: Database, input: EnqueueInput): Promise<number | null> {
  const rows = await db
    .insert(jobs)
    .values({
      type: input.type,
      payload: input.payload,
      workspaceId: input.workspaceId ?? null,
      runAt: input.runAt ?? new Date(),
      priority: input.priority ?? 100,
      maxAttempts: input.maxAttempts ?? 5,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  const id = rows[0]?.id ?? null;
  // Wake idle workers immediately (delivered on commit). Delayed jobs are left to the poller.
  if (id !== null && (!input.runAt || input.runAt.getTime() <= Date.now())) {
    await db.execute(sql`select pg_notify(${JOBS_CHANNEL}, ${input.type})`);
  }
  return id;
}

export const JOBS_CHANNEL = "infera_jobs";

const LOCK_SECONDS = 300;
const backoffMs = (attempt: number) => Math.min(3_600_000, 5_000 * 2 ** Math.max(0, attempt - 1));

async function claim(db: Database, max: number, workerId: string, types?: readonly JobType[]): Promise<JobRow[]> {
  const typeFilter = types?.length ? sql`and type in (${sql.join(types.map((t) => sql`${t}`), sql`, `)})` : sql``;
  const result = await db.execute(sql`
    update jobs set status = 'running', attempts = attempts + 1, locked_by = ${workerId},
      locked_until = now() + make_interval(secs => ${LOCK_SECONDS}), updated_at = now()
    where id in (
      select id from jobs
      where ((status = 'queued' and run_at <= now()) or (status = 'running' and locked_until < now()))
      ${typeFilter}
      order by priority, run_at
      limit ${max}
      for update skip locked
    )
    returning id`);
  const ids = (result as unknown as { rows: { id: number | string }[] }).rows.map((r) => Number(r.id));
  if (!ids.length) return [];
  const rows = await db.query.jobs.findMany({ where: (j, { inArray }) => inArray(j.id, ids) });
  return rows.sort((a, b) => a.priority - b.priority || a.runAt.getTime() - b.runAt.getTime());
}

async function finish(db: Database, job: JobRow, error: unknown) {
  if (!error) {
    await db
      .update(jobs)
      .set({ status: "done", finishedAt: new Date(), lockedUntil: null, lockedBy: null, lastError: null, updatedAt: new Date() })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")));
    return;
  }
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  const dead = error instanceof PermanentJobError || job.attempts >= job.maxAttempts;
  await db
    .update(jobs)
    .set(
      dead
        ? { status: "dead", finishedAt: new Date(), lockedUntil: null, lockedBy: null, lastError: message, updatedAt: new Date() }
        : { status: "queued", runAt: new Date(Date.now() + backoffMs(job.attempts)), lockedUntil: null, lockedBy: null, lastError: message, updatedAt: new Date() },
    )
    .where(eq(jobs.id, job.id));
  console.error(JSON.stringify({ level: dead ? "error" : "warn", event: dead ? "job_dead" : "job_retry", jobId: job.id, type: job.type, attempt: job.attempts, message }));
}

/**
 * Claims and runs up to `max` due jobs concurrently. Returns how many ran.
 * Safe to call from many places at once.
 */
export async function runDueJobs(opts: { max?: number; workerId?: string; types?: readonly JobType[] } = {}): Promise<{ ran: number; failed: number }> {
  const db = await getDb();
  const workerId = opts.workerId ?? `w-${process.pid}`;
  const claimed = await claim(db, opts.max ?? 10, workerId, opts.types);
  if (!claimed.length) return { ran: 0, failed: 0 };
  const { handlers } = await import("./registry");
  let failed = 0;
  await Promise.all(
    claimed.map(async (job) => {
      const handler = handlers[job.type as JobType];
      let error: unknown = null;
      try {
        if (!handler) throw new PermanentJobError(`No handler for job type "${job.type}"`);
        await handler(job.payload, job);
      } catch (e) {
        error = e ?? new Error("Job failed");
        failed++;
      }
      await finish(db, job, error).catch((e) => console.error(JSON.stringify({ level: "error", event: "job_finish_failed", jobId: job.id, message: String(e) })));
    }),
  );
  return { ran: claimed.length, failed };
}

/** Drain the queue until empty or `budgetMs` elapses (cron / tests). */
export async function drainJobs(opts: { budgetMs?: number; batch?: number; types?: readonly JobType[] } = {}): Promise<number> {
  const deadline = Date.now() + (opts.budgetMs ?? 25_000);
  let total = 0;
  while (Date.now() < deadline) {
    const { ran } = await runDueJobs({ max: opts.batch ?? 10, types: opts.types });
    if (!ran) break;
    total += ran;
  }
  return total;
}

/** Fire-and-forget: process freshly enqueued work now instead of waiting for the poller. */
export function kickJobs(max = 5): Promise<void> {
  return runDueJobs({ max })
    .then(() => undefined)
    .catch((e) => console.error(JSON.stringify({ level: "error", event: "kick_jobs_failed", message: String(e) })));
}

/* ----------------------------- Worker loop ---------------------------- */

const g = globalThis as unknown as { __inferaWorker?: { stop: () => void } };

/**
 * Starts one worker per process (idempotent). It wakes instantly on
 * `pg_notify('infera_jobs')` from enqueue(), and polls every `intervalMs` as a
 * fallback (delayed jobs, retries, notifications missed during reconnects).
 */
export function startWorker(opts: { intervalMs?: number; concurrency?: number } = {}) {
  if (g.__inferaWorker) return g.__inferaWorker;
  let stopped = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const interval = opts.intervalMs ?? 2000;
  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void tick(), ms);
  };
  const tick = async () => {
    if (stopped) return;
    if (running) {
      again = true; // a wake-up arrived mid-run: go again right after
      return;
    }
    running = true;
    let ran = 0;
    try {
      ran = (await runDueJobs({ max: opts.concurrency ?? 8, workerId: `worker-${process.pid}` })).ran;
    } catch (e) {
      console.error(JSON.stringify({ level: "error", event: "worker_tick_failed", message: String(e) }));
    } finally {
      running = false;
    }
    const more = ran > 0 || again;
    again = false;
    schedule(more ? 0 : interval);
  };
  schedule(250);
  let unlisten: (() => Promise<void>) | null = null;
  void getDbState()
    .then((s) => s.listen(JOBS_CHANNEL, () => schedule(0)))
    .then((u) => {
      if (stopped) void u();
      else unlisten = u;
    })
    .catch((e) => console.warn(JSON.stringify({ level: "warn", event: "worker_listen_failed", message: String(e) })));
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    void unlisten?.();
  };
  g.__inferaWorker = { stop };
  console.info(JSON.stringify({ level: "info", event: "worker_started", pid: process.pid }));
  return g.__inferaWorker;
}

export function stopWorker() {
  g.__inferaWorker?.stop();
  g.__inferaWorker = undefined;
}
