/**
 * POST /api/auth/login {email, password} → MeDTO + session cookie.
 * Rate limited per IP (wrapper) and per account email; constant-ish timing for
 * unknown emails (a real scrypt verify always runs).
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { ApiError, publicRoute } from "@/lib/server/api/handler";
import { dummyPasswordHash, sha256Hex, verifyPassword } from "@/lib/server/crypto";
import { users } from "@/lib/server/db/schema";
import { log } from "@/lib/server/http";
import { enforceLimit } from "@/lib/server/auth/limits";
import { createSession, destroySession } from "@/lib/server/auth/session";
import { assertSameOrigin, existingPasswordField } from "@/lib/server/auth/validation";
import { getMe, latestWorkspaceId } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  email: z
    .string()
    .max(320)
    .transform((v) => v.trim().toLowerCase()),
  password: existingPasswordField,
});

const PER_EMAIL = { limit: 5, windowSec: 15 * 60 };

export const POST = publicRoute({ rateLimit: { limit: 10, windowSec: 60 }, maxBodyBytes: 8 * 1024 }, async (c) => {
  assertSameOrigin(c.req);
  const body = await c.body(Body);

  await enforceLimit(`login:email:${sha256Hex(body.email)}`, PER_EMAIL.limit, PER_EMAIL.windowSec, "Too many sign-in attempts. Please wait a few minutes and try again.");

  const [user] = body.email ? await c.db.select().from(users).where(eq(users.email, body.email)).limit(1) : [];
  const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyPasswordHash()));
  if (!user || !ok) {
    log("warn", "auth_login_failed", { ip: c.ip });
    throw new ApiError(401, "invalid_credentials", "Incorrect email or password.");
  }

  // Replace any session this browser already had.
  await destroySession(c.db, c.req);
  const workspaceId = await latestWorkspaceId(c.db, user.id);
  const session = await createSession(c.db, { userId: user.id, workspaceId, ip: c.ip, userAgent: c.req.headers.get("user-agent") });
  await c.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  c.setHeader("Set-Cookie", session.cookie);
  log("info", "auth_login", { userId: user.id });
  return getMe(c.db, user.id, workspaceId);
});
