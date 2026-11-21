/**
 * Telegram account login helpers shared by the telegram_user connector and its tests:
 * readable, PII-free messages for Telegram RPC errors, phone masking, and the
 * admin message for missing / rejected server credentials.
 *
 * teleproto keeps the raw RPC code in `err.errorMessage` (e.g. "PASSWORD_HASH_INVALID",
 * "FLOOD_WAIT_120") and the wait in `err.seconds` for flood errors.
 */

/** TELEGRAM_API_ID / TELEGRAM_API_HASH missing or malformed on the server. */
export const TELEGRAM_CREDENTIALS_MISSING =
  "Telegram isn't set up on this server yet. An admin must add TELEGRAM_API_ID and TELEGRAM_API_HASH to .env.local and restart the server. See docs/CONNECTORS_SETUP.md.";

/** Telegram rejected the server's app credentials (API_ID_INVALID and friends). */
export const TELEGRAM_CREDENTIALS_REJECTED =
  "Telegram rejected this server's API credentials (API_ID_INVALID). An admin must check TELEGRAM_API_ID and TELEGRAM_API_HASH in .env.local (from my.telegram.org/apps) and restart the server.";

export const WRONG_PASSWORD = "Wrong password. Try again.";
export const WRONG_CODE = "That code isn't right. Check the latest message from Telegram and try again.";
export const CODE_EXPIRED = "That code expired, so Telegram sent a new one.";

/** Raw Telegram error code of an error thrown by teleproto ("" when it isn't one). */
export function rpcCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const e = err as { errorMessage?: unknown; message?: unknown };
  if (typeof e.errorMessage === "string" && /^[A-Z0-9_]+$/.test(e.errorMessage)) return e.errorMessage;
  return typeof e.message === "string" ? e.message : "";
}

/** Seconds Telegram asks us to wait (FLOOD_WAIT_X / FloodWaitError), or null. */
export function floodWaitSeconds(err: unknown): number | null {
  if (err && typeof err === "object" && typeof (err as { seconds?: unknown }).seconds === "number") {
    const s = (err as { seconds: number }).seconds;
    if (Number.isFinite(s) && s > 0) return Math.ceil(s);
  }
  const m = /FLOOD(?:_PREMIUM)?_WAIT_(\d+)/.exec(rpcCode(err)) ?? /wait (?:of )?(\d+) seconds/i.exec(err instanceof Error ? err.message : "");
  return m ? Number(m[1]) : null;
}

/** "45 seconds", "3 minutes", "1 hour 20 minutes". */
export function formatWait(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const totalMin = Math.ceil(s / 60);
  if (totalMin < 60) return `${totalMin} minute${totalMin === 1 ? "" : "s"}`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} hour${h === 1 ? "" : "s"}${m ? ` ${m} minute${m === 1 ? "" : "s"}` : ""}`;
}

/** "+91 •••••• 3210" — enough to recognise the number, never the full number. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 7) return "•••";
  return `+${d.slice(0, 2)} ${"•".repeat(Math.max(3, d.length - 6))} ${d.slice(-4)}`;
}

let promptSeq = 0;
/** Unique, increasing id for a ConnectionPrompt (`at`), so the console can tell a new prompt from one it already answered. */
export const promptStamp = () => `${new Date().toISOString()}#${++promptSeq}`;

/** teleproto's code-delivery type → ConnectionPrompt["via"]. */
export function codeVia(type: unknown): "app" | "sms" | "call" | "email" | "other" {
  if (type === "app" || type === "sms" || type === "call" || type === "email") return type;
  if (type === "flashCall" || type === "missedCall") return "call";
  if (type === "firebaseSms" || type === "smsWord" || type === "smsPhrase" || type === "fragmentSms") return "sms";
  return "other";
}

export type LoginErrorInfo = {
  /** Readable message for the console (no personal data). */
  message: string;
  /** Telegram asked us to wait this long before retrying. */
  waitSeconds?: number;
  /** Server credentials are wrong: retrying won't help until an admin fixes the env. */
  credentials?: true;
};

/**
 * Login errors the person connecting can act on (or that we wait out). Null = unexpected
 * (network etc.): the caller lets the sync manager restart the connector with backoff.
 */
export function describeLoginError(err: unknown): LoginErrorInfo | null {
  const wait = floodWaitSeconds(err);
  if (wait !== null) return { message: `Telegram asked us to wait ${formatWait(wait)} before trying again. Infera will retry automatically.`, waitSeconds: wait };
  const code = rpcCode(err);
  switch (code) {
    case "API_ID_INVALID":
    case "API_ID_PUBLISHED_FLOOD":
      return { message: TELEGRAM_CREDENTIALS_REJECTED, credentials: true };
    case "AUTH_TOKEN_EXPIRED":
    case "AUTH_TOKEN_INVALID":
    case "AUTH_TOKEN_ALREADY_ACCEPTED":
      return { message: "The QR code expired before the login finished. Scan the new code." };
    case "PASSWORD_HASH_INVALID":
      return { message: WRONG_PASSWORD };
    case "PHONE_PASSWORD_FLOOD":
      return { message: "Too many wrong passwords. Telegram blocked new attempts for a while — try again later.", waitSeconds: 300 };
    case "PHONE_NUMBER_INVALID":
      return { message: "That phone number isn't valid. Use the full number with country code, e.g. +91 98765 43210." };
    case "PHONE_NUMBER_BANNED":
      return { message: "Telegram has banned this phone number." };
    case "PHONE_NUMBER_FLOOD":
      return { message: "Telegram blocked login codes for this number for now because of too many attempts. Scan the QR code instead, or try later." };
    case "PHONE_NUMBER_UNOCCUPIED":
      return { message: "There's no Telegram account with this phone number." };
    case "PHONE_CODE_INVALID":
    case "PHONE_CODE_EMPTY":
      return { message: WRONG_CODE };
    case "PHONE_CODE_EXPIRED":
      return { message: CODE_EXPIRED };
    case "SESSION_PASSWORD_NEEDED":
      return null; // handled by the password step
  }
  const msg = err instanceof Error ? err.message : "";
  if (/No account is registered with this phone number/i.test(msg)) return { message: "There's no Telegram account with this phone number." };
  if (/requires a payment|login email|emailVerification|email to sign in/i.test(msg)) {
    return { message: "Telegram wants to confirm this login in a way Infera can't show here. Scan the QR code instead." };
  }
  return null;
}
