/**
 * GET /api/v1/collections/:id/export?format=csv|xlsx|json (viewer / API read) → file download.
 * CSV neutralises spreadsheet formulas (cells starting with = + - @ get a leading ').
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { notFound, unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { writeAudit } from "@/lib/server/audit";
import { collections, records } from "@/lib/server/db/schema";
import { toCSV, toXLSX } from "@/lib/app/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 50_000;

export const GET = workspaceRoute<{ id: string }>({ role: "viewer", scope: "read", rateLimit: { limit: 20, windowSec: 60 } }, async (c) => {
  const format = c.query.get("format") ?? "csv";
  if (!["csv", "xlsx", "json"].includes(format)) throw unprocessable("format: Use csv, xlsx or json.");
  const [col] = await c.db
    .select()
    .from(collections)
    .where(and(eq(collections.id, c.params.id), eq(collections.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!col) throw notFound("Collection");
  const rows = await c.db
    .select({ id: records.id, values: records.values, createdAt: records.createdAt, updatedAt: records.updatedAt })
    .from(records)
    .where(and(eq(records.collectionId, col.id), isNull(records.deletedAt)))
    .orderBy(asc(records.createdAt))
    .limit(MAX_ROWS);
  await writeAudit(c.db, { workspaceId: c.auth.workspaceId, actor: c.auth.actor, action: "collection.export", targetType: "collection", targetId: col.id, meta: { format, rows: rows.length } });

  const base = col.name.replace(/[^\p{L}\p{N} _-]+/gu, " ").trim().slice(0, 60) || "collection";
  const disposition = (ext: string) => `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.${ext}`)}`;
  const fields = col.fields.filter((f) => f.type !== "image");
  const table = { headers: fields.map((f) => f.label), rows: rows.map((r) => fields.map((f) => { const v = r.values[f.key] ?? null; return typeof v === "boolean" ? (v ? "Yes" : "No") : v; })) };

  if (format === "json") {
    const body = JSON.stringify({ collection: { id: col.id, name: col.name, fields: col.fields }, records: rows.map((r) => ({ id: r.id, ...r.values, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })) }, null, 2);
    return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": disposition("json"), "Cache-Control": "no-store" } });
  }
  if (format === "xlsx") {
    const blob = toXLSX(col.name.slice(0, 31) || "Sheet1", table);
    return new Response(await blob.arrayBuffer(), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": disposition("xlsx"), "Cache-Control": "no-store" } });
  }
  return new Response("﻿" + toCSV(table), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": disposition("csv"), "Cache-Control": "no-store" } });
});
