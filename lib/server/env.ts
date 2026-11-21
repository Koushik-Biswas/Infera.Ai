/**
 * Server configuration read from environment variables. Every variable is
 * documented in .env.example.
 */
export const isProd = process.env.NODE_ENV === "production";
export const isTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

/** Public base URL of this deployment, without trailing slash (used for webhook URLs and invite links). */
export function appUrl(): string {
  const raw =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export const signupsEnabled = () => process.env.SIGNUPS_ENABLED !== "false";

/** Background worker inside the Node server process (disable on serverless; use /api/cron instead). */
export const workerEnabled = () => process.env.INFERA_WORKER !== "off" && !isTest;

export const cronSecret = () => process.env.CRON_SECRET || "";

/** AI model for the processing pipeline and assistant. */
export const aiModel = () => process.env.INFERA_AI_MODEL || "claude-opus-5-5";
export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/**
 * Telegram account sync (MTProto): the server's app credentials from my.telegram.org.
 * They come ONLY from TELEGRAM_API_ID / TELEGRAM_API_HASH — users never enter them, and
 * per-channel credentials are not supported. Null when missing or malformed.
 * Never log the hash.
 */
export function telegramApiCredentials(): { apiId: number; apiHash: string } | null {
  const idRaw = (process.env.TELEGRAM_API_ID ?? "").trim();
  const apiHash = (process.env.TELEGRAM_API_HASH ?? "").trim();
  const apiId = /^\d{1,12}$/.test(idRaw) ? Number(idRaw) : NaN;
  return Number.isSafeInteger(apiId) && apiId > 0 && /^[0-9a-f]{32}$/i.test(apiHash) ? { apiId, apiHash } : null;
}

/** Shared Meta app for WhatsApp Cloud API (multi-tenant mode). Per-channel apps are also supported. */
export const whatsappAppSecret = () => process.env.WHATSAPP_APP_SECRET || "";
export const whatsappVerifyToken = () => process.env.WHATSAPP_VERIFY_TOKEN || "";

/** Largest media file stored per message (bytes). */
export const maxMediaBytes = () => Number(process.env.MAX_MEDIA_BYTES || 10 * 1024 * 1024);
