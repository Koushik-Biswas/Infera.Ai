/**
 * POST /api/v1/webhooks/:id/test → WebhookDeliveryDTO   (admin, session only)
 * Sends a signed `ping` event to the endpoint right away (also when it is disabled) and
 * returns the delivery with its outcome (status "delivered" or "failed", HTTP status,
 * error). Test pings are not retried and don't count toward auto-disable. Foreign ids → 404.
 */
import { and, eq } from "drizzle-orm";
import { notFound, workspaceRoute } from "@/lib/server/api/handler";
import { webhookDeliveries, webhookEndpoints } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { writeAudit } from "@/lib/server/audit";
import { sessionUser } from "@/lib/server/auth/accounts";
import { toWebhookDeliveryDTO } from "@/lib/server/automations/dto";
import { deliverWebhook } from "@/lib/server/automations/deliver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = workspaceRoute<{ id: string }>({ role: "admin", rateLimit: { limit: 10, windowSec: 60 } }, async (c) => {
  const by = sessionUser(c.auth);
  const [endpoint] = await c.db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, c.params.id), eq(webhookEndpoints.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!endpoint) throw notFound("Webhook endpoint");

  const id = newId("dlv");
  const now = new Date();
  await c.db.insert(webhookDeliveries).values({
    id,
    workspaceId: c.auth.workspaceId,
    endpointId: endpoint.id,
    eventType: "ping",
    payload: { id, type: "ping", created_at: now.toISOString(), workspace_id: c.auth.workspaceId, data: { endpoint_id: endpoint.id, message: "This is a test event from Infera." } },
    status: "pending",
    createdAt: now,
  });
  const outcome = await deliverWebhook(c.db, id, { inline: true });

  const [delivery] = await c.db
    .select()
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!delivery) throw notFound("Delivery");
  await writeAudit(c.db, {
    workspaceId: c.auth.workspaceId,
    actor: by.actor,
    action: "webhook.test",
    targetType: "webhook_endpoint",
    targetId: endpoint.id,
    after: { deliveryId: id, status: delivery.status, responseStatus: delivery.responseStatus },
    meta: { outcome: outcome.state },
  });
  return toWebhookDeliveryDTO(delivery);
});
