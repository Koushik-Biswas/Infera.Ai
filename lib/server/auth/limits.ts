/**
 * Fixed-key rate limits for identity routes.
 *
 * The route wrappers key their limits by route path, which for token-bearing
 * paths (/api/invitations/<token>) means one bucket per token — useless against
 * token guessing. These helpers use stable keys (per IP, per account) instead.
 */
import { ApiError } from "../api/handler";
import { rateLimit } from "../rate-limit";
import { log } from "../http";

export async function enforceLimit(key: string, limit: number, windowSec: number, message = "Too many requests. Please slow down."): Promise<void> {
  const r = await rateLimit(key, limit, windowSec);
  if (!r.ok) {
    // The key may contain an IP or an email hash; log only its kind.
    log("warn", "auth_rate_limited", { kind: key.split(":").slice(0, 2).join(":") });
    throw new ApiError(429, "rate_limited", message, undefined, { "Retry-After": String(r.retryAfter) });
  }
}
