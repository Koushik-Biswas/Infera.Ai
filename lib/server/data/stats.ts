/**
 * Per-collection record stats in two grouped queries (instead of two queries per collection):
 * total records, the sum of the first currency field, and counts by status.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "../db";
import { records, type CollectionRow } from "../db/schema";

const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

export type CollectionStats = { records: number; valueSum: number | null; valueLabel: string | null; byStatus: { status: string; count: number }[] };

export async function collectionStats(db: Database, workspaceId: string, cols: Pick<CollectionRow, "id" | "fields">[]): Promise<Map<string, CollectionStats>> {
  const out = new Map<string, CollectionStats>();
  if (!cols.length) return out;
  const ids = cols.map((c) => c.id);
  const money = new Map<string, { key: string; label: string }>();
  for (const c of cols) {
    const f = c.fields.find((x) => x.type === "currency" && KEY_RE.test(x.key));
    if (f) money.set(c.id, { key: f.key, label: f.label });
  }
  // Each collection's currency key, picked per row with a CASE (keys are validated identifiers, passed as parameters).
  const keyExpr = money.size ? sql`case ${records.collectionId} ${sql.join([...money].map(([id, m]) => sql`when ${id} then ${m.key}`), sql` `)} end` : sql`null`;
  const [totals, statuses] = await Promise.all([
    db
      .select({
        id: records.collectionId,
        n: sql<number>`count(*)::int`,
        sum: sql<number | null>`sum(case when jsonb_typeof(${records.values} -> (${keyExpr})) = 'number' then (${records.values} ->> (${keyExpr}))::numeric end)::float8`,
      })
      .from(records)
      .where(and(eq(records.workspaceId, workspaceId), inArray(records.collectionId, ids), isNull(records.deletedAt)))
      .groupBy(records.collectionId),
    db
      .select({ id: records.collectionId, status: records.status, n: sql<number>`count(*)::int` })
      .from(records)
      .where(and(eq(records.workspaceId, workspaceId), inArray(records.collectionId, ids), isNull(records.deletedAt), isNotNull(records.status)))
      .groupBy(records.collectionId, records.status),
  ]);
  for (const c of cols) {
    const t = totals.find((x) => x.id === c.id);
    const m = money.get(c.id);
    out.set(c.id, {
      records: Number(t?.n ?? 0),
      valueSum: m ? Number(t?.sum ?? 0) : null,
      valueLabel: m?.label ?? null,
      byStatus: statuses.filter((s) => s.id === c.id).map((s) => ({ status: s.status!, count: Number(s.n) })),
    });
  }
  return out;
}
