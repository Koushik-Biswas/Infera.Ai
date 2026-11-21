/**
 * Monthly usage metering per workspace (shown in Analytics; basis for plan limits).
 * Metrics: messages_ingested, events_processed, ai_calls, ai_input_tokens,
 * ai_output_tokens, records_created, records_updated, automations_run, webhooks_delivered.
 */
import { sql } from "drizzle-orm";
import { getDb, type Database } from "./db";
import { usageCounters } from "./db/schema";

export const period = (d = new Date()) => d.toISOString().slice(0, 7);

export async function bumpUsage(workspaceId: string, metrics: Record<string, number>, db?: Database): Promise<void> {
  const entries = Object.entries(metrics).filter(([, v]) => v);
  if (!entries.length) return;
  const conn = db ?? (await getDb());
  const p = period();
  await conn
    .insert(usageCounters)
    .values(entries.map(([metric, value]) => ({ workspaceId, period: p, metric, value })))
    .onConflictDoUpdate({
      target: [usageCounters.workspaceId, usageCounters.period, usageCounters.metric],
      set: { value: sql`${usageCounters.value} + excluded.value` },
    });
}

export async function getUsage(workspaceId: string, p = period(), db?: Database): Promise<Record<string, number>> {
  const conn = db ?? (await getDb());
  const rows = await conn.query.usageCounters.findMany({ where: (u, { and, eq }) => and(eq(u.workspaceId, workspaceId), eq(u.period, p)) });
  return Object.fromEntries(rows.map((r) => [r.metric, Number(r.value)]));
}
