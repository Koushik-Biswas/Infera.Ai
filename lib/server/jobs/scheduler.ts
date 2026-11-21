/**
 * Periodic work. Enqueues at most one job per period across ALL instances
 * (dedupe keys), so it is safe to run on every server and from /api/cron.
 */
import { getDb } from "../db";
import { enqueue } from "./queue";

export async function enqueueScheduledJobs(now = new Date()): Promise<void> {
  const db = await getDb();
  const minute = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  // Hourly: schedule.daily automations check their hour in the workspace timezone; reminders are their own jobs.
  await enqueue(db, { type: "schedule_tick", payload: { at: `${hour}:00` }, dedupeKey: `tick:${hour}`, priority: 150 });
  await enqueue(db, { type: "retention_sweep", payload: { day }, dedupeKey: `retention:${day}`, priority: 250, runAt: now });
  void minute;
}

const g = globalThis as unknown as { __inferaScheduler?: ReturnType<typeof setInterval> };

export function startScheduler(intervalMs = 60_000) {
  if (g.__inferaScheduler) return;
  const run = () => enqueueScheduledJobs().catch((e) => console.error(JSON.stringify({ level: "error", event: "scheduler_failed", message: String(e) })));
  void run();
  g.__inferaScheduler = setInterval(run, intervalMs);
  g.__inferaScheduler.unref?.();
}
