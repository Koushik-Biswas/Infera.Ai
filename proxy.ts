/**
 * Edge-fast optimistic auth redirect: a visitor without a session cookie who
 * opens /console is sent to /login immediately, without downloading or booting
 * the console. This is NOT the security boundary — every API route verifies
 * the session itself; a stale cookie still reaches the console, gets a 401
 * from the API (which also clears the cookie) and is redirected client-side.
 *
 * Single-user mode (INFERA_AUTO_LOGIN): /console goes to /api/auth/auto instead,
 * and /login, /signup (prerendered static pages) are skipped at request time.
 */
import { NextResponse, type NextRequest } from "next/server";
import { autoLoginEnabled } from "./lib/auto-login-flag";

const COOKIE_NAMES = ["__Host-infera_session", "infera_session"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const auto = autoLoginEnabled();
  if (pathname === "/login" || pathname === "/signup") {
    if (!auto) return NextResponse.next();
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    url.pathname = "/api/auth/auto";
    url.search = next ? `?next=${encodeURIComponent(next)}` : "";
    return NextResponse.redirect(url);
  }
  const hasSession = COOKIE_NAMES.some((n) => request.cookies.get(n)?.value);
  if (hasSession) return NextResponse.next();
  const url = request.nextUrl.clone();
  const next = pathname + request.nextUrl.search;
  url.pathname = auto ? "/api/auth/auto" : "/login";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/console", "/console/:path*", "/login", "/signup"],
};
