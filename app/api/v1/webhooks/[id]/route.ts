/**
 * GET    /api/v1/webhooks/:id → WebhookEndpointDTO                                   (admin, session only)
 * PATCH  /api/v1/webhooks/:id {url?, description?, events?, enabled?, rotateSecret?} → WebhookEndpointDTO
 *        (+ `secret` once when rotated). Re-enabling resets the failure streak.
 * DELETE /api/v1/webhooks/:id → 204 (deliveries are deleted with it)
 * Foreign ids → 404.
 */
import { and, eq } from "drizzle-orm";
import { notFound, workspaceRoute } from "@/lib/server/api/handler";
import { webhookEndpoints } from "@/lib/server/db/schema";
import { writeAudit } from "@/lib/server/audit";
import { sessionUser } from "@/lib/server/auth/accounts";
import { toWebhookEndpointDTO } from "@/lib/server/automations/dto";
import { encryptWebhookSecret, endpointPatchSchema, newWebhookSecret, validatedEndpointUrl } from "@/lib/server/automations/endpoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { id: string };

export const GET = workspaceRoute<P>({ role: "admin" }, async (c) => {
  const [row] = await c.db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, c.params.id), eq(webhookEndpoints.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!row) throw notFound("Webhook endpoint");
  return toWebhookEndpointDTO(row);
});

export const PATCH = workspaceRoute<P>({ role: "admin", rateLimit: { limit: 120, windowSec: 60 } }, async (c) => {
  const body = await c.body(endpointPatchSchema);
  const by = sessionUser(c.auth);
  const url = body.url !== undefined ? validatedEndpointUrl(body.url) : undefined;
  const secret = body.rotateSecret ? newWebhookSecret() : undefined;

  const row = await c.db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, c.params.id), eq(webhookEndpoints.workspaceId, c.auth.workspaceId)))
      .for("update")
      .limit(1);
    if (!existing) throw notFound("Webhook endpoint");
    const next = {
      url: url ?? existing.url,
      description: body.description ?? existing.description,
      events: body.events ?? existing.events,
      enabled: body.enabled ?? existing.enabled,
    };
    const prev = { url: existing.url, description: existing.description, events: existing.events, enabled: existing.enabled };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(prev[k]));
    if (!changed.length && !secret) return existing;
    const reEnabled = next.enabled && !existing.enabled;
    const [row] = await tx
      .update(webhookEndpoints)
      .set({ ...next, ...(secret ? { secretEnc: encryptWebhookSecret(secret) } : {}), ...(reEnabled ? { failureCount: 0 } : {}), updatedAt: new Date() })
      .where(and(eq(webhookEndpoints.id, existing.id), eq(webhookEndpoints.workspaceId, c.auth.workspaceId)))
      .returning();
    await writeAudit(tx, {
      workspaceId: c.auth.workspaceId,
      actor: by.actor,
      action: "webhook.update",
      targetType: "webhook_endpoint",
      targetId: row.id,
      before: Object.fromEntries(changed.map((k) => [k, prev[k]])),
      after: Object.fromEntries(changed.map((k) => [k, next[k]])),
      meta: { secretRotated: Boolean(secret) },
    });
    return row;
  });
  return toWebhookEndpointDTO(row, secret);
});

export const DELETE = workspaceRoute<P>({ role: "admin" }, async (c) => {
  const by = sessionUser(c.auth);
  await c.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, c.params.id), eq(webhookEndpoints.workspaceId, c.auth.workspaceId)))
      .returning({ id: webhookEndpoints.id, url: webhookEndpoints.url, events: webhookEndpoints.events, enabled: webhookEndpoints.enabled });
    if (!row) throw notFound("Webhook endpoint");
    await writeAudit(tx, {
      workspaceId: c.auth.workspaceId,
      actor: by.actor,
      action: "webhook.delete",
      targetType: "webhook_endpoint",
      targetId: row.id,
      before: { url: row.url, events: row.events, enabled: row.enabled },
    });
  });
  return null;
});
