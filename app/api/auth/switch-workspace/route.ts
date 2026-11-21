/**
 * POST /api/auth/switch-workspace {workspaceId} → MeDTO. Only workspaces the
 * user belongs to (others → 404, never revealing that they exist).
 */
import { z } from "zod";
import { notFound, userRoute } from "@/lib/server/api/handler";
import { setSessionWorkspace } from "@/lib/server/auth/session";
import { getMe, membershipRole } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ workspaceId: z.string().min(1).max(64) });

export const POST = userRoute({ rateLimit: { limit: 60, windowSec: 60 } }, async (c) => {
  const { workspaceId } = await c.body(Body);
  const role = await membershipRole(c.db, workspaceId, c.user.id);
  if (!role) throw notFound("Workspace");
  await setSessionWorkspace(c.db, c.sessionId, workspaceId);
  return getMe(c.db, c.user.id, workspaceId);
});
