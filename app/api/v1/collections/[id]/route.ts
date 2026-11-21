/**
 * GET    /api/v1/collections/:id (viewer / API read) → CollectionDTO
 * PATCH  /api/v1/collections/:id (member / API write) { name?, description?, icon?, fields?, routing?, matchFields?, autopilot?, archived? }
 * DELETE /api/v1/collections/:id (admin) → archive; `?hard=1` (owner) → delete with its records
 */
import { and, count, eq, isNull } from "drizzle-orm";
import { forbidden, noContent, notFound, workspaceRoute } from "@/lib/server/api/handler";
import { writeAudit } from "@/lib/server/audit";
import type { Database } from "@/lib/server/db";
import { collections, records, type CollectionRow } from "@/lib/server/db/schema";
import { toCollectionDTO } from "@/lib/server/data/dto";
import { CollectionPatchBody, validateFields } from "@/lib/server/data/collections";
import { roleAtLeast, type Field } from "@/lib/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { id: string };

async function load(db: Database, workspaceId: string, id: string): Promise<CollectionRow | null> {
  const [row] = await db
    .select()
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

async function recordCount(db: Database, id: string) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(records)
    .where(and(eq(records.collectionId, id), isNull(records.deletedAt)));
  return Number(n);
}

export const GET = workspaceRoute<P>({ role: "viewer", scope: "read" }, async (c) => {
  const row = await load(c.db, c.auth.workspaceId, c.params.id);
  if (!row) throw notFound("Collection");
  return toCollectionDTO(row, await recordCount(c.db, row.id));
});

export const PATCH = workspaceRoute<P>({ role: "member", scope: "write" }, async (c) => {
  const body = await c.body(CollectionPatchBody);
  const row = await load(c.db, c.auth.workspaceId, c.params.id);
  if (!row) throw notFound("Collection");
  const fields = (body.fields as Field[] | undefined) ?? row.fields;
  const matchFields = body.matchFields ?? row.matchFields.filter((m) => m.startsWith("$") || fields.some((f) => f.key === m));
  validateFields(fields, matchFields);
  const patch: Partial<typeof collections.$inferInsert> = { fields, matchFields, updatedAt: new Date() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.icon !== undefined) patch.icon = body.icon;
  if (body.routing !== undefined) patch.routing = body.routing;
  if (body.autopilot !== undefined) patch.autopilot = body.autopilot;
  if (body.archived !== undefined) patch.archivedAt = body.archived ? (row.archivedAt ?? new Date()) : null;
  // Keys removed from the schema keep their values in old records (harmless) — never silently rewrite data.
  const [updated] = await c.db.update(collections).set(patch).where(eq(collections.id, row.id)).returning();
  await writeAudit(c.db, {
    workspaceId: c.auth.workspaceId,
    actor: c.auth.actor,
    action: "collection.update",
    targetType: "collection",
    targetId: row.id,
    before: { name: row.name, fields: row.fields.map((f) => f.key), routing: row.routing, autopilot: row.autopilot, archived: Boolean(row.archivedAt) },
    after: { name: updated.name, fields: updated.fields.map((f) => f.key), routing: updated.routing, autopilot: updated.autopilot, archived: Boolean(updated.archivedAt) },
  });
  return toCollectionDTO(updated, await recordCount(c.db, row.id));
});

export const DELETE = workspaceRoute<P>({ role: "admin" }, async (c) => {
  const row = await load(c.db, c.auth.workspaceId, c.params.id);
  if (!row) throw notFound("Collection");
  if (c.query.get("hard") === "1") {
    if (!roleAtLeast(c.auth.role, "owner")) throw forbidden("Only the workspace owner can permanently delete a collection.");
    await c.db.delete(collections).where(eq(collections.id, row.id));
    await writeAudit(c.db, { workspaceId: c.auth.workspaceId, actor: c.auth.actor, action: "collection.delete", targetType: "collection", targetId: row.id, before: { name: row.name } });
    return noContent();
  }
  await c.db.update(collections).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(collections.id, row.id));
  await writeAudit(c.db, { workspaceId: c.auth.workspaceId, actor: c.auth.actor, action: "collection.archive", targetType: "collection", targetId: row.id, before: { name: row.name } });
  return noContent();
});
