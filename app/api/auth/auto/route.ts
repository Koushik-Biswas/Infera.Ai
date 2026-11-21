/**
 * GET /api/auth/auto?next=/console/connect — single-user auto sign-in (lib/server/auth/auto-login.ts).
 * Signs this browser in as the owner and redirects to `next` (a same-site path).
 * When auto sign-in is off, redirects to the normal /login page instead.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { createSession, resolveSession } from "@/lib/server/auth/session";
import { autoLoginEnabled, ensureAutoLoginUser } from "@/lib/server/auth/auto-login";
import { log } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const START = "/console/connect";

function safeNext(v: string | null): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || /[\r\n\t]/.test(v) || /^\/(login|signup|api\/auth)(\/|\?|$)/.test(v)) return START;
  return v.slice(0, 500);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const to = (path: string) => new URL(path, url.origin);
  if (!autoLoginEnabled()) return NextResponse.redirect(to(`/login?next=${encodeURIComponent(next)}`), 303);

  const db = await getDb();
  if (await resolveSession(db, req)) return NextResponse.redirect(to(next), 303);
  const { user, workspaceId } = await ensureAutoLoginUser(db);
  const session = await createSession(db, { userId: user.id, workspaceId, ip: null, userAgent: req.headers.get("user-agent") });
  log("info", "auth_auto_login", { userId: user.id, workspaceId });
  const res = NextResponse.redirect(to(next), 303);
  res.headers.append("Set-Cookie", session.cookie);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
