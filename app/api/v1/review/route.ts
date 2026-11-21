/**
 * GET /api/v1/review?status=open|approved|rejected&collectionId=&cursor=&limit= → Page<ReviewItemDTO>
 * Newest first; status defaults to "open" (viewer, API scope "read").
 */
import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { badRequest, pageLimit, workspaceRoute } from "@/lib/server/api/handler";
import { reviewItems } from "@/lib/server/db/schema";
import { toReviewItemDTO } from "@/lib/server/automations/dto";
import { afterKeyset, decodeKeyset, exactTimestamp, pageOf } from "@/lib/server/automations/paging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["open", "approved", "rejected"] as const;
type Status = (typeof STATUSES)[number];

export const GET = workspaceRoute({ role: "viewer", scope: "read" }, async (c) => {
  const status = (c.query.get("status") ?? "open") as Status;
  if (!STATUSES.includes(status)) throw badRequest(`status must be one of ${STATUSES.join(", ")}.`);
  const limit = pageLimit(c.query, 50, 100);
  const rawCursor = c.query.get("cursor");
  const cursor = decodeKeyset(rawCursor);
  if (rawCursor && !cursor) throw badRequest("Invalid cursor.");
  const collectionId = c.query.get("collectionId")?.trim() || null;
  if (collectionId && collectionId.length > 64) throw badRequest("Invalid collectionId.");

  const rows = await c.db
    .select({ ...getTableColumns(reviewItems), cursorAt: exactTimestamp(reviewItems.createdAt) })
    .from(reviewItems)
    .where(
      and(
        eq(reviewItems.workspaceId, c.auth.workspaceId),
        eq(reviewItems.status, status),
        collectionId ? eq(reviewItems.collectionId, collectionId) : undefined,
        cursor ? afterKeyset(reviewItems.createdAt, reviewItems.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(reviewItems.createdAt), desc(reviewItems.id))
    .limit(limit + 1);
  const page = pageOf(rows, limit);
  return { items: page.rows.map(toReviewItemDTO), nextCursor: page.nextCursor };
});
