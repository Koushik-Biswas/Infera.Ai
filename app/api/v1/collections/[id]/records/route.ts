/**
 * GET  /api/v1/collections/:id/records?q=&status=&sort=-updatedAt|updatedAt|<field>|-<field>&cursor=&limit=&deleted=1
 *      (viewer / API read) → Page<RecordDTO>
 * POST /api/v1/collections/:id/records { values } (member / API write) → 201 RecordDTO
 */
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { conflict, created, notFound, pageLimit, unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { collections, records, workspaces } from "@/lib/server/db/schema";
import { DuplicateRecordError, createRecord, getCollection } from "@/lib/server/records/ops";
import { settingsOf } from "@/lib/server/pipeline/run";
import { toRecordDTO } from "@/lib/server/data/dto";
import { sourceIdsFor } from "@/lib/server/data/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { id: string };

const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

export const GET = workspaceRoute<P>({ role: "viewer", scope: "read" }, async (c) => {
  const [col] = await c.db
    .select({ id: collections.id, fields: collections.fields })
    .from(collections)
    .where(and(eq(collections.id, c.params.id), eq(collections.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!col) throw notFound("Collection");
  const limit = pageLimit(c.query, 50, 200);
  const q = c.query.get("q")?.trim().slice(0, 100);
  const status = c.query.get("status");
  const sort = c.query.get("sort") ?? "-updatedAt";
  const offset = Math.max(0, Math.min(100_000, Number(c.query.get("cursor") ?? 0) || 0));

  const where: SQL[] = [eq(records.workspaceId, c.auth.workspaceId), eq(records.collectionId, col.id), c.query.get("deleted") === "1" ? isNotNull(records.deletedAt) : isNull(records.deletedAt)];
  if (status) where.push(eq(records.status, status));
  if (q) {
    const doc = sql`to_tsvector('simple', ${records.values}::text)`;
    where.push(or(sql`${doc} @@ websearch_to_tsquery('simple', ${q})`, ilike(sql`${records.values}::text`, `%${q.replace(/[%_\\]/g, "\\$&")}%`))!);
  }

  const desc_ = sort.startsWith("-");
  const key = sort.replace(/^-/, "");
  let order: SQL[];
  if (key === "updatedAt" || key === "createdAt") {
    const colRef = key === "updatedAt" ? records.updatedAt : records.createdAt;
    order = [desc_ ? desc(colRef) : asc(colRef), desc(records.id)];
  } else {
    const field = col.fields.find((f) => f.key === key);
    if (!field || !KEY_RE.test(field.key)) throw unprocessable(`sort: Unknown field "${key}".`);
    const v = field.type === "number" || field.type === "currency" ? sql`(case when jsonb_typeof(${records.values} -> ${field.key}) = 'number' then (${records.values} ->> ${field.key})::numeric end)` : sql`lower(${records.values} ->> ${field.key})`;
    order = [desc_ ? sql`${v} desc nulls last` : sql`${v} asc nulls last`, desc(records.updatedAt), desc(records.id)];
  }

  const rows = await c.db
    .select()
    .from(records)
    .where(and(...where))
    .orderBy(...order)
    .limit(limit + 1)
    .offset(offset);
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const sources = await sourceIdsFor(c.db, page.map((r) => r.id));
  return { items: page.map((r) => toRecordDTO(r, sources.get(r.id) ?? [])), nextCursor: more ? String(offset + limit) : null };
});

const Body = z.object({ values: z.record(z.string().max(40), z.unknown()) });

export const POST = workspaceRoute<P>({ role: "member", scope: "write", rateLimit: { limit: 120, windowSec: 60 } }, async (c) => {
  const body = await c.body(Body);
  const collection = await getCollection(c.db, c.auth.workspaceId, c.params.id);
  if (!collection) throw notFound("Collection");
  if (collection.archivedAt) throw conflict("This collection is archived.");
  const [ws] = await c.db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, c.auth.workspaceId)).limit(1);
  try {
    const r = await createRecord(c.db, {
      workspaceId: c.auth.workspaceId,
      collection,
      values: body.values,
      origin: c.auth.kind === "api_key" ? "api" : "manual",
      actor: c.auth.actor,
      defaultCountry: settingsOf(ws?.settings).defaultCountryCode,
    });
    return created({ ...toRecordDTO(r.record), warnings: r.warnings });
  } catch (e) {
    if (e instanceof DuplicateRecordError) throw conflict("A record with the same identity already exists.", { existingId: e.existingId });
    throw e;
  }
});
