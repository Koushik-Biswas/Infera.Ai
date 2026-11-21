/**
 * POST /api/auth/signup {name, email, password, workspaceName?} → MeDTO (201) + session cookie.
 * Creates the user, their first workspace (with default collections) and a session.
 */
import { z } from "zod";
import { ApiError, conflict, created, publicRoute } from "@/lib/server/api/handler";
import { signupsEnabled } from "@/lib/server/env";
import { hashPassword } from "@/lib/server/crypto";
import { log } from "@/lib/server/http";
import { createSession, destroySession } from "@/lib/server/auth/session";
import { DUPLICATE_EMAIL_MESSAGE, insertUser, userActor } from "@/lib/server/auth/accounts";
import { assertPasswordPolicy, assertSameOrigin, emailField, newPasswordField, optionalWorkspaceNameField, personNameField } from "@/lib/server/auth/validation";
import { createWorkspace, getMe } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: personNameField,
  email: emailField,
  password: newPasswordField,
  workspaceName: optionalWorkspaceNameField,
});

export const POST = publicRoute({ rateLimit: { limit: 5, windowSec: 600 }, maxBodyBytes: 8 * 1024 }, async (c) => {
  assertSameOrigin(c.req);
  if (!signupsEnabled()) throw new ApiError(403, "signups_disabled", "Sign-ups are closed on this server. Ask a workspace admin for an invitation.");
  const body = await c.body(Body);
  assertPasswordPolicy(body.password, body.email);

  // Hash before touching the database so a duplicate email costs the same time as a new one.
  const passwordHash = await hashPassword(body.password);
  const { user, workspace } = await c.db.transaction(async (tx) => {
    const user = await insertUser(tx, { name: body.name, email: body.email, passwordHash });
    if (!user) throw conflict(DUPLICATE_EMAIL_MESSAGE);
    const workspace = await createWorkspace(tx, { name: body.workspaceName || `${body.name}'s workspace`, ownerUserId: user.id, actor: userActor(user) });
    return { user, workspace };
  });

  // Replace any session this browser already had.
  await destroySession(c.db, c.req);
  const session = await createSession(c.db, { userId: user.id, workspaceId: workspace.id, ip: c.ip, userAgent: c.req.headers.get("user-agent") });
  c.setHeader("Set-Cookie", session.cookie);
  log("info", "auth_signup", { userId: user.id, workspaceId: workspace.id });
  return created(await getMe(c.db, user.id, workspace.id));
});
