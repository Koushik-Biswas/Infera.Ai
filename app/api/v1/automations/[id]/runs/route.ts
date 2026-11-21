/**
 * GET /api/v1/automations/:id/runs?status=success|failed|skipped&cursor=&limit= → Page<AutomationRunDTO>
 * Newest first (viewer, API scope "read"). Unknown / foreign automation → 404.
 */
import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { badRequest, notFound, pageLimit, workspaceRoute } from "@/lib/server/api/handler";
import { automationRuns, automations } from "@/lib/server/db/schema";
import { toAutomationRunDTO } from "@/lib/server/automations/dto";
import { afterKeyset, decodeKeyset, exactTimestamp, pageOf } from "@/lib/server/automations/paging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["success", "failed", "skipped"] as const;

export const GET = workspaceRoute<{ id: string }>({ role: "viewer", scope: "read" }, async (c) => {
  const limit = pageLimit(c.query, 50, 100);
  const rawCursor = c.query.get("cursor");
  const cursor = decodeKeyset(rawCursor);
  if (rawCursor && !cursor) throw badRequest("Invalid cursor.");
  const status = c.query.get("status");
  if (status && !(STATUSES as readonly string[]).includes(status)) throw badRequest(`status must be one of ${STATUSES.join(", ")}.`);

  const [automation] = await c.db
    .select({ id: automations.id })
    .from(automations)
    .where(and(eq(automations.id, c.params.id), eq(automations.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!automation) throw notFound("Automation");

  const rows = await c.db
    .select({ ...getTableColumns(automationRuns), cursorAt: exactTimestamp(automationRuns.createdAt) })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.automationId, automation.id),
        eq(automationRuns.workspaceId, c.auth.workspaceId),
        status ? eq(automationRuns.status, status as (typeof STATUSES)[number]) : undefined,
        cursor ? afterKeyset(automationRuns.createdAt, automationRuns.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(automationRuns.createdAt), desc(automationRuns.id))
    .limit(limit + 1);
  const page = pageOf(rows, limit);
  return { items: page.rows.map(toAutomationRunDTO), nextCursor: page.nextCursor };
});
