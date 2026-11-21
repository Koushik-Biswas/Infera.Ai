/**
 * POST /api/auth/logout → 204, always clears the cookie (also when the session
 * is already gone, so a stale browser can always sign out).
 */
import { publicRoute } from "@/lib/server/api/handler";
import { clearSessionCookie, destroySession } from "@/lib/server/auth/session";
import { assertSameOrigin } from "@/lib/server/auth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = publicRoute({ rateLimit: { limit: 60, windowSec: 60 } }, async (c) => {
  assertSameOrigin(c.req);
  await destroySession(c.db, c.req);
  c.setHeader("Set-Cookie", clearSessionCookie());
  return null;
});
