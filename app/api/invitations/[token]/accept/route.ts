/**
 * POST /api/invitations/:token/accept → MeDTO
 *
 *  - Signed in: the account email must equal the invited email (403 otherwise).
 *  - Signed out: body {name, password} creates an account with the invited
 *    email (works even when public sign-ups are disabled) → 201 + cookie.
 *
 * Adds the membership (idempotent), marks the invite accepted, and makes the
 * workspace active. Expired or used invitations → 410.
 */
import { z } from "zod";
import { ApiError, created, notFound, publicRoute } from "@/lib/server/api/handler";
import { hashPassword } from "@/lib/server/crypto";
import { log } from "@/lib/server/http";
import { createSession, resolveSession, setSessionWorkspace } from "@/lib/server/auth/session";
import { insertUser, userActor } from "@/lib/server/auth/accounts";
import { acceptInvitation, assertInvitationUsable, findInvitationByToken } from "@/lib/server/auth/invitations";
import { enforceLimit } from "@/lib/server/auth/limits";
import { assertPasswordPolicy, assertSameOrigin, newPasswordField, personNameField } from "@/lib/server/auth/validation";
import { getMe } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NewAccount = z.object({ name: personNameField, password: newPasswordField });

// Limited per IP across all tokens (the wrapper's limit would be per token).
export const POST = publicRoute<{ token: string }>({ maxBodyBytes: 8 * 1024 }, async (c) => {
  await enforceLimit(`invite:accept:${c.ip}`, 10, 600);
  assertSameOrigin(c.req);
  const found = await findInvitationByToken(c.db, c.params.token);
  if (!found) throw notFound("Invitation");
  const { invitation } = found;
  assertInvitationUsable(invitation);

  const session = await resolveSession(c.db, c.req);
  if (session) {
    if (session.refreshedCookie) c.setHeader("Set-Cookie", session.refreshedCookie);
    if (session.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new ApiError(403, "email_mismatch", "This invitation was sent to a different email address. Sign out, then open the link again to sign in with the invited account.");
    }
    await c.db.transaction((tx) => acceptInvitation(tx, { invitation, userId: session.user.id, actor: userActor(session.user) }));
    await setSessionWorkspace(c.db, session.sessionId, invitation.workspaceId);
    log("info", "invitation_accepted", { workspaceId: invitation.workspaceId, userId: session.user.id, newAccount: false });
    return getMe(c.db, session.user.id, invitation.workspaceId);
  }

  const body = await c.body(NewAccount);
  assertPasswordPolicy(body.password, invitation.email);
  const passwordHash = await hashPassword(body.password);
  const user = await c.db.transaction(async (tx) => {
    const user = await insertUser(tx, { name: body.name, email: invitation.email, passwordHash });
    if (!user) throw new ApiError(409, "account_exists", "An account with this email already exists. Sign in first, then open the invitation link again.");
    await acceptInvitation(tx, { invitation, userId: user.id, actor: userActor(user) });
    return user;
  });
  const s = await createSession(c.db, { userId: user.id, workspaceId: invitation.workspaceId, ip: c.ip, userAgent: c.req.headers.get("user-agent") });
  c.setHeader("Set-Cookie", s.cookie);
  log("info", "invitation_accepted", { workspaceId: invitation.workspaceId, userId: user.id, newAccount: true });
  return created(await getMe(c.db, user.id, invitation.workspaceId));
});
