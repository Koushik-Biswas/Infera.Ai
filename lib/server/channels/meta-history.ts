/**
 * Recent-history import for Messenger / Instagram channels: pulls the Page's
 * recent conversations from the Graph API and ingests them as historical
 * messages (processed into collections at low priority, no automations).
 * Progress is shown on the channel through connector_sessions (state "syncing").
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { channels, type ChannelRow } from "../db/schema";
import { log } from "../http";
import { kickSoon } from "../jobs/kick";
import { updateConnectorSession } from "../sync/session";
import { ingestInboundMessage } from "./ingest";
import { fetchMetaHistory, instagramAccountOf } from "./meta-graph";
import { decryptSecrets } from "./registry";

export async function importMetaHistory(db: Database, channel: ChannelRow, opts: { days?: number } = {}): Promise<{ imported: number; duplicates: number; error: string | null }> {
  if (channel.type !== "messenger" && channel.type !== "instagram") return { imported: 0, duplicates: 0, error: "Not a Meta channel." };
  const secrets = decryptSecrets(channel);
  const cfg = channel.config ?? {};
  const pageId = typeof cfg.pageId === "string" ? cfg.pageId : null;
  if (!secrets.pageAccessToken || !pageId) return { imported: 0, duplicates: 0, error: "The channel is missing its Page ID or access token." };
  const days = Math.min(365, Math.max(1, opts.days ?? (typeof cfg.historyDays === "number" ? cfg.historyDays : 30)));
  const startedAt = new Date().toISOString();

  let accountId = pageId;
  if (channel.type === "instagram") {
    const ig = typeof cfg.instagramAccountId === "string" ? cfg.instagramAccountId : await instagramAccountOf(pageId, secrets.pageAccessToken);
    if (!ig) {
      await updateConnectorSession(db, channel, { state: "connected", lastError: "No Instagram professional account is linked to this Page.", progress: null });
      return { imported: 0, duplicates: 0, error: "No Instagram professional account is linked to this Page." };
    }
    accountId = ig;
    if (cfg.instagramAccountId !== ig) await db.update(channels).set({ config: { ...cfg, instagramAccountId: ig }, updatedAt: new Date() }).where(eq(channels.id, channel.id));
  }

  await updateConnectorSession(db, channel, { state: "syncing", lastError: null, progress: { phase: "history", total: null, done: 0, startedAt, finishedAt: null, message: "Importing recent conversations…" } });
  const h = await fetchMetaHistory({ pageId, accountId, pageAccessToken: secrets.pageAccessToken, platform: channel.type, since: new Date(Date.now() - days * 86_400_000) });

  let imported = 0;
  let duplicates = 0;
  for (const [i, m] of h.messages.entries()) {
    try {
      const r = await ingestInboundMessage(db, { ...m, workspaceId: channel.workspaceId, channelId: channel.id, historical: true, priority: 200 });
      if (r.duplicate) duplicates++;
      else imported++;
    } catch (e) {
      log("warn", "meta_history_ingest_failed", { channelId: channel.id, message: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    }
    if ((i + 1) % 50 === 0) {
      await updateConnectorSession(db, channel, { progress: { phase: "history", total: h.messages.length, done: i + 1, startedAt, finishedAt: null, message: "Importing recent conversations…" } }).catch(() => {});
    }
  }
  if (imported) kickSoon();
  const finishedAt = new Date().toISOString();
  await updateConnectorSession(db, channel, {
    state: "connected",
    lastSyncAt: new Date(),
    lastError: h.error,
    progress: { phase: "done", total: imported, done: imported, startedAt, finishedAt, message: `Imported ${imported} messages from ${h.conversations} recent conversations.` },
  });
  log("info", "meta_history_imported", { channelId: channel.id, imported, duplicates, conversations: h.conversations, error: Boolean(h.error) });
  return { imported, duplicates, error: h.error };
}
