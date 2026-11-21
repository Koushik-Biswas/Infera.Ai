/**
 * PATCH  /api/v1/members/:userId {role} → MemberDTO   (admin; owner for owner/admin changes)
 * DELETE /api/v1/members/:userId        → 204         (admin, or any member removing themself)
 * The last owner is always protected (409 `last_owner`).
 */
import { z } from "zod";
import { workspaceRoute } from "@/lib/server/api/handler";
import { ROLES } from "@/lib/shared/types";
import { sessionUser } from "@/lib/server/auth/accounts";
import { changeMemberRole, removeMember } from "@/lib/server/auth/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchBody = z.object({ role: z.enum(ROLES) });

export const PATCH = workspaceRoute<{ userId: string }>({ role: "admin", rateLimit: { limit: 60, windowSec: 60 } }, async (c) => {
  const { role } = await c.body(PatchBody);
  return changeMemberRole(c.db, { workspaceId: c.auth.workspaceId, by: sessionUser(c.auth), targetUserId: c.params.userId, role });
});

export const DELETE = workspaceRoute<{ userId: string }>({ role: "viewer", rateLimit: { limit: 60, windowSec: 60 } }, async (c) => {
  await removeMember(c.db, { workspaceId: c.auth.workspaceId, by: sessionUser(c.auth), targetUserId: c.params.userId });
  return null;
});
