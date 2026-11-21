/**
 * Fixed-window rate limiter.
 *
 * - If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, counts are
 *   shared across every server instance through Upstash Redis's REST API (no
 *   extra dependency). Use this when running more than one instance or on
 *   serverless platforms.
 * - Otherwise counts are kept in this process's memory (fine for a single
 *   server; per-instance on serverless).
 *
 * Fails open: if Redis is unreachable the request is allowed, so an outage of
 * the limiter never takes the forms down.
 */

type Result = { ok: boolean; retryAfter: number };

const MAX_KEYS = 10_000;
const memory = new Map<string, { count: number; resetAt: number }>();

function memoryLimit(key: string, limit: number, windowSec: number): Result {
  const now = Date.now();
  let entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    if (memory.size >= MAX_KEYS) {
      // Evict expired entries first; if still full, drop the oldest inserted.
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
      if (memory.size >= MAX_KEYS) memory.delete(memory.keys().next().value as string);
    }
    entry = { count: 0, resetAt: now + windowSec * 1000 };
    memory.set(key, entry);
  }
  entry.count++;
  return { ok: entry.count <= limit, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
}

async function redisLimit(url: string, token: string, key: string, limit: number, windowSec: number): Promise<Result> {
  const k = `rl:${key}`;
  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", k],
      ["EXPIRE", k, String(windowSec), "NX"],
      ["TTL", k],
    ]),
    signal: AbortSignal.timeout(1500),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const [incr, , ttl] = (await res.json()) as { result: number }[];
  return { ok: incr.result <= limit, retryAfter: Math.max(1, ttl.result) };
}

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<Result> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      return await redisLimit(url, token, key, limit, windowSec);
    } catch (e) {
      console.error(JSON.stringify({ level: "error", event: "rate_limiter_unavailable", message: String(e) }));
      return memoryLimit(key, limit, windowSec);
    }
  }
  return memoryLimit(key, limit, windowSec);
}
