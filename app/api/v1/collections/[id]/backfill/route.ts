import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { conflict, jsonResponse, notFound, unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { writeAudit } from "@/lib/server/audit";
import { collections } from "@/lib/server/db/schema";
import { kickSoon } from "@/lib/server/jobs/kick";
import { backfillCollection } from "@/lib/server/pipeline/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isoDate = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date");

const Body = z.object({ since: isoDate.nullish(), until: isoDate.nullish() });

const MAX_WINDOW_DAYS = 366;

/** POST /api/v1/collections/:id/backfill — re-process past messages into this collection. */
export const POST = workspaceRoute<{ id: string }>({ role: "member", scope: "write", rateLimit: { limit: 10, windowSec: 60 } }, async (c) => {
  const body = await c.body(Body);
  const [collection] = await c.db
    .select({ id: collections.id, archivedAt: collections.archivedAt })
    .from(collections)
    .where(and(eq(collections.id, c.params.id), eq(collections.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!collection) throw notFound("Collection");
  if (collection.archivedAt) throw conflict("This collection is archived.");

  const until = body.until ? new Date(body.until) : new Date();
  const since = body.since ? new Date(body.since) : new Date(until.getTime() - 30 * 86_400_000);
  if (since.getTime() >= until.getTime()) throw unprocessable("since must be before until.");
  if (until.getTime() - since.getTime() > MAX_WINDOW_DAYS * 86_400_000) throw unprocessable(`The window can be at most ${MAX_WINDOW_DAYS} days.`);

  const res = await backfillCollection(c.db, { workspaceId: c.auth.workspaceId, collectionId: collection.id, since, until });
  await writeAudit(c.db, {
    workspaceId: c.auth.workspaceId,
    actor: c.auth.actor,
    action: "collection.backfill",
    targetType: "collection",
    targetId: collection.id,
    meta: { since: since.toISOString(), until: until.toISOString(), queued: res.queued, capped: res.capped },
  });
  if (res.queued) kickSoon();
  return jsonResponse({ queued: res.queued, capped: res.capped }, 202);
});
