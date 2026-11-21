/**
 * The current workspace.
 *   GET    → WorkspaceDTO                              (viewer; API keys with "read")
 *   PATCH  {name?, settings?: Partial<WorkspaceSettings>} (admin, session only)
 *   DELETE {confirm: slug} (or ?confirm=slug)           (owner, session only) → 204
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { notFound, unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { workspaces } from "@/lib/server/db/schema";
import { writeAudit } from "@/lib/server/audit";
import { log } from "@/lib/server/http";
import { effectiveSettings, toWorkspaceDTO } from "@/lib/server/auth/dto";
import { diff, mergeSettings, settingsPatchSchema } from "@/lib/server/auth/settings";
import { workspaceNameField } from "@/lib/server/auth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute({ role: "viewer", scope: "read" }, async (c) => {
  const [ws] = await c.db.select().from(workspaces).where(eq(workspaces.id, c.auth.workspaceId)).limit(1);
  if (!ws) throw notFound("Workspace");
  return toWorkspaceDTO(ws);
});

const PatchBody = z.object({ name: workspaceNameField.optional(), settings: settingsPatchSchema.optional() }).strict();

export const PATCH = workspaceRoute({ role: "admin", rateLimit: { limit: 60, windowSec: 60 } }, async (c) => {
  const body = await c.body(PatchBody);
  return c.db.transaction(async (tx) => {
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, c.auth.workspaceId)).limit(1).for("update");
    if (!ws) throw notFound("Workspace");
    const current = effectiveSettings(ws.settings);
    const settings = body.settings ? mergeSettings(current, body.settings) : current;
    const name = body.name ?? ws.name;

    const changes = diff({ name: ws.name, ...current }, { name, ...settings });
    if (!changes) return toWorkspaceDTO(ws);

    const [updated] = await tx.update(workspaces).set({ name, settings, updatedAt: new Date() }).where(eq(workspaces.id, ws.id)).returning();
    await writeAudit(tx, {
      workspaceId: ws.id,
      actor: c.auth.actor,
      action: "workspace.settings_update",
      targetType: "workspace",
      targetId: ws.id,
      before: changes.before,
      after: changes.after,
    });
    return toWorkspaceDTO(updated);
  });
});

const DeleteBody = z.object({ confirm: z.string().max(200) });

export const DELETE = workspaceRoute({ role: "owner", rateLimit: { limit: 10, windowSec: 60 } }, async (c) => {
  const isJson = (c.req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
  const confirm = isJson ? (await c.body(DeleteBody)).confirm : (c.query.get("confirm") ?? "");

  const [ws] = await c.db.select().from(workspaces).where(eq(workspaces.id, c.auth.workspaceId)).limit(1);
  if (!ws) throw notFound("Workspace");
  if (confirm.trim() !== ws.slug) {
    throw unprocessable("confirm: Type the workspace slug exactly to confirm deletion.", [{ path: "confirm", message: `Must equal "${ws.slug}".` }]);
  }

  await c.db.transaction(async (tx) => {
    // Written without a workspace id so it survives the cascade below.
    await writeAudit(tx, {
      workspaceId: null,
      actor: c.auth.actor,
      action: "workspace.delete",
      targetType: "workspace",
      targetId: ws.id,
      before: { name: ws.name, slug: ws.slug, createdAt: ws.createdAt.toISOString() },
    });
    // Cascades to every tenant table; sessions pointing here get workspace_id = null (FK "set null").
    await tx.delete(workspaces).where(eq(workspaces.id, ws.id));
  });
  log("info", "workspace_deleted", { workspaceId: ws.id });
  return null;
});
