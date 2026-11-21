/** DELETE /api/v1/invitations/:id → 204 (admin). Revokes an open invitation; its link stops working. */
import { and, eq } from "drizzle-orm";
import { conflict, notFound, workspaceRoute } from "@/lib/server/api/handler";
import { invitations } from "@/lib/server/db/schema";
import { writeAudit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = workspaceRoute<{ id: string }>({ role: "admin", rateLimit: { limit: 120, windowSec: 60 } }, async (c) => {
  await c.db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.id, c.params.id), eq(invitations.workspaceId, c.auth.workspaceId)))
      .limit(1)
      .for("update");
    if (!inv) throw notFound("Invitation");
    if (inv.acceptedAt) throw conflict("This invitation was already accepted. Remove the member instead.");
    await tx.delete(invitations).where(and(eq(invitations.id, inv.id), eq(invitations.workspaceId, c.auth.workspaceId)));
    await writeAudit(tx, {
      workspaceId: c.auth.workspaceId,
      actor: c.auth.actor,
      action: "invitation.revoke",
      targetType: "invitation",
      targetId: inv.id,
      before: { email: inv.email, role: inv.role, expiresAt: inv.expiresAt.toISOString() },
    });
  });
  return null;
});
