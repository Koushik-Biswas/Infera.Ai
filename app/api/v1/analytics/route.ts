/**
 * GET /api/v1/analytics?days=7|30|90 (viewer / API read) → AnalyticsDTO
 * SQL aggregates only (no message text). Collections' valueSum = sum of their first currency field.
 */
import { and, count, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { AnalyticsDTO, Category, Priority, Source } from "@/lib/shared/types";
import { workspaceRoute } from "@/lib/server/api/handler";
import { collections, contacts, events, messages, records, reviewItems } from "@/lib/server/db/schema";
import { collectionStats as collectionStatsFor } from "@/lib/server/data/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute({ role: "viewer", scope: "read" }, async (c) => {
  const days = [7, 30, 90].includes(Number(c.query.get("days"))) ? Number(c.query.get("days")) : 30;
  const ws = c.auth.workspaceId;
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - days + 1));
  const n = (v: unknown) => Number(v ?? 0);

  const [[msgs], evStatus, [recCreated], [recUpdated], [openRev], [ctc], msgDays, recDays, cats, prios, sources, cols, latency] = await Promise.all([
    c.db.select({ n: count() }).from(messages).where(and(eq(messages.workspaceId, ws), gte(messages.sentAt, from))),
    c.db
      .select({ status: events.status, n: count() })
      .from(events)
      .where(and(eq(events.workspaceId, ws), gte(events.createdAt, from)))
      .groupBy(events.status),
    c.db.select({ n: count() }).from(records).where(and(eq(records.workspaceId, ws), isNull(records.deletedAt), gte(records.createdAt, from))),
    c.db.select({ n: count() }).from(records).where(and(eq(records.workspaceId, ws), isNull(records.deletedAt), gte(records.updatedAt, from), sql`${records.version} > 1`)),
    c.db.select({ n: count() }).from(reviewItems).where(and(eq(reviewItems.workspaceId, ws), eq(reviewItems.status, "open"))),
    c.db.select({ n: count() }).from(contacts).where(eq(contacts.workspaceId, ws)),
    c.db
      .select({ d: sql<string>`to_char(date_trunc('day', ${messages.sentAt} at time zone 'UTC'), 'YYYY-MM-DD')`, n: count() })
      .from(messages)
      .where(and(eq(messages.workspaceId, ws), gte(messages.sentAt, from)))
      .groupBy(sql`1`),
    c.db
      .select({ d: sql<string>`to_char(date_trunc('day', ${records.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`, n: count() })
      .from(records)
      .where(and(eq(records.workspaceId, ws), isNull(records.deletedAt), gte(records.createdAt, from)))
      .groupBy(sql`1`),
    c.db
      .select({ k: sql<string>`${messages.classification} ->> 'category'`, n: count() })
      .from(messages)
      .where(and(eq(messages.workspaceId, ws), gte(messages.sentAt, from), isNotNull(messages.classification)))
      .groupBy(sql`1`),
    c.db
      .select({ k: sql<string>`${messages.classification} ->> 'priority'`, n: count() })
      .from(messages)
      .where(and(eq(messages.workspaceId, ws), gte(messages.sentAt, from), isNotNull(messages.classification)))
      .groupBy(sql`1`),
    c.db
      .select({ k: events.source, n: count() })
      .from(events)
      .where(and(eq(events.workspaceId, ws), gte(events.createdAt, from)))
      .groupBy(events.source),
    c.db
      .select()
      .from(collections)
      .where(and(eq(collections.workspaceId, ws), isNull(collections.archivedAt)))
      .limit(50),
    c.db
      .select({
        avg: sql<number | null>`avg(${events.durationMs})::float8`,
        p95: sql<number | null>`percentile_cont(0.95) within group (order by ${events.durationMs})::float8`,
        ai: sql<number>`count(*) filter (where ${events.model} is not null)::int`,
        done: sql<number>`count(*)::int`,
      })
      .from(events)
      .where(and(eq(events.workspaceId, ws), gte(events.createdAt, from), isNotNull(events.durationMs))),
  ]);

  const status = Object.fromEntries(evStatus.map((r) => [r.status, n(r.n)]));
  const byMsgDay = new Map(msgDays.map((r) => [r.d, n(r.n)]));
  const byRecDay = new Map(recDays.map((r) => [r.d, n(r.n)]));
  const byDay: AnalyticsDTO["byDay"] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    byDay.push({ date: d, messages: byMsgDay.get(d) ?? 0, records: byRecDay.get(d) ?? 0 });
  }

  // Two grouped queries for all collections (was two queries per collection).
  const stats = await collectionStatsFor(c.db, ws, cols);
  const collectionStats: AnalyticsDTO["collections"] = cols.map((col) => {
    const s = stats.get(col.id)!;
    return { id: col.id, name: col.name, icon: col.icon, records: s.records, valueSum: s.valueSum, byStatus: s.byStatus };
  });

  const processed = status.processed ?? 0;
  const review = status.needs_review ?? 0;
  const lat = latency[0];
  const result: AnalyticsDTO = {
    range: { from: from.toISOString(), to: to.toISOString(), days },
    totals: { messages: n(msgs?.n), processed, needsReview: review, failed: status.failed ?? 0, recordsCreated: n(recCreated?.n), recordsUpdated: n(recUpdated?.n), openReviews: n(openRev?.n), contacts: n(ctc?.n) },
    byDay,
    byCategory: cats.filter((r) => r.k).map((r) => ({ category: r.k as Category, count: n(r.n) })).sort((a, b) => b.count - a.count),
    byPriority: prios.filter((r) => r.k).map((r) => ({ priority: r.k as Priority, count: n(r.n) })),
    bySource: sources.map((r) => ({ source: r.k as Source, count: n(r.n) })).sort((a, b) => b.count - a.count),
    collections: collectionStats,
    pipeline: {
      avgLatencyMs: lat?.avg != null ? Math.round(lat.avg) : null,
      p95LatencyMs: lat?.p95 != null ? Math.round(lat.p95) : null,
      aiShare: lat?.done ? lat.ai / lat.done : 0,
      autoApplyRate: processed + review ? processed / (processed + review) : 0,
    },
  };
  return result;
});
