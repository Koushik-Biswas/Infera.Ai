/**
 * LinkedIn (Unipile) channel lifecycle: finish the hosted login (find the account,
 * register the message webhook) and import recent conversations.
 * Progress is shown on the channel through connector_sessions (state "syncing").
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { channels, type ChannelRow } from "../db/schema";
import { log } from "../http";
import { kickSoon } from "../jobs/kick";
import { updateConnectorSession } from "../sync/session";
import { ingestInboundMessage } from "./ingest";
import { decryptSecrets, webhookUrlFor } from "./registry";
import { unipileCreateWebhook, unipileFindAccount, unipileHistory, type UnipileCreds } from "./unipile";

export function unipileCreds(channel: ChannelRow): UnipileCreds | null {
  const s = decryptSecrets(channel);
  const dsn = typeof channel.config?.dsn === "string" ? channel.config.dsn : null;
  return dsn && s.apiKey ? { dsn, apiKey: s.apiKey } : null;
}

/** After the hosted LinkedIn login: link the Unipile account to this channel and start syncing. */
export async function completeLinkedIn(db: Database, channel: ChannelRow): Promise<{ ok: boolean; error: string | null }> {
  const creds = unipileCreds(channel);
  if (!creds) return { ok: false, error: "The channel is missing its Unipile DSN or API key." };
  const account = await unipileFindAccount(creds, channel.id);
  if (!account) {
    await updateConnectorSession(db, channel, { state: "disconnected", lastError: "LinkedIn login wasn't completed. Click Connect LinkedIn to try again." });
    return { ok: false, error: "No LinkedIn account was linked." };
  }
  const secrets = decryptSecrets(channel);
  const url = webhookUrlFor(channel, secrets);
  let webhookError: string | null = null;
  let webhookId: string | null = typeof channel.config?.webhookId === "string" ? channel.config.webhookId : null;
  if (!webhookId || channel.config?.accountId !== account.id) {
    if (url && url.startsWith("https://") && secrets.webhookSecret) {
      const w = await unipileCreateWebhook(creds, { requestUrl: url, secret: secrets.webhookSecret, accountId: account.id, name: `infera-${channel.id}` });
      if ("error" in w) webhookError = w.error;
      else webhookId = w.id;
    } else webhookError = "Live updates need Infera on a public HTTPS address (APP_URL); recent conversations were imported.";
  }
  const [updated] = await db
    .update(channels)
    .set({ config: { ...channel.config, accountId: account.id, accountUserId: account.userId, ...(webhookId ? { webhookId } : {}) }, lastError: webhookError, updatedAt: new Date() })
    .where(eq(channels.id, channel.id))
    .returning();
  await updateConnectorSession(db, channel, { state: "connected", account: { id: account.id, name: account.displayName ?? undefined }, lastConnectedAt: new Date(), lastError: webhookError });
  await importLinkedInHistory(db, updated);
  return { ok: true, error: webhookError };
}

export async function importLinkedInHistory(db: Database, channel: ChannelRow, opts: { days?: number } = {}): Promise<{ imported: number; error: string | null }> {
  const creds = unipileCreds(channel);
  const accountId = typeof channel.config?.accountId === "string" ? channel.config.accountId : null;
  if (!creds || !accountId) return { imported: 0, error: "Connect a LinkedIn account first." };
  const days = Math.min(365, Math.max(1, opts.days ?? (typeof channel.config?.historyDays === "number" ? channel.config.historyDays : 30)));
  const startedAt = new Date().toISOString();
  await updateConnectorSession(db, channel, { state: "syncing", progress: { phase: "history", total: null, done: 0, startedAt, finishedAt: null, message: "Importing recent LinkedIn conversations…" } });
  const h = await unipileHistory(creds, { accountId, since: new Date(Date.now() - days * 86_400_000) });
  let imported = 0;
  for (const m of h.messages) {
    try {
      const r = await ingestInboundMessage(db, { ...m, workspaceId: channel.workspaceId, channelId: channel.id, historical: true, priority: 200 });
      if (!r.duplicate) imported++;
    } catch (e) {
      log("warn", "linkedin_history_ingest_failed", { channelId: channel.id, message: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    }
  }
  if (imported) kickSoon();
  const finishedAt = new Date().toISOString();
  await updateConnectorSession(db, channel, { state: "connected", lastSyncAt: new Date(), lastError: h.error ?? channel.lastError, progress: { phase: "done", total: imported, done: imported, startedAt, finishedAt, message: `Imported ${imported} messages from ${h.chats} recent LinkedIn conversations.` } });
  return { imported, error: h.error };
}
