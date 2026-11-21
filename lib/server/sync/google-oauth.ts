/**
 * "Sign in with Google" for Gmail mailbox channels (OAuth 2.0, offline access, scope
 * https://mail.google.com/ for IMAP/SMTP XOAUTH2). Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 * and the redirect URI `${APP_URL}/api/oauth/google/callback` registered in Google Cloud.
 *
 * The refresh token is stored in the channel's encrypted auth blob (connector_sessions.auth_enc);
 * access tokens are minted on demand and cached in memory until shortly before they expire.
 */
import { createHmac } from "node:crypto";
import { appUrl } from "../env";
import { safeEqual } from "../crypto";

export type GoogleAuth = { provider: "google"; email: string; refreshToken: string };

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const googleRedirectUri = () => `${appUrl()}/api/oauth/google/callback`;
const SCOPE = "https://mail.google.com/ openid email";

const stateKey = () => createHmac("sha256", process.env.ENCRYPTION_KEY || "infera-insecure-development-key").update("google-oauth-state").digest();

/** Signed, expiring state binding the consent to a channel and the user who started it. */
export function signState(p: { channelId: string; userId: string }): string {
  const body = Buffer.from(JSON.stringify({ c: p.channelId, u: p.userId, e: Date.now() + 15 * 60_000 })).toString("base64url");
  return `${body}.${createHmac("sha256", stateKey()).update(body).digest("base64url")}`;
}

export function verifyState(state: string | null): { channelId: string; userId: string } | null {
  if (!state || state.length > 600) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig || !safeEqual(sig, createHmac("sha256", stateKey()).update(body).digest("base64url"))) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { c?: string; u?: string; e?: number };
    if (!v.c || !v.u || !v.e || v.e < Date.now()) return null;
    return { channelId: v.c, userId: v.u };
  } catch {
    return null;
  }
}

export function googleAuthUrl(state: string, loginHint?: string | null): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", googleRedirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  if (loginHint) u.searchParams.set("login_hint", loginHint);
  return u.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", ...params }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Google sign-in failed: ${String(body.error_description ?? body.error ?? res.status)}`);
  return body;
}

/** Authorization code → refresh token + the Google account's email (from the id_token we just received over TLS). */
export async function exchangeGoogleCode(code: string): Promise<GoogleAuth> {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: googleRedirectUri() });
  const refreshToken = typeof t.refresh_token === "string" ? t.refresh_token : null;
  const idToken = typeof t.id_token === "string" ? t.id_token : "";
  let email: string | null = null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string; email_verified?: boolean };
    email = payload.email_verified === false ? null : (payload.email?.toLowerCase() ?? null);
  } catch {
    email = null;
  }
  if (!refreshToken) throw new Error("Google did not return offline access. Remove Infera under Google Account → Security → Third-party access, then try again.");
  if (!email) throw new Error("Google did not share the account email.");
  if (typeof t.access_token === "string") cache.set(refreshToken, { token: t.access_token, until: Date.now() + (Number(t.expires_in ?? 3600) - 120) * 1000 });
  return { provider: "google", email, refreshToken };
}

const g = globalThis as unknown as { __inferaGoogleTokens?: Map<string, { token: string; until: number }> };
const cache = (g.__inferaGoogleTokens ??= new Map());

/** A valid access token for IMAP/SMTP XOAUTH2. */
export async function googleAccessToken(auth: GoogleAuth): Promise<string> {
  const hit = cache.get(auth.refreshToken);
  if (hit && hit.until > Date.now()) return hit.token;
  const t = await tokenRequest({ refresh_token: auth.refreshToken, grant_type: "refresh_token" });
  if (typeof t.access_token !== "string") throw new Error("Google did not return an access token.");
  cache.set(auth.refreshToken, { token: t.access_token, until: Date.now() + (Number(t.expires_in ?? 3600) - 120) * 1000 });
  return t.access_token;
}
