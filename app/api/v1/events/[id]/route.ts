import { and, eq } from "drizzle-orm";
import { notFound, workspaceRoute } from "@/lib/server/api/handler";
import { events } from "@/lib/server/db/schema";
import { toEventDTO } from "@/lib/server/pipeline/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/events/:id → EventDTO (with the stored ProcessingResult). */
export const GET = workspaceRoute<{ id: string }>({ role: "viewer", scope: "read" }, async (c) => {
  const [row] = await c.db
    .select()
    .from(events)
    .where(and(eq(events.id, c.params.id), eq(events.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!row) throw notFound("Event");
  return toEventDTO(row);
});
