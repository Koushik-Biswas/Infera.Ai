/**
 * GET  /api/v1/collections?archived=1 (viewer / API read) → { items: CollectionDTO[] } with record counts
 * POST /api/v1/collections (member / API write) { template?, name?, description?, icon?, fields?, routing?, matchFields?, autopilot?, backfillSince? }
 *      → 201 CollectionDTO & { backfill: { queued, capped } | null }
 *      `backfillSince` re-processes past messages from that date into the new collection ("leads from the last month").
 */
import { and, asc, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { created, unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { writeAudit } from "@/lib/server/audit";
import { collections, records } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { kickSoon } from "@/lib/server/jobs/kick";
import { backfillCollection } from "@/lib/server/pipeline/backfill";
import { toCollectionDTO } from "@/lib/server/data/dto";
import { CollectionCreateBody, resolveCreate } from "@/lib/server/data/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_COLLECTIONS = 100;

export const GET = workspaceRoute({ role: "viewer", scope: "read" }, async (c) => {
  const archived = c.query.get("archived") === "1";
  const rows = await c.db
    .select()
    .from(collections)
    .where(and(eq(collections.workspaceId, c.auth.workspaceId), archived ? isNotNull(collections.archivedAt) : isNull(collections.archivedAt)))
    .orderBy(asc(collections.createdAt), asc(collections.id))
    .limit(MAX_COLLECTIONS * 2);
  const counts = rows.length
    ? await c.db
        .select({ id: records.collectionId, n: count() })
        .from(records)
        .where(and(eq(records.workspaceId, c.auth.workspaceId), isNull(records.deletedAt), inArray(records.collectionId, rows.map((r) => r.id))))
        .groupBy(records.collectionId)
    : [];
  const byId = new Map(counts.map((r) => [r.id, Number(r.n)]));
  return { items: rows.map((r) => toCollectionDTO(r, byId.get(r.id) ?? 0)) };
});

export const POST = workspaceRoute({ role: "member", scope: "write", rateLimit: { limit: 30, windowSec: 60 } }, async (c) => {
  const body = await c.body(CollectionCreateBody);
  const plan = resolveCreate(body);
  let since: Date | null = null;
  if (body.backfillSince) {
    since = new Date(body.backfillSince);
    if (Number.isNaN(since.getTime())) throw unprocessable("backfillSince: must be an ISO date.");
  }
  const [{ n }] = await c.db.select({ n: count() }).from(collections).where(and(eq(collections.workspaceId, c.auth.workspaceId), isNull(collections.archivedAt)));
  if (Number(n) >= MAX_COLLECTIONS) throw unprocessable(`A workspace can have at most ${MAX_COLLECTIONS} active collections.`);

  const [row] = await c.db
    .insert(collections)
    .values({
      id: newId("col"),
      workspaceId: c.auth.workspaceId,
      name: plan.name,
      description: plan.description,
      icon: plan.icon,
      template: plan.template,
      fields: plan.fields,
      routing: plan.routing,
      matchFields: plan.matchFields,
      autopilot: plan.autopilot,
      createdBy: c.auth.userId,
    })
    .returning();
  await writeAudit(c.db, {
    workspaceId: c.auth.workspaceId,
    actor: c.auth.actor,
    action: "collection.create",
    targetType: "collection",
    targetId: row.id,
    after: { name: row.name, template: row.template, fields: row.fields.map((f) => f.key), routing: row.routing },
  });
  let backfill: { queued: number; capped: boolean } | null = null;
  if (since) {
    backfill = await backfillCollection(c.db, { workspaceId: c.auth.workspaceId, collectionId: row.id, since });
    if (backfill.queued) kickSoon();
  }
  return created({ ...toCollectionDTO(row, 0), backfill });
});
