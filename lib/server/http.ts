/**
 * Shared request hardening for the API routes:
 * body-size limit, JSON-only, same-origin (CSRF) check, rate limiting,
 * no-store responses and PII-free structured logging.
 */
import { NextResponse } from "next/server";
import { rateLimit } from "./rate-limit";
import { site } from "@/lib/site";

export const MAX_BODY_BYTES = 16 * 1024;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Structured log line without personal data (no names, emails or numbers). */
export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Browsers always send Origin on cross-site POSTs. Reject when it doesn't match
 * this site's host, site.url, or ALLOWED_ORIGINS. Requests with no Origin are non-browser
 * clients and can't carry a victim's cookies, so they're allowed through.
 */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0].trim();
  if (host && originHost === host) return true;
  const extra = [site.url, ...(process.env.ALLOWED_ORIGINS ?? "").split(",")]
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.some((o) => {
    try {
      return new URL(o).host === originHost;
    } catch {
      return false;
    }
  });
}

type Guarded = { ok: true; body: Record<string, unknown>; ip: string } | { ok: false; response: NextResponse };

/**
 * Runs every check a public form endpoint needs and returns the parsed JSON
 * body, or a ready-made error response.
 */
export async function guardJsonPost(
  request: Request,
  opts: { route: string; limit: number; windowSec: number; maxBytes?: number },
): Promise<Guarded> {
  const fail = (status: number, error: string, headers?: Record<string, string>) =>
    ({ ok: false, response: json({ error }, status, headers) }) as const;

  if (!isAllowedOrigin(request)) {
    log("warn", "origin_rejected", { route: opts.route });
    return fail(403, "Forbidden.");
  }

  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) return fail(415, "Content-Type must be application/json.");

  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return fail(413, "Request too large.");

  const ip = clientIp(request);
  const rl = await rateLimit(`${opts.route}:${ip}`, opts.limit, opts.windowSec);
  if (!rl.ok) {
    log("warn", "rate_limited", { route: opts.route });
    return fail(429, "Too many requests. Please wait a minute and try again.", { "Retry-After": String(rl.retryAfter) });
  }

  // Read with a hard cap: Content-Length can be absent or wrong (chunked bodies).
  let text: string;
  try {
    text = await readCapped(request, maxBytes);
  } catch (e) {
    if (e instanceof BodyTooLarge) return fail(413, "Request too large.");
    return fail(400, "Invalid request.");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "Invalid request.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "Invalid request.");

  return { ok: true, body: body as Record<string, unknown>, ip };
}

class BodyTooLarge extends Error {}

async function readCapped(request: Request, max: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/** Trim, drop control characters (keeping newlines if allowed) and cap length. */
export function cleanText(v: unknown, max: number, { multiline = false } = {}): string {
  if (typeof v !== "string") return "";
  const stripped = multiline
    ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    : v.replace(/[\u0000-\u001F\u007F]/g, " ");
  return stripped.trim().slice(0, max);
}
