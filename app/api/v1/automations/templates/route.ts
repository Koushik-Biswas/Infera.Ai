/**
 * GET /api/v1/automations/templates → { items: AutomationTemplateDTO[] }   (viewer, API scope "read")
 * Ready-made automation definitions bound to this workspace's collections when possible.
 * Nothing is persisted — POST a template's definition to /api/v1/automations to use it.
 */
import { and, eq, isNull } from "drizzle-orm";
import { workspaceRoute } from "@/lib/server/api/handler";
import { collections } from "@/lib/server/db/schema";
import { automationTemplates } from "@/lib/server/automations/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute({ role: "viewer", scope: "read" }, async (c) => {
  const rows = await c.db
    .select({ id: collections.id, name: collections.name, template: collections.template, fields: collections.fields })
    .from(collections)
    .where(and(eq(collections.workspaceId, c.auth.workspaceId), isNull(collections.archivedAt)))
    .orderBy(collections.createdAt)
    .limit(200);
  const refs = rows.map((r) => ({ id: r.id, name: r.name, template: r.template, statusOptions: r.fields.find((f) => f.type === "status")?.options ?? [] }));
  return { items: automationTemplates(refs) };
});
