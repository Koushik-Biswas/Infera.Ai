/** GET /api/v1/review/count → { open: number }   (viewer, API scope "read") */
import { and, count, eq } from "drizzle-orm";
import { workspaceRoute } from "@/lib/server/api/handler";
import { reviewItems } from "@/lib/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute({ role: "viewer", scope: "read" }, async (c) => {
  const [{ open }] = await c.db
    .select({ open: count() })
    .from(reviewItems)
    .where(and(eq(reviewItems.workspaceId, c.auth.workspaceId), eq(reviewItems.status, "open")));
  return { open };
});
