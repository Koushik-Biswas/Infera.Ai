/**
 * GET    /api/v1/records/:id (viewer / API read) → RecordDTO & { sources: RecordSourceDTO[] }
 * PATCH  /api/v1/records/:id { values, expectedVersion? } (member / API write) — human edit, never overwritten by agents
 * DELETE /api/v1/records/:id (admin, or API key with "delete" scope) → soft delete
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError, forbidden, noContent, notFound, workspaceRoute } from "@/lib/server/api/handler";
import { records, workspaces } from "@/lib/server/db/schema";
import { getCollection, softDeleteRecord, updateRecord } from "@/lib/server/records/ops";
import { settingsOf } from "@/lib/server/pipeline/run";
import { toRecordDTO } from "@/lib/server/data/dto";
import { sourceIdsFor, sourcesOf } from "@/lib/server/data/records";
import { roleAtLeast } from "@/lib/shared/types";
import type { Database } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { id: string };

async function load(db: Database, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(records)
    .where(and(eq(records.id, id), eq(records.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export const GET = workspaceRoute<P>({ role: "viewer", scope: "read" }, async (c) => {
  const row = await load(c.db, c.auth.workspaceId, c.params.id);
  if (!row) throw notFound("Record");
  const sources = await sourcesOf(c.db, c.auth.workspaceId, row.id);
  return { ...toRecordDTO(row, [...new Set(sources.map((s) => s.messageId))]), sources };
});

const Body = z.object({ values: z.record(z.string().max(40), z.unknown()), expectedVersion: z.number().int().positive().optional() });

export const PATCH = workspaceRoute<P>({ role: "member", scope: "write", rateLimit: { limit: 240, windowSec: 60 } }, async (c) => {
  const body = await c.body(Body);
  const row = await load(c.db, c.auth.workspaceId, c.params.id);
  if (!row || row.deletedAt) throw notFound("Record");
  const collection = await getCollection(c.db, c.auth.workspaceId, row.collectionId);
  if (!collection) throw notFound("Record");
  const [ws] = await c.db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, c.auth.workspaceId)).limit(1);
  const r = await updateRecord(c.db, {
    workspaceId: c.auth.workspaceId,
    collection,
    recordId: row.id,
    patch: body.values,
    mode: "human",
    actor: c.auth.actor,
    expectedVersion: body.expectedVersion,
    defaultCountry: settingsOf(ws?.settings).defaultCountryCode,
  });
  const sources = await sourceIdsFor(c.db, [row.id]);
  return { ...toRecordDTO(r.record, sources.get(row.id) ?? []), warnings: r.warnings };
});

export const DELETE = workspaceRoute<P>({ role: "member", scope: "delete" }, async (c) => {
  if (c.auth.kind === "session" && !roleAtLeast(c.auth.role, "admin")) throw forbidden("Only admins can delete records.");
  const row = await load(c.db, c.auth.workspaceId, c.params.id);
  if (!row) throw notFound("Record");
  if (row.deletedAt) throw new ApiError(410, "gone", "This record was already deleted.");
  await softDeleteRecord(c.db, { workspaceId: c.auth.workspaceId, recordId: row.id, actor: c.auth.actor });
  return noContent();
});
