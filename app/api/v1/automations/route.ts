/**
 * GET  /api/v1/automations → { items: AutomationDTO[], nextCursor: null }   (viewer, API scope "read")
 * POST /api/v1/automations {name, description?, enabled?, trigger, conditions?, actions} → AutomationDTO (201)
 *      (admin, session only). References (collections, webhook endpoints, members) must be in the workspace (404 otherwise).
 */
import { count, desc, eq } from "drizzle-orm";
import { conflict, created, workspaceRoute } from "@/lib/server/api/handler";
import { automations } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { writeAudit } from "@/lib/server/audit";
import { sessionUser } from "@/lib/server/auth/accounts";
import { toAutomationDTO } from "@/lib/server/automations/dto";
import { MAX_AUTOMATIONS_PER_WORKSPACE, automationCreateSchema, validateAutomationDefinition } from "@/lib/server/automations/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute({ role: "viewer", scope: "read" }, async (c) => {
  const rows = await c.db
    .select()
    .from(automations)
    .where(eq(automations.workspaceId, c.auth.workspaceId))
    .orderBy(desc(automations.createdAt), desc(automations.id))
    .limit(MAX_AUTOMATIONS_PER_WORKSPACE);
  return { items: rows.map(toAutomationDTO), nextCursor: null };
});

export const POST = workspaceRoute({ role: "admin", rateLimit: { limit: 60, windowSec: 60 } }, async (c) => {
  const body = await c.body(automationCreateSchema);
  const by = sessionUser(c.auth);
  const def = await validateAutomationDefinition(c.db, c.auth.workspaceId, { trigger: body.trigger, conditions: body.conditions ?? [], actions: body.actions });

  const row = await c.db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(automations).where(eq(automations.workspaceId, c.auth.workspaceId));
    if (n >= MAX_AUTOMATIONS_PER_WORKSPACE) throw conflict(`A workspace can have at most ${MAX_AUTOMATIONS_PER_WORKSPACE} automations. Delete unused ones first.`);
    const [row] = await tx
      .insert(automations)
      .values({
        id: newId("aut"),
        workspaceId: c.auth.workspaceId,
        name: body.name,
        description: body.description ?? "",
        enabled: body.enabled ?? true,
        trigger: def.trigger,
        conditions: def.conditions,
        actions: def.actions,
        createdBy: by.userId,
      })
      .returning();
    await writeAudit(tx, {
      workspaceId: c.auth.workspaceId,
      actor: by.actor,
      action: "automation.create",
      targetType: "automation",
      targetId: row.id,
      after: { name: row.name, enabled: row.enabled, trigger: row.trigger, conditions: row.conditions, actions: row.actions },
    });
    return row;
  });
  return created(toAutomationDTO(row));
});
