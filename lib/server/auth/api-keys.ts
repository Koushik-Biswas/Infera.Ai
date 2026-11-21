/**
 * Workspace API keys: `ifk_live_` + 32 random base64url characters. Only the
 * SHA-256 is stored (the route wrapper authenticates by hash); the first 16
 * characters are kept as a non-secret prefix so people can tell keys apart.
 */
import { newToken, sha256Hex } from "../crypto";

export const API_KEY_PREFIX = "ifk_live_";
export const API_KEY_DISPLAY_PREFIX_LENGTH = 16;
/** Active (non-revoked) keys allowed per workspace (abuse guard). */
export const MAX_ACTIVE_API_KEYS = 50;

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `${API_KEY_PREFIX}${newToken(24)}`;
  return { key, prefix: key.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH), hash: sha256Hex(key) };
}
