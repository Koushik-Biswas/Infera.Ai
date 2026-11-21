/**
 * Lazy, best-effort media download for WhatsApp / Telegram / Twilio MMS attachments.
 *
 * Webhooks only carry provider media ids (Twilio: auth-protected media URLs). Right after the webhook is
 * acknowledged (Next.js `after()`), the bytes are fetched with the channel's
 * token, capped at maxMediaBytes(), stored in `files`, and the message's
 * `attachments[i].fileId` is filled in. Failures are logged without PII and
 * never affect ingestion or processing.
 */
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db";
import { getDb } from "../db";
import { files, messages, type ChannelRow } from "../db/schema";
import { maxMediaBytes, isTest } from "../env";
import { log } from "../http";
import { newId } from "../ids";
import { fetchTelegramFile, fetchTwilioMedia, fetchWhatsAppMedia } from "./providers";
import { decryptSecrets } from "./registry";
import type { IngestResult, ParsedInbound } from "./types";
import { cleanMime, sha256 } from "./util";
import { sealBytes } from "../data/sealed";
import { fetchMetaCdn } from "./meta-graph";

export type PendingMedia = { workspaceId: string; messageId: string; items: { index: number; providerId: string }[] };

/** Media to fetch for a freshly ingested message (nothing for duplicates or attachments with bytes). */
export function pendingMediaFor(workspaceId: string, result: IngestResult, parsed: ParsedInbound): PendingMedia | null {
  if (result.duplicate) return null;
  const items = (parsed.attachments ?? []).flatMap((a, index) => (a.providerId && !a.data ? [{ index, providerId: a.providerId }] : []));
  return items.length ? { workspaceId, messageId: result.messageId, items } : null;
}

export const supportsMediaDownload = (type: ChannelRow["type"]) => type === "whatsapp_cloud" || type === "telegram" || type === "sms_twilio" || type === "messenger" || type === "instagram";

/** Downloads and stores the attachments of one message. Returns counts; never throws. */
export async function fetchProviderMedia(db: Database, channel: ChannelRow, pending: PendingMedia): Promise<{ stored: number; failed: number }> {
  let stored = 0;
  let failed = 0;
  if (!supportsMediaDownload(channel.type) || channel.workspaceId !== pending.workspaceId) return { stored, failed };
  const secrets = decryptSecrets(channel);
  const meta = channel.type === "messenger" || channel.type === "instagram";
  // Meta attachments are signed CDN URLs (no token needed; only Meta hosts are fetched).
  const token = meta ? "cdn" : channel.type === "whatsapp_cloud" ? secrets.accessToken : channel.type === "telegram" ? secrets.botToken : secrets.authToken;
  if (!token || (channel.type === "sms_twilio" && !secrets.accountSid)) return { stored, failed: pending.items.length };
  const cap = maxMediaBytes();
  const msg = await db
    .select({ attachments: messages.attachments })
    .from(messages)
    .where(and(eq(messages.id, pending.messageId), eq(messages.workspaceId, pending.workspaceId)))
    .limit(1);
  if (!msg[0]) return { stored, failed };

  for (const item of pending.items) {
    // Already downloaded (retry of the after-phase): don't fetch again.
    if (msg[0].attachments[item.index]?.fileId) continue;
    try {
      const got = meta
        ? await fetchMetaCdn(item.providerId, cap)
        : channel.type === "whatsapp_cloud"
          ? await fetchWhatsAppMedia(item.providerId, token, cap)
          : channel.type === "telegram"
            ? await fetchTelegramFile(item.providerId, token, cap)
            : await fetchTwilioMedia(item.providerId, secrets.accountSid, token, cap);
      if (!got) {
        failed++;
        continue;
      }
      await db.transaction(async (tx) => {
        const rows = await tx
          .select({ attachments: messages.attachments })
          .from(messages)
          .where(and(eq(messages.id, pending.messageId), eq(messages.workspaceId, pending.workspaceId)))
          .for("update")
          .limit(1);
        const current = rows[0]?.attachments;
        const att = current?.[item.index];
        if (!current || !att || att.fileId) return; // message deleted meanwhile, or already stored
        const fileId = newId("fil");
        const mime = got.mime ? cleanMime(got.mime, att.mime) : att.mime;
        await tx.insert(files).values({ id: fileId, workspaceId: pending.workspaceId, messageId: pending.messageId, name: att.name, mime, size: got.data.length, sha256: sha256(got.data), data: sealBytes(got.data) });
        const next = current.map((a, i) => (i === item.index ? { ...a, fileId, mime, size: got.data.length } : a));
        await tx.update(messages).set({ attachments: next }).where(eq(messages.id, pending.messageId));
      });
      stored++;
    } catch (e) {
      failed++;
      log("warn", "media_store_failed", { channelId: channel.id, messageId: pending.messageId, message: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
  }
  if (failed) log("info", "media_fetch_incomplete", { channelId: channel.id, messageId: pending.messageId, stored, failed });
  return { stored, failed };
}

/** Schedules downloads to run after the HTTP response (no-op in tests; tests call fetchProviderMedia directly). */
export function scheduleMediaFetch(channel: ChannelRow, pending: PendingMedia[]): void {
  if (!pending.length || !supportsMediaDownload(channel.type) || isTest) return;
  const run = async () => {
    try {
      const db = await getDb();
      for (const p of pending) await fetchProviderMedia(db, channel, p);
    } catch (e) {
      log("warn", "media_fetch_failed", { channelId: channel.id, message: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
