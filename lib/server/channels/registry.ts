/**
 * Channel lookup, secrets and DTO mapping.
 *
 * Secrets (provider tokens, signing secrets) live AES-GCM encrypted in
 * `channels.secrets_enc` and are only decrypted server-side when a webhook is
 * verified or a provider API is called. They are never returned by the API:
 * the DTO only lists which secret names are set (rule 7).
 */
import { and, asc, eq } from "drizzle-orm";
import type { ChannelDTO, ChannelType } from "@/lib/shared/types";
import type { Database } from "../db";
import { channels, type ChannelRow } from "../db/schema";
import { decryptJson, newToken } from "../crypto";
import { appUrl } from "../env";
import { log } from "../http";
import { newId } from "../ids";

/** Secret names accepted per channel type (ARCHITECTURE §4). */
export const SECRET_NAMES: Record<ChannelType, readonly string[]> = {
  whatsapp_cloud: ["accessToken", "appSecret", "verifyToken"],
  telegram: ["botToken", "webhookSecret"],
  email: ["inboundSecret"],
  slack: ["botToken", "signingSecret"],
  sms_twilio: ["authToken", "accountSid"],
  api: [],
  whatsapp_export: [],
  // Persistent connectors: credentials live in connector_sessions.auth_enc after login.
  whatsapp_web: [],
  // Telegram account: no per-channel secrets — the server's TELEGRAM_API_ID / TELEGRAM_API_HASH are used;
  // the login session lives encrypted in connector_sessions.auth_enc.
  telegram_user: [],
  // IMAP/SMTP password (app password) when not using OAuth.
  email_imap: ["password"],
  // Meta Page/Instagram: page access token + app secret (per-channel app) + webhook verify token.
  instagram: ["pageAccessToken", "appSecret", "verifyToken"],
  messenger: ["pageAccessToken", "appSecret", "verifyToken"],
  // Unipile: API key; webhook secret verifies Unipile → Infera calls.
  linkedin: ["apiKey", "webhookSecret"],
};

/**
 * Per-channel Telegram API credentials stored by older versions. They are no longer accepted or used
 * (the server's TELEGRAM_API_ID / TELEGRAM_API_HASH are), are kept untouched on old rows, and are never
 * returned by the API.
 */
export const LEGACY_TELEGRAM_CONFIG_KEYS = ["apiId", "api_id"] as const;
export const LEGACY_TELEGRAM_SECRET_KEYS = ["apiHash", "api_hash"] as const;

/** Path segment of the per-channel webhook route for each type. */
const WEBHOOK_PATH: Partial<Record<ChannelType, string>> = {
  whatsapp_cloud: "whatsapp",
  telegram: "telegram",
  email: "email",
  slack: "slack",
  sms_twilio: "sms",
  instagram: "meta",
  messenger: "meta",
  linkedin: "unipile",
};

export type ChannelSecrets = Record<string, string>;

/** Decrypts a channel's secrets. Undecryptable secrets (rotated key) → {} and a PII-free warning. */
export function decryptSecrets(channel: Pick<ChannelRow, "id" | "secretsEnc">): ChannelSecrets {
  if (!channel.secretsEnc) return {};
  try {
    const out = decryptJson<ChannelSecrets>(channel.secretsEnc) ?? {};
    return typeof out === "object" && out !== null ? out : {};
  } catch {
    log("warn", "channel_secrets_undecryptable", { channelId: channel.id });
    return {};
  }
}

/** Webhook tokens are random base64url strings; reject anything else before touching the DB. */
export const isPlausibleToken = (token: string) => /^[A-Za-z0-9_-]{16,128}$/.test(token);

export async function findChannelByToken(db: Database, type: ChannelType, token: string): Promise<ChannelRow | null> {
  if (!isPlausibleToken(token)) return null;
  const rows = await db
    .select()
    .from(channels)
    .where(and(eq(channels.webhookToken, token), eq(channels.type, type)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findChannelByExternalId(db: Database, type: ChannelType, externalId: string): Promise<ChannelRow | null> {
  if (!externalId || externalId.length > 255) return null;
  const rows = await db
    .select()
    .from(channels)
    .where(and(eq(channels.type, type), eq(channels.externalId, externalId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Tenant-scoped lookup (rule 6): another workspace's channel id → null → 404. */
export async function getWorkspaceChannel(db: Database, workspaceId: string, id: string): Promise<ChannelRow | null> {
  if (!id || id.length > 64) return null;
  const rows = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, id), eq(channels.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * WhatsApp channels run in one of two modes:
 *  - per-channel app: the channel has its own `appSecret` → `/api/webhooks/whatsapp/<token>`;
 *  - shared app: the server's WHATSAPP_APP_SECRET → `/api/webhooks/whatsapp` (routed by phone_number_id).
 */
export const whatsappPerChannelMode = (secrets: ChannelSecrets) => Boolean(secrets.appSecret);

export function webhookUrlFor(row: ChannelRow, secrets: ChannelSecrets = decryptSecrets(row)): string | null {
  const base = appUrl();
  if (row.type === "api") return `${base}/api/v1/events`;
  if (row.type === "whatsapp_export") return null;
  if (row.type === "whatsapp_cloud" && !whatsappPerChannelMode(secrets)) return `${base}/api/webhooks/whatsapp`;
  const seg = WEBHOOK_PATH[row.type];
  return seg ? `${base}/api/webhooks/${seg}/${row.webhookToken}` : null;
}

export function toChannelDTO(row: ChannelRow): ChannelDTO {
  const secrets = decryptSecrets(row);
  let config = row.config ?? {};
  if (row.type === "telegram_user") {
    // Never surface legacy per-channel Telegram credentials (api_id / api_hash).
    config = Object.fromEntries(Object.entries(config).filter(([k]) => !(LEGACY_TELEGRAM_CONFIG_KEYS as readonly string[]).includes(k)));
    for (const k of LEGACY_TELEGRAM_SECRET_KEYS) delete secrets[k];
  }
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status,
    // The default API / export channels use an internal marker as externalId; don't surface it.
    externalId: row.type === "api" || row.type === "whatsapp_export" ? null : row.externalId,
    config,
    secretsSet: Object.keys(secrets)
      .filter((k) => Boolean(secrets[k]))
      .sort(),
    webhookUrl: webhookUrlFor(row, secrets),
    lastEventAt: row.lastEventAt ? row.lastEventAt.toISOString() : null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Get-or-create a per-workspace singleton channel (the default "API" channel,
 * the "WhatsApp imports" channel). Race-safe: the marker externalId hits the
 * unique (type, external_id) index, so concurrent callers converge on one row.
 */
async function ensureSingletonChannel(db: Database, workspaceId: string, type: "api" | "whatsapp_export", name: string): Promise<ChannelRow> {
  const marker = `${type === "api" ? "default" : "export"}:${workspaceId}`;
  const existing = await db
    .select()
    .from(channels)
    .where(and(eq(channels.workspaceId, workspaceId), eq(channels.type, type), eq(channels.externalId, marker)))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(channels)
    .values({ id: newId("chn"), workspaceId, type, name, externalId: marker, webhookToken: newToken(24), config: { default: true } })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const again = await db
    .select()
    .from(channels)
    .where(and(eq(channels.workspaceId, workspaceId), eq(channels.type, type), eq(channels.externalId, marker)))
    .limit(1);
  if (!again[0]) throw new Error(`Could not create the default ${type} channel`);
  return again[0];
}

/** The workspace's default `api` channel named "API" (created on demand). */
export const ensureApiChannel = (db: Database, workspaceId: string) => ensureSingletonChannel(db, workspaceId, "api", "API");

/** The workspace's `whatsapp_export` channel used by chat imports (created on demand). */
export const ensureExportChannel = (db: Database, workspaceId: string) => ensureSingletonChannel(db, workspaceId, "whatsapp_export", "WhatsApp imports");

/** Oldest channel of a type in the workspace (used when a caller doesn't name one). */
export async function firstChannelOfType(db: Database, workspaceId: string, type: ChannelType): Promise<ChannelRow | null> {
  const rows = await db
    .select()
    .from(channels)
    .where(and(eq(channels.workspaceId, workspaceId), eq(channels.type, type)))
    .orderBy(asc(channels.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
