/**
 * Cookie sessions. The cookie holds a random token; the database stores only
 * its SHA-256 (a leaked DB can't be replayed as sessions). Sliding expiry.
 */
import { and, eq, gt } from "drizzle-orm";
import type { Database } from "../db";
import type { Role } from "@/lib/shared/types";
import { memberships, sessions, users, type UserRow } from "../db/schema";
import { appUrl } from "../env";
import { newToken, sha256Hex } from "../crypto";

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const REFRESH_AFTER_MS = 24 * 3600 * 1000;

const secureCookies = () => appUrl().startsWith("https://");
export const sessionCookieName = () => (secureCookies() ? "__Host-infera_session" : "infera_session");

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** `Set-Cookie` header value for a new session. */
export function sessionCookie(token: string, expiresAt: Date): string {
  return [`${sessionCookieName()}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Expires=${expiresAt.toUTCString()}`, secureCookies() ? "Secure" : ""]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(): string {
  return [`${sessionCookieName()}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", secureCookies() ? "Secure" : ""].filter(Boolean).join("; ");
}

export async function createSession(db: Database, input: { userId: string; workspaceId: string | null; ip?: string | null; userAgent?: string | null }) {
  const token = newToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: sha256Hex(token),
    userId: input.userId,
    workspaceId: input.workspaceId,
    expiresAt,
    ip: input.ip?.slice(0, 64) ?? null,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt, cookie: sessionCookie(token, expiresAt) };
}

export type ResolvedSession = { sessionId: string; workspaceId: string | null; user: UserRow; refreshedCookie: string | null };

export async function resolveSession(db: Database, request: Request): Promise<ResolvedSession | null> {
  const token = readCookie(request, sessionCookieName());
  if (!token || token.length > 200) return null;
  const id = sha256Hex(token);
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  let refreshedCookie: string | null = null;
  if (Date.now() - row.session.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt }).where(eq(sessions.id, id));
    refreshedCookie = sessionCookie(token, expiresAt);
  }
  return { sessionId: id, workspaceId: row.session.workspaceId, user: row.user, refreshedCookie };
}

export type ResolvedSessionWithRole = ResolvedSession & { role: Role | null };

/**
 * Session + user + membership role in ONE round trip (the hot path of every
 * workspace API call). `role` is null when the session has no active
 * workspace or the user is no longer a member of it.
 */
export async function resolveSessionWithRole(db: Database, request: Request): Promise<ResolvedSessionWithRole | null> {
  const token = readCookie(request, sessionCookieName());
  if (!token || token.length > 200) return null;
  const id = sha256Hex(token);
  const rows = await db
    .select({ session: sessions, user: users, role: memberships.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(memberships, and(eq(memberships.workspaceId, sessions.workspaceId), eq(memberships.userId, sessions.userId)))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  let refreshedCookie: string | null = null;
  if (Date.now() - row.session.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt }).where(eq(sessions.id, id));
    refreshedCookie = sessionCookie(token, expiresAt);
  }
  return { sessionId: id, workspaceId: row.session.workspaceId, user: row.user, refreshedCookie, role: row.role ?? null };
}

/** True when the request carries a session cookie (valid or not). */
export const hasSessionCookie = (request: Request) => Boolean(readCookie(request, sessionCookieName()));

export async function destroySession(db: Database, request: Request) {
  const token = readCookie(request, sessionCookieName());
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256Hex(token)));
}

export async function setSessionWorkspace(db: Database, sessionId: string, workspaceId: string | null) {
  await db.update(sessions).set({ workspaceId }).where(eq(sessions.id, sessionId));
}
