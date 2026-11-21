/**
 * GET  /api/v1/webhooks → { items: WebhookEndpointDTO[], nextCursor: null }         (admin, session only)
 * POST /api/v1/webhooks {url, events, description?, enabled?} → WebhookEndpointDTO + `secret` once (201)
 * URLs must be https in production and may not point to private/internal addresses.
 */
import { count, desc, eq } from "drizzle-orm";
import { conflict, created, workspaceRoute } from "@/lib/server/api/handler";
import { webhookEndpoints } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { writeAudit } from "@/lib/server/audit";
import { sessionUser } from "@/lib/server/auth/accounts";
import { toWebhookEndpointDTO } from "@/lib/server/automations/dto";
import { MAX_ENDPOINTS_PER_WORKSPACE, encryptWebhookSecret, endpointCreateSchema, newWebhookSecret, validatedEndpointUrl } from "@/lib/server/automations/endpoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute({ role: "admin" }, async (c) => {
  const rows = await c.db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.workspaceId, c.auth.workspaceId))
    .orderBy(desc(webhookEndpoints.createdAt), desc(webhookEndpoints.id))
    .limit(MAX_ENDPOINTS_PER_WORKSPACE * 2);
  return { items: rows.map((r) => toWebhookEndpointDTO(r)), nextCursor: null };
});

export const POST = workspaceRoute({ role: "admin", rateLimit: { limit: 30, windowSec: 3600 } }, async (c) => {
  const body = await c.body(endpointCreateSchema);
  const by = sessionUser(c.auth);
  const url = validatedEndpointUrl(body.url);
  const secret = newWebhookSecret();

  const row = await c.db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(webhookEndpoints).where(eq(webhookEndpoints.workspaceId, c.auth.workspaceId));
    if (n >= MAX_ENDPOINTS_PER_WORKSPACE) throw conflict(`A workspace can have at most ${MAX_ENDPOINTS_PER_WORKSPACE} webhook endpoints.`);
    const [row] = await tx
      .insert(webhookEndpoints)
      .values({
        id: newId("whk"),
        workspaceId: c.auth.workspaceId,
        url,
        description: body.description ?? "",
        secretEnc: encryptWebhookSecret(secret),
        events: body.events,
        enabled: body.enabled ?? true,
        createdBy: by.userId,
      })
      .returning();
    await writeAudit(tx, {
      workspaceId: c.auth.workspaceId,
      actor: by.actor,
      action: "webhook.create",
      targetType: "webhook_endpoint",
      targetId: row.id,
      after: { url: row.url, events: row.events, enabled: row.enabled, description: row.description },
    });
    return row;
  });
  return created(toWebhookEndpointDTO(row, secret));
});
