/**
 * Contract for persistent connectors (WhatsApp linked device, Telegram user
 * account, IMAP mailbox). A connector is started by the sync manager on the
 * ONE server instance holding the channel's lease, keeps a live connection,
 * and turns provider events into ingested messages via `ctx.ingest`.
 *
 *   export const createConnector: ConnectorFactory = async (ctx) => {
 *     const client = await connect(await ctx.getAuth(), { signal: ctx.signal });
 *     await ctx.update({ state: "connected", account: { name } });
 *     client.on("message", (m) => ctx.ingest(toParsedInbound(m)).catch(ctx.fail));
 *     return { stop: () => client.close(), command: async (cmd) => { ... } };
 *   };
 *
 * Rules: never log message text or personal data (use ctx.log); store all
 * credentials via ctx.setAuth / ctx.kv (encrypted at rest); respect ctx.signal;
 * report fatal errors with ctx.fail(err) (the manager restarts with backoff) and
 * a logged-out account with ctx.update({ state: "logged_out" }) + ctx.setAuth(null).
 */
import type { ConnectionCommand, ConnectionPrompt, ConnectorState, SyncProgress } from "@/lib/shared/types";
import type { ChannelRow } from "../db/schema";
import type { Database } from "../db";
import type { IngestResult, ParsedInbound } from "../channels/types";

export type SessionPatch = Partial<{
  state: ConnectorState;
  qr: string | null;
  qrExpiresAt: Date | null;
  pairingCode: string | null;
  /** Input the login flow waits for (shown in the console); null clears it. */
  prompt: ConnectionPrompt | null;
  account: { id?: string; name?: string; phone?: string; email?: string } | null;
  progress: SyncProgress | null;
  lastConnectedAt: Date | null;
  lastSyncAt: Date | null;
  lastError: string | null;
}>;

export type KvStore = {
  get<T = unknown>(key: string): Promise<T | null>;
  getMany<T = unknown>(keys: string[]): Promise<Record<string, T>>;
  /** `null` deletes. */
  set(key: string, value: unknown | null): Promise<void>;
  setMany(entries: Record<string, unknown | null>): Promise<void>;
  /** Delete every key (optionally only those starting with `prefix`). */
  clear(prefix?: string): Promise<void>;
};

export type IngestOptions = {
  /** Historical backfill: no unread bump, no message.received/automations; processed at low priority. */
  historical?: boolean;
  priority?: number;
  /** Store without classification/extraction (can be backfilled later). */
  skipProcessing?: boolean;
};

export type ConnectorContext = {
  db: Database;
  /** Channel row as of start (re-read with ctx.reloadChannel()). */
  channel: ChannelRow;
  workspaceId: string;
  /** Decrypted channel secrets (e.g. IMAP password). */
  secrets: Record<string, string>;
  /** Aborted when the manager stops this connector (lease lost, disconnect, shutdown). */
  signal: AbortSignal;
  /** PII-free structured log line, tagged with channel id + type. */
  log(level: "info" | "warn" | "error", event: string, fields?: Record<string, unknown>): void;
  /** Persist connection state and publish a live `channel.status` event to the console. */
  update(patch: SessionPatch): Promise<void>;
  /** Encrypted auth blob (session string, OAuth tokens, linked-device creds). */
  getAuth<T = unknown>(): Promise<T | null>;
  setAuth(value: unknown | null): Promise<void>;
  /** Non-secret sync cursors (merged on write). */
  getCursor(): Promise<Record<string, unknown>>;
  setCursor(patch: Record<string, unknown>): Promise<void>;
  /** Encrypted key-value store scoped to this channel. */
  kv: KvStore;
  /** Ingest one message (idempotent on externalId). */
  ingest(msg: ParsedInbound, opts?: IngestOptions): Promise<IngestResult>;
  /** Ingest many (history sync), updating progress every 50 messages. */
  ingestMany(msgs: ParsedInbound[], opts?: IngestOptions & { progress?: { total?: number | null; baseDone?: number } }): Promise<{ imported: number; duplicates: number }>;
  reloadChannel(): Promise<ChannelRow | null>;
  /** Report a fatal error: the manager stops this runtime and restarts it with backoff. */
  fail(error: unknown): void;
};

export interface ConnectorRuntime {
  /** Close connections and release resources. Keep stored auth (unless logging out). */
  stop(): Promise<void>;
  /** Handle a console command forwarded by the manager (resync, pair_code, logout). */
  command?(cmd: ConnectionCommand, arg: string | null): Promise<void>;
}

/** Resolve once the connector has started (not necessarily connected — QR pairing may follow). */
export type ConnectorFactory = (ctx: ConnectorContext) => Promise<ConnectorRuntime>;
