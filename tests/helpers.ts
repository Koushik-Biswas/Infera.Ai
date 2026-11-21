/**
 * Test helpers. Every test file runs against its own in-memory Postgres
 * (PGlite, see vitest.config.ts), migrated from ./drizzle on first getDb().
 *
 *   const ws = await createTestWorkspace();
 *   const res = await call(GET, { url: "/api/v1/collections", cookie: ws.cookie });
 *   const res2 = await call(POST, { url: "/api/v1/events", apiKey: ws.apiKey, body: {...} });
 */
import { openBytes, openText } from "@/lib/server/data/sealed";
import { getDb } from "@/lib/server/db";
import { apiKeys, memberships, sessions, users, workspaces } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { newToken, sha256Hex } from "@/lib/server/crypto";
import { defaultWorkspaceSettings, type ApiScope, type Role } from "@/lib/shared/types";
import { sessionCookieName } from "@/lib/server/auth/session";

export const BASE = "http://localhost:3000";

export type TestWorkspace = {
  userId: string;
  workspaceId: string;
  email: string;
  /** Session token and Cookie header value. */
  token: string;
  cookie: string;
  /** API key with all scopes. */
  apiKey: string;
};

let n = 0;

/** Creates a user + workspace (+ owner membership, session, API key) directly in the DB. */
export async function createTestWorkspace(opts: { role?: Role; name?: string; scopes?: ApiScope[] } = {}): Promise<TestWorkspace> {
  const db = await getDb();
  n++;
  const userId = newId("usr");
  const workspaceId = newId("ws");
  const email = `user${n}-${userId.slice(-6)}@example.com`;
  await db.insert(users).values({ id: userId, email, name: `Test User ${n}`, passwordHash: "scrypt$invalid" });
  await db.insert(workspaces).values({ id: workspaceId, name: opts.name ?? `Workspace ${n}`, slug: `ws-${workspaceId.slice(-10)}`, settings: { ...defaultWorkspaceSettings, aiMode: "off" } });
  await db.insert(memberships).values({ workspaceId, userId, role: opts.role ?? "owner" });
  const token = newToken();
  await db.insert(sessions).values({ id: sha256Hex(token), userId, workspaceId, expiresAt: new Date(Date.now() + 86_400_000) });
  const apiKey = `ifk_test_${newToken(24)}`;
  await db.insert(apiKeys).values({ id: newId("key"), workspaceId, name: "test", prefix: apiKey.slice(0, 12), keyHash: sha256Hex(apiKey), scopes: opts.scopes ?? ["ingest", "read", "write", "delete"] });
  return { userId, workspaceId, email, token, cookie: `${sessionCookieName()}=${token}`, apiKey };
}

/** Adds another user to an existing workspace with the given role. */
export async function addMember(workspaceId: string, role: Role): Promise<TestWorkspace> {
  const db = await getDb();
  n++;
  const userId = newId("usr");
  const email = `member${n}-${userId.slice(-6)}@example.com`;
  await db.insert(users).values({ id: userId, email, name: `Member ${n}`, passwordHash: "scrypt$invalid" });
  await db.insert(memberships).values({ workspaceId, userId, role });
  const token = newToken();
  await db.insert(sessions).values({ id: sha256Hex(token), userId, workspaceId, expiresAt: new Date(Date.now() + 86_400_000) });
  return { userId, workspaceId, email, token, cookie: `${sessionCookieName()}=${token}`, apiKey: "" };
}

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;

/** Invoke a route handler directly. Cookie requests get a same-origin Origin header. */
export async function call<P = Record<string, string>>(
  handler: Handler<P>,
  opts: { url: string; method?: string; body?: unknown; cookie?: string; apiKey?: string; params?: P; headers?: Record<string, string>; rawBody?: string | Uint8Array },
): Promise<{ status: number; json: any; headers: Headers }> {
  const headers: Record<string, string> = { host: "localhost:3000", ...opts.headers };
  if (opts.cookie) {
    headers.cookie = opts.cookie;
    headers.origin ??= BASE;
  }
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  let body: BodyInit | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody as BodyInit;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] ??= "application/json";
  }
  const method = opts.method ?? (body !== undefined ? "POST" : "GET");
  const req = new Request(new URL(opts.url, BASE), { method, headers, body });
  const res = await handler(req, { params: Promise.resolve((opts.params ?? {}) as P) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

/** Test view of sealed rows: decrypts message text, conversation previews and file bytes (lib/server/data/sealed.ts). */
export function opened<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => {
    const o: Record<string, unknown> = { ...r };
    if (typeof o.text === "string") o.text = openText(o.text);
    if (typeof o.lastMessagePreview === "string") o.lastMessagePreview = openText(o.lastMessagePreview);
    if (o.data instanceof Uint8Array) o.data = openBytes(Buffer.from(o.data));
    return o as T;
  });
}
