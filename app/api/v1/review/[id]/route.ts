/** GET /api/v1/review/:id → ReviewItemDTO   (viewer, API scope "read"; foreign ids → 404) */
import { and, eq } from "drizzle-orm";
import { notFound, workspaceRoute } from "@/lib/server/api/handler";
import { reviewItems } from "@/lib/server/db/schema";
import { toReviewItemDTO } from "@/lib/server/automations/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute<{ id: string }>({ role: "viewer", scope: "read" }, async (c) => {
  const [row] = await c.db
    .select()
    .from(reviewItems)
    .where(and(eq(reviewItems.id, c.params.id), eq(reviewItems.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!row) throw notFound("Review item");
  return toReviewItemDTO(row);
});
