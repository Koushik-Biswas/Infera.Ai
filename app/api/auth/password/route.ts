/**
 * POST /api/auth/password {currentPassword, newPassword} → { ok, revokedSessions }.
 * Signs out every other session of the user (the current one stays valid).
 */
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { ApiError, unprocessable, userRoute } from "@/lib/server/api/handler";
import { hashPassword, verifyPassword } from "@/lib/server/crypto";
import { sessions, users } from "@/lib/server/db/schema";
import { writeAudit } from "@/lib/server/audit";
import { log } from "@/lib/server/http";
import { userActor } from "@/lib/server/auth/accounts";
import { assertPasswordPolicy, existingPasswordField, newPasswordField } from "@/lib/server/auth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ currentPassword: existingPasswordField, newPassword: newPasswordField });

// Per-user limit: guessing the current password from a hijacked session stays slow.
export const POST = userRoute({ rateLimit: { limit: 10, windowSec: 15 * 60 }, maxBodyBytes: 8 * 1024 }, async (c) => {
  const body = await c.body(Body);
  if (!(await verifyPassword(body.currentPassword, c.user.passwordHash))) {
    // 403, not 401: the session is fine, only the password is wrong.
    throw new ApiError(403, "invalid_password", "Your current password is incorrect.");
  }
  if (body.newPassword === body.currentPassword) throw unprocessable("newPassword: Choose a password that's different from your current one.");
  assertPasswordPolicy(body.newPassword, c.user.email, "newPassword");

  const passwordHash = await hashPassword(body.newPassword);
  const revokedSessions = await c.db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, c.user.id));
    const revoked = await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, c.user.id), ne(sessions.id, c.sessionId)))
      .returning({ id: sessions.id });
    // User-level event (not tenant data): no workspace, never any password material.
    await writeAudit(tx, { workspaceId: null, actor: userActor(c.user), action: "user.password_change", targetType: "user", targetId: c.user.id, meta: { revokedSessions: revoked.length } });
    return revoked.length;
  });
  log("info", "auth_password_changed", { userId: c.user.id, revokedSessions });
  return { ok: true, revokedSessions };
});
