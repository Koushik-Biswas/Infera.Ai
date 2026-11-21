/**
 * Whether single-user auto sign-in is on (no login screens). Dependency-free so proxy.ts can use it.
 *   INFERA_AUTO_LOGIN=1 on (required in production) · =0 off · unset: on in development, off in production.
 */
export function autoLoginEnabled(): boolean {
  const v = (process.env.INFERA_AUTO_LOGIN ?? "").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on") return true;
  if (v === "0" || v === "false" || v === "off") return false;
  return process.env.NODE_ENV !== "production";
}
