/**
 * GET /api/v1/webhooks/:id/deliveries?status=pending|delivered|failed&cursor=&limit= → Page<WebhookDeliveryDTO>
 * Newest first (admin, session only). Payloads are not returned. Foreign ids → 404.
 */
import { and, desc, eq } from "drizzle-orm";
import { badRequest, notFound, pageLimit, workspaceRoute } from "@/lib/server/api/handler";
import { webhookDeliveries, webhookEndpoints } from "@/lib/server/db/schema";
import { afterKeyset, decodeKeyset, exactTimestamp, pageOf } from "@/lib/server/automations/paging";
import type { WebhookDeliveryDTO } from "@/lib/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["pending", "delivered", "failed"] as const;
type Status = (typeof STATUSES)[number];

export const GET = workspaceRoute<{ id: string }>({ role: "admin" }, async (c) => {
  const limit = pageLimit(c.query, 50, 100);
  const rawCursor = c.query.get("cursor");
  const cursor = decodeKeyset(rawCursor);
  if (rawCursor && !cursor) throw badRequest("Invalid cursor.");
  const status = c.query.get("status") as Status | null;
  if (status && !STATUSES.includes(status)) throw badRequest(`status must be one of ${STATUSES.join(", ")}.`);

  const [endpoint] = await c.db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, c.params.id), eq(webhookEndpoints.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!endpoint) throw notFound("Webhook endpoint");

  const d = webhookDeliveries;
  const rows = await c.db
    .select({
      id: d.id,
      endpointId: d.endpointId,
      eventType: d.eventType,
      status: d.status,
      attempts: d.attempts,
      responseStatus: d.responseStatus,
      error: d.error,
      createdAt: d.createdAt,
      deliveredAt: d.deliveredAt,
      cursorAt: exactTimestamp(d.createdAt),
    })
    .from(d)
    .where(and(eq(d.endpointId, endpoint.id), eq(d.workspaceId, c.auth.workspaceId), status ? eq(d.status, status) : undefined, cursor ? afterKeyset(d.createdAt, d.id, cursor) : undefined))
    .orderBy(desc(d.createdAt), desc(d.id))
    .limit(limit + 1);
  const page = pageOf(rows, limit);
  const items: WebhookDeliveryDTO[] = page.rows.map((r) => ({
    id: r.id,
    endpointId: r.endpointId,
    eventType: r.eventType,
    status: r.status,
    attempts: r.attempts,
    responseStatus: r.responseStatus ?? null,
    error: r.error ?? null,
    createdAt: r.createdAt.toISOString(),
    deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
  }));
  return { items, nextCursor: page.nextCursor };
});
