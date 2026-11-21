/**
 * GET /api/invitations/:token → { workspaceName, email, role, expired, accepted, expiresAt }
 * Public (the token is the credential), rate limited per IP; unknown → 404.
 */
import { notFound, publicRoute } from "@/lib/server/api/handler";
import { findInvitationByToken, invitationExpired } from "@/lib/server/auth/invitations";
import { enforceLimit } from "@/lib/server/auth/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Limited per IP across all tokens (the wrapper's limit would be per token).
export const GET = publicRoute<{ token: string }>({}, async (c) => {
  await enforceLimit(`invite:view:${c.ip}`, 30, 60);
  const found = await findInvitationByToken(c.db, c.params.token);
  if (!found) throw notFound("Invitation");
  const { invitation, workspace } = found;
  return {
    workspaceName: workspace.name,
    email: invitation.email,
    role: invitation.role,
    expired: invitationExpired(invitation),
    accepted: invitation.acceptedAt !== null,
    expiresAt: invitation.expiresAt.toISOString(),
  };
});
