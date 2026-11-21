/**
 * GET /api/auth/me → MeDTO for the signed-in user. If the session's workspace
 * is unset or the membership is gone, the most recently joined workspace
 * becomes active (workspace is null only when the user has none).
 */
import { userRoute } from "@/lib/server/api/handler";
import { getMeForSession } from "@/lib/server/workspaces";
import { autoLoginEnabled } from "@/lib/auto-login-flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = userRoute({}, async (c) => ({ ...(await getMeForSession(c.db, { userId: c.user.id, sessionId: c.sessionId, workspaceId: c.workspaceId })), autoLogin: autoLoginEnabled() }));
