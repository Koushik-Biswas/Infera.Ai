/**
 * Route wrapper for every JSON API route (app/api/v1/**, app/api/auth/**).
 *
 *   export const GET = workspaceRoute({ role: "viewer", scope: "read" }, async (c) => {
 *     const rows = await c.db.select()...where(eq(t.workspaceId, c.auth.workspaceId));
 *     return { items: rows, nextCursor: null };          // plain object → 200 JSON
 *   });
 *
 *   export const POST = workspaceRoute({ role: "member", scope: "write" }, async (c) => {
 *     const body = await c.body(z.object({ name: z.string().min(1) }));
 *     ...
 *     return created(dto);                                 // 201
 *   });
 *
 * What it does:
 *  - Authenticates: `Authorization: Bearer ifk_...` (API key) or the session cookie.
 *  - CSRF: cookie-authenticated non-GET requests must be same-origin.
 *  - Authorises: minimum role (viewer < member < admin < owner); API keys need the
 *    route's scope and can never use routes that require admin/owner.
 *  - Rate limits (per API key / user, or per IP for public routes).
 *  - Parses JSON bodies with a size cap and validates with zod (422 on failure).
 *  - Maps ApiError / ZodError to `{ error: { code, message, details } }`.
 *
 * Tenancy (rule 6): handlers MUST filter every query by `c.auth.workspaceId`
 * and return 404 (not 403) for ids that belong to another workspace.
 */
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { roleAtLeast, type Actor, type ApiScope, type Role } from "@/lib/shared/types";
import { getDb, type Database } from "../db";
import { apiKeys, type UserRow } from "../db/schema";
import { clientIp, isAllowedOrigin, log } from "../http";
import { rateLimit } from "../rate-limit";
import { sha256Hex } from "../crypto";
import { clearSessionCookie, hasSessionCookie, resolveSession, resolveSessionWithRole } from "../auth/session";

/* ------------------------------- Errors ------------------------------ */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, "bad_request", message, details);
export const unauthorized = (message = "Sign in to continue.") => new ApiError(401, "unauthorized", message);
export const forbidden = (message = "You don't have permission to do that.") => new ApiError(403, "forbidden", message);
export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found.`);
export const conflict = (message: string, details?: unknown) => new ApiError(409, "conflict", message, details);
export const unprocessable = (message: string, details?: unknown) => new ApiError(422, "invalid", message, details);
export const unavailable = (message: string) => new ApiError(503, "unavailable", message);

/* ------------------------------ Responses ---------------------------- */

const NO_STORE = { "Cache-Control": "no-store" };

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}
export const created = (body: unknown, headers: Record<string, string> = {}) => jsonResponse(body, 201, headers);
export const noContent = () => new NextResponse(null, { status: 204, headers: NO_STORE });

function errorResponse(e: ApiError) {
  return jsonResponse({ error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } }, e.status, e.headers);
}

/* ------------------------------- Context ----------------------------- */

export type AuthContext = {
  kind: "session" | "api_key";
  workspaceId: string;
  /** Effective role. API keys act as "member". */
  role: Role;
  userId: string | null;
  apiKeyId: string | null;
  scopes: readonly ApiScope[];
  actor: Actor;
  ip: string;
};

type BaseCtx<P> = {
  req: Request;
  params: P;
  db: Database;
  ip: string;
  query: URLSearchParams;
  /** Parse + validate the JSON body (size-capped). */
  body<T extends z.ZodType>(schema: T): Promise<z.infer<T>>;
  /** Extra headers merged into the response (e.g. Set-Cookie). */
  setHeader(name: string, value: string): void;
};

export type PublicCtx<P> = BaseCtx<P>;
export type UserCtx<P> = BaseCtx<P> & { user: UserRow; sessionId: string; workspaceId: string | null };
export type WorkspaceCtx<P> = BaseCtx<P> & { auth: AuthContext; user: UserRow | null; /** Session id (null for API keys). */ sessionId: string | null };

type RouteContext<P> = { params: Promise<P> };
type Result = Response | object | null | undefined;

type Common = {
  rateLimit?: { limit: number; windowSec: number };
  /** Max JSON body size in bytes (default 256 KB). */
  maxBodyBytes?: number;
};

/* ------------------------------- Helpers ----------------------------- */

const ALL_SCOPES: readonly ApiScope[] = ["ingest", "read", "write", "delete"];

async function readBody(req: Request, max: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) throw new ApiError(413, "too_large", "Request body is too large.");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new ApiError(413, "too_large", "Request body is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function makeBase<P>(req: Request, params: P, db: Database, opts: Common, headers: Record<string, string>): BaseCtx<P> {
  let bodyRead = false;
  return {
    req,
    params,
    db,
    ip: clientIp(req),
    query: new URL(req.url).searchParams,
    setHeader: (n, v) => {
      headers[n] = v;
    },
    async body(schema) {
      if (bodyRead) throw new Error("body() can only be called once");
      bodyRead = true;
      const type = req.headers.get("content-type") ?? "";
      if (!type.toLowerCase().startsWith("application/json")) throw new ApiError(415, "unsupported_media_type", "Content-Type must be application/json.");
      const text = await readBody(req, opts.maxBodyBytes ?? 256 * 1024);
      let raw: unknown;
      try {
        raw = text ? JSON.parse(text) : {};
      } catch {
        throw badRequest("Body is not valid JSON.");
      }
      return schema.parse(raw);
    },
  };
}

function withHeaders(res: Response, headers: Record<string, string>, started: number): Response {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "set-cookie") res.headers.append(k, v);
    else res.headers.set(k, v);
  }
  // Server-Timing: visible in the browser's network panel, for spotting slow endpoints.
  if (!res.headers.has("Server-Timing")) {
    try {
      res.headers.set("Server-Timing", `app;dur=${(performance.now() - started).toFixed(1)}`);
    } catch {
      /* immutable headers (e.g. Response.redirect) */
    }
  }
  return res;
}

async function finish(fn: () => Promise<Result>, headers: Record<string, string>, routeName: string): Promise<Response> {
  const started = performance.now();
  try {
    const out = await fn();
    const res = out instanceof Response ? out : out === undefined || out === null ? noContent() : jsonResponse(out);
    return withHeaders(res, headers, started);
  } catch (e) {
    if (e instanceof ApiError) return withHeaders(errorResponse(e), headers, started);
    if (e instanceof ZodError) {
      return withHeaders(
        errorResponse(unprocessable(e.issues[0] ? `${e.issues[0].path.join(".") || "body"}: ${e.issues[0].message}` : "Invalid input.", e.issues.map((i) => ({ path: i.path.join("."), message: i.message })))),
        headers,
        started,
      );
    }
    log("error", "api_error", { route: routeName, message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack?.split("\n").slice(0, 4).join(" | ") : undefined });
    return withHeaders(errorResponse(new ApiError(500, "internal", "Something went wrong. Please try again.")), headers, started);
  }
}

/** 401 for a missing/expired session; also clears a stale cookie so the /console proxy redirect can't loop. */
function sessionRequired(req: Request, headers: Record<string, string>): ApiError {
  if (hasSessionCookie(req)) headers["Set-Cookie"] = clearSessionCookie();
  return unauthorized();
}

async function limit(key: string, rl: Common["rateLimit"]) {
  if (!rl) return;
  const r = await rateLimit(key, rl.limit, rl.windowSec);
  if (!r.ok) throw new ApiError(429, "rate_limited", "Too many requests. Please slow down.", undefined, { "Retry-After": String(r.retryAfter) });
}

/**
 * Route pattern used for logs and rate-limit buckets: ids (`rec_…`) and opaque
 * tokens (invite/webhook tokens, ≥16 url-safe chars) collapse to placeholders,
 * so one bucket covers all values and token guessing can't evade the limit.
 */
const routeName = (req: Request) =>
  `${req.method} ${new URL(req.url).pathname
    .replace(/\/(?:[a-z]+_[0-9a-z]{20})(?=\/|$)/g, "/:id")
    .replace(/\/[A-Za-z0-9_-]{16,}(?=\/|$)/g, "/:token")}`;

/** CSRF: reject cross-site browser requests for state-changing methods. Use in publicRoute handlers that set cookies. */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  if (req.headers.get("sec-fetch-site") === "cross-site" || !isAllowedOrigin(req)) throw forbidden("Cross-site request blocked.");
}
const csrfCheck = assertSameOrigin;

/** Resolve an API key from `Authorization: Bearer ifk_...`. */
async function apiKeyAuth(db: Database, req: Request): Promise<AuthContext | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const key = header.slice(7).trim();
  if (!key.startsWith("ifk_") || key.length > 200) throw unauthorized("Invalid API key.");
  const now = new Date();
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, sha256Hex(key)), isNull(apiKeys.revokedAt), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now))))
    .limit(1);
  const k = rows[0];
  if (!k) throw unauthorized("Invalid or revoked API key.");
  if (!k.lastUsedAt || now.getTime() - k.lastUsedAt.getTime() > 60_000) {
    db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, k.id)).catch(() => {});
  }
  return {
    kind: "api_key",
    workspaceId: k.workspaceId,
    role: "member",
    userId: null,
    apiKeyId: k.id,
    scopes: k.scopes,
    actor: { type: "api_key", id: k.id, label: `API key ${k.name}` },
    ip: clientIp(req),
  };
}

/* ------------------------------- Wrappers ---------------------------- */

/**
 * No authentication (webhooks verify their own signatures; login/signup).
 * `sameOrigin: true` adds the CSRF check — use it for browser endpoints that set cookies.
 */
export function publicRoute<P = Record<string, string>>(opts: Common & { sameOrigin?: boolean }, fn: (c: PublicCtx<P>) => Promise<Result>) {
  return async (req: Request, ctx: RouteContext<P>): Promise<Response> => {
    const headers: Record<string, string> = {};
    return finish(
      async () => {
        if (opts.sameOrigin) assertSameOrigin(req);
        const db = await getDb();
        const base = makeBase(req, ctx?.params ? await ctx.params : ({} as P), db, opts, headers);
        await limit(`pub:${routeName(req)}:${base.ip}`, opts.rateLimit);
        return fn(base);
      },
      headers,
      routeName(req),
    );
  };
}

/** Signed-in user (session cookie), workspace optional. */
export function userRoute<P = Record<string, string>>(opts: Common, fn: (c: UserCtx<P>) => Promise<Result>) {
  return async (req: Request, ctx: RouteContext<P>): Promise<Response> => {
    const headers: Record<string, string> = {};
    return finish(
      async () => {
        const db = await getDb();
        const s = await resolveSession(db, req);
        if (!s) throw sessionRequired(req, headers);
        csrfCheck(req);
        if (s.refreshedCookie) headers["Set-Cookie"] = s.refreshedCookie;
        const base = makeBase(req, ctx?.params ? await ctx.params : ({} as P), db, opts, headers);
        await limit(`usr:${routeName(req)}:${s.user.id}`, opts.rateLimit);
        return fn({ ...base, user: s.user, sessionId: s.sessionId, workspaceId: s.workspaceId });
      },
      headers,
      routeName(req),
    );
  };
}

/**
 * Workspace-scoped route. `role` = minimum member role (default "viewer").
 * `scope` = API-key scope required; omit to forbid API keys entirely.
 */
export function workspaceRoute<P = Record<string, string>>(opts: Common & { role?: Role; scope?: ApiScope }, fn: (c: WorkspaceCtx<P>) => Promise<Result>) {
  const need: Role = opts.role ?? "viewer";
  return async (req: Request, ctx: RouteContext<P>): Promise<Response> => {
    const headers: Record<string, string> = {};
    return finish(
      async () => {
        const db = await getDb();
        let auth = await apiKeyAuth(db, req);
        let user: UserRow | null = null;
        let sessionId: string | null = null;
        if (auth) {
          if (!opts.scope) throw forbidden("This endpoint can't be used with an API key.");
          if (!roleAtLeast("member", need)) throw forbidden("This endpoint can't be used with an API key.");
          if (!auth.scopes.includes(opts.scope) && !(opts.scope === "read" && auth.scopes.includes("write"))) throw forbidden(`API key is missing the "${opts.scope}" scope.`);
        } else {
          // Session, user and membership role in a single query.
          const s = await resolveSessionWithRole(db, req);
          if (!s) throw sessionRequired(req, headers);
          csrfCheck(req);
          if (s.refreshedCookie) headers["Set-Cookie"] = s.refreshedCookie;
          if (!s.workspaceId) throw new ApiError(409, "no_workspace", "Create or join a workspace first.");
          if (!s.role) throw new ApiError(409, "no_workspace", "You are no longer a member of this workspace.");
          user = s.user;
          sessionId = s.sessionId;
          auth = {
            kind: "session",
            workspaceId: s.workspaceId,
            role: s.role,
            userId: s.user.id,
            apiKeyId: null,
            scopes: ALL_SCOPES,
            actor: { type: "user", id: s.user.id, label: s.user.name || s.user.email },
            ip: clientIp(req),
          };
          if (!roleAtLeast(auth.role, need)) throw forbidden();
        }
        const base = makeBase(req, ctx?.params ? await ctx.params : ({} as P), db, opts, headers);
        await limit(`ws:${routeName(req)}:${auth.apiKeyId ?? auth.userId}`, opts.rateLimit ?? { limit: 600, windowSec: 60 });
        return fn({ ...base, auth, user, sessionId });
      },
      headers,
      routeName(req),
    );
  };
}

/* ------------------------------ Pagination --------------------------- */

/** Opaque keyset cursor over (timestamp, id). */
export function encodeCursor(at: Date | string, id: string | number): string {
  return Buffer.from(`${typeof at === "string" ? at : at.toISOString()}|${id}`).toString("base64url");
}
export function decodeCursor(cursor: string | null): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const d = new Date(at);
    if (!id || Number.isNaN(d.getTime())) return null;
    return { at: d, id };
  } catch {
    return null;
  }
}
export function pageLimit(q: URLSearchParams, def = 50, max = 200): number {
  const n = Number(q.get("limit") ?? def);
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.floor(n))) : def;
}
