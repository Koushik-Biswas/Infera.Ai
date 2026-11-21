/**
 * GET    /api/v1/automations/:id → AutomationDTO                         (viewer, API scope "read")
 * PATCH  /api/v1/automations/:id {name?, description?, enabled?, trigger?, conditions?, actions?} → AutomationDTO (admin, session only)
 * DELETE /api/v1/automations/:id → 204 (runs are deleted with it)        (admin, session only)
 * Ids of another workspace → 404.
 */
import { and, eq } from "drizzle-orm";
import { notFound, workspaceRoute } from "@/lib/server/api/handler";
import { automations } from "@/lib/server/db/schema";
import { writeAudit } from "@/lib/server/audit";
import { sessionUser } from "@/lib/server/auth/accounts";
import { toAutomationDTO } from "@/lib/server/automations/dto";
import { automationPatchSchema, validateAutomationDefinition } from "@/lib/server/automations/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { id: string };

export const GET = workspaceRoute<P>({ role: "viewer", scope: "read" }, async (c) => {
  const [row] = await c.db
    .select()
    .from(automations)
    .where(and(eq(automations.id, c.params.id), eq(automations.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!row) throw notFound("Automation");
  return toAutomationDTO(row);
});

export const PATCH = workspaceRoute<P>({ role: "admin", rateLimit: { limit: 120, windowSec: 60 } }, async (c) => {
  const body = await c.body(automationPatchSchema);
  const by = sessionUser(c.auth);
  const [existing] = await c.db
    .select()
    .from(automations)
    .where(and(eq(automations.id, c.params.id), eq(automations.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!existing) throw notFound("Automation");

  // Re-validate the whole definition whenever part of it changes (e.g. a new trigger collection
  // must still contain every set_field key and condition field).
  const definitionChanged = body.trigger !== undefined || body.conditions !== undefined || body.actions !== undefined;
  const def = definitionChanged
    ? await validateAutomationDefinition(c.db, c.auth.workspaceId, {
        trigger: body.trigger ?? existing.trigger,
        conditions: body.conditions ?? existing.conditions ?? [],
        actions: body.actions ?? existing.actions,
      })
    : { trigger: existing.trigger, conditions: existing.conditions ?? [], actions: existing.actions };

  const next = {
    name: body.name ?? existing.name,
    description: body.description ?? existing.description,
    enabled: body.enabled ?? existing.enabled,
    trigger: def.trigger,
    conditions: def.conditions,
    actions: def.actions,
  };
  const prev = { name: existing.name, description: existing.description, enabled: existing.enabled, trigger: existing.trigger, conditions: existing.conditions, actions: existing.actions };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(prev[k]));
  if (!changed.length) return toAutomationDTO(existing);

  const row = await c.db.transaction(async (tx) => {
    const [row] = await tx
      .update(automations)
      .set({ ...next, updatedAt: new Date() })
      .where(and(eq(automations.id, existing.id), eq(automations.workspaceId, c.auth.workspaceId)))
      .returning();
    if (!row) throw notFound("Automation");
    await writeAudit(tx, {
      workspaceId: c.auth.workspaceId,
      actor: by.actor,
      action: "automation.update",
      targetType: "automation",
      targetId: row.id,
      before: Object.fromEntries(changed.map((k) => [k, prev[k]])),
      after: Object.fromEntries(changed.map((k) => [k, next[k]])),
    });
    return row;
  });
  return toAutomationDTO(row);
});

export const DELETE = workspaceRoute<P>({ role: "admin" }, async (c) => {
  const by = sessionUser(c.auth);
  await c.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(automations)
      .where(and(eq(automations.id, c.params.id), eq(automations.workspaceId, c.auth.workspaceId)))
      .returning();
    if (!row) throw notFound("Automation");
    await writeAudit(tx, {
      workspaceId: c.auth.workspaceId,
      actor: by.actor,
      action: "automation.delete",
      targetType: "automation",
      targetId: row.id,
      before: { name: row.name, enabled: row.enabled, trigger: row.trigger, conditions: row.conditions, actions: row.actions, runCount: row.runCount },
    });
  });
  return null;
});
