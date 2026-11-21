/**
 * WhatsApp "Export chat" import (.txt, or the .zip with media).
 *
 * - Parsing reuses `parseExportText` from lib/app/whatsapp.ts (Android + iPhone formats).
 * - Zip handling is server-hardened: only the chat text and the media files the
 *   chat actually references are decompressed, each bounded by its declared size
 *   (zip-bomb safe), media ≤ maxMediaBytes().
 * - Export timestamps carry no zone: they're interpreted in the workspace timezone.
 * - Message external ids are a stable hash of (chat, time, sender, text, attachment,
 *   occurrence #), so re-importing the same (or a longer) export only adds new messages.
 * - Messages are ingested as historical (no unread bumps, no message.received
 *   automations) and processed at bulk priority 200 when `process` is on.
 */
import { unzipSync } from "fflate";
import { eq } from "drizzle-orm";
import type { Actor } from "@/lib/shared/types";
import { parseExportText, mimeFor, type ParsedChat } from "@/lib/app/whatsapp";
import type { Database } from "../db";
import { channels } from "../db/schema";
import { unprocessable } from "../api/handler";
import { writeAudit } from "../audit";
import { maxMediaBytes } from "../env";
import { bumpUsage } from "../usage";
import { ingestInboundMessage } from "./ingest";
import { ensureExportChannel, getWorkspaceChannel } from "./registry";
import type { InboundAttachment } from "./types";
import { sha256 } from "./util";

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_MESSAGES = 50_000;
const MAX_CHAT_TEXT_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_MEDIA_BYTES = 250 * 1024 * 1024;

export type ImportResult = {
  channelId: string;
  conversationId: string | null;
  chatName: string;
  imported: number;
  duplicates: number;
  queued: number;
  skipped: number;
  attachmentsStored: number;
};

/* ------------------------------ Time zones ------------------------------ */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    dtfCache.set(tz, f);
  }
  return f;
}

export function validTimeZone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  try {
    dtf(tz);
    return tz;
  } catch {
    return null;
  }
}

/** Offset (ms) of `tz` from UTC at the instant `utcMs`. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts: Record<string, string> = {};
  for (const p of dtf(tz).formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Wall-clock time in `tz` → UTC instant (handles DST transitions). */
export function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = tzOffsetMs(guess, tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(t, tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

/** parseExportText builds `at` in the server's local zone; reinterpret those wall-clock fields in `tz`. */
const exportTime = (at: number, tz: string) => {
  const l = new Date(at);
  return zonedTimeToUtc(l.getFullYear(), l.getMonth() + 1, l.getDate(), l.getHours(), l.getMinutes(), l.getSeconds(), tz);
};

/* -------------------------------- Parsing -------------------------------- */

function chatNameFromFile(fileName: string) {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.(txt|zip)$/i, "");
  const m = base.match(/WhatsApp Chat (?:with|-|–)\s*(.+)$/i);
  if (m) return m[1].trim();
  if (/^_?chat$/i.test(base)) return "";
  return base.trim();
}

const isZip = (bytes: Buffer, fileName: string) => /\.zip$/i.test(fileName) || (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04);
const baseName = (p: string) => p.split("/").pop() ?? p;

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

/** Parses the export; for zips also returns the referenced media bytes. Throws 422 on unreadable input. */
export function parseExportBytes(bytes: Buffer, fileName: string): { chat: ParsedChat; media: Map<string, Buffer> } {
  const media = new Map<string, Buffer>();
  let chat: ParsedChat;
  try {
    if (isZip(bytes, fileName)) {
      const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      // Pass 1: chat text only (declared size bounds the decompression buffer).
      const texts = unzipSync(u8, { filter: (f) => /\.txt$/i.test(baseName(f.name)) && !f.name.endsWith("/") && f.originalSize <= MAX_CHAT_TEXT_BYTES });
      const names = Object.keys(texts);
      const txtPath = names.find((n) => /chat/i.test(baseName(n))) ?? names[0];
      if (!txtPath) throw unprocessable("No chat text found in this zip. Export the chat from WhatsApp again.");
      const txtName = baseName(txtPath);
      chat = parseExportText(decodeText(texts[txtPath]), txtName === "_chat.txt" ? fileName : txtName);
      if (!chat.name || chat.name === "_chat") chat.name = chatNameFromFile(fileName) || chat.name || "Imported chat";
      // Pass 2: only media the chat references, each ≤ maxMediaBytes, bounded in total.
      const wanted = new Set(chat.messages.flatMap((m) => (m.attachmentName ? [m.attachmentName] : [])));
      if (wanted.size) {
        const cap = maxMediaBytes();
        let total = 0;
        const files = unzipSync(u8, {
          filter: (f) => {
            const b = baseName(f.name);
            if (!wanted.has(b) || f.originalSize > cap || total + f.originalSize > MAX_TOTAL_MEDIA_BYTES) return false;
            total += f.originalSize;
            return true;
          },
        });
        for (const [path, data] of Object.entries(files)) media.set(baseName(path), Buffer.from(data));
      }
    } else {
      chat = parseExportText(decodeText(bytes), fileName);
    }
  } catch (e) {
    if (e instanceof Error && "status" in e) throw e;
    throw unprocessable(e instanceof Error && /WhatsApp/.test(e.message) ? e.message : "This file couldn't be read as a WhatsApp chat export (.txt or .zip).");
  }
  return { chat, media };
}

/* --------------------------------- Import -------------------------------- */

const PHONE_LIKE = /^\+?[\d\s().-]{7,20}$/;

export async function importWhatsAppExport(
  db: Database,
  opts: { workspaceId: string; actor: Actor; fileName: string; bytes: Buffer; me: string | null; process: boolean; timezone: string; channelId?: string | null },
): Promise<ImportResult> {
  const { chat, media } = parseExportBytes(opts.bytes, opts.fileName);
  const content = chat.messages.filter((m) => !m.system);
  if (content.length > MAX_IMPORT_MESSAGES) throw unprocessable(`This chat has ${content.length} messages; imports are limited to ${MAX_IMPORT_MESSAGES}. Export a shorter range.`);

  let channel;
  if (opts.channelId) {
    channel = await getWorkspaceChannel(db, opts.workspaceId, opts.channelId);
    if (!channel || channel.type !== "whatsapp_export") throw unprocessable("channelId must be a WhatsApp import channel in this workspace.");
  } else channel = await ensureExportChannel(db, opts.workspaceId);

  const chatName = chat.name.slice(0, 200) || "Imported chat";
  const convExternalId = `export:${sha256(chatName.toLowerCase()).slice(0, 40)}`;
  const me = opts.me?.trim().toLowerCase() || null;
  const result: ImportResult = { channelId: channel.id, conversationId: null, chatName, imported: 0, duplicates: 0, queued: 0, skipped: 0, attachmentsStored: 0 };
  const seen = new Map<string, number>();

  for (const m of content) {
    const sentAt = exportTime(m.at, opts.timezone);
    const key = [chatName, m.at, m.sender, m.text, m.attachmentName ?? ""].join("\u0001");
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const externalId = `wa_${sha256(`${key}\u0001#${occurrence}`).slice(0, 40)}`;

    const isMe = Boolean(me && m.sender.trim().toLowerCase() === me);
    const attachments: InboundAttachment[] = [];
    if (m.attachmentName) {
      const data = media.get(m.attachmentName) ?? null;
      attachments.push({ name: m.attachmentName, mime: mimeFor(m.attachmentName), size: data?.length ?? null, data });
      if (data) result.attachmentsStored++;
    }
    const text = m.kind === "deleted" ? "This message was deleted" : m.text;
    const skip = !opts.process || m.kind === "deleted" || (!text.trim() && !attachments.length);
    const r = await ingestInboundMessage(db, {
      workspaceId: opts.workspaceId,
      channelId: channel.id,
      externalId,
      direction: isMe ? "outbound" : "inbound",
      conversation: { externalId: convExternalId, title: chatName, isGroup: chat.isGroup },
      sender: { externalId: m.sender, name: m.sender, phone: PHONE_LIKE.test(m.sender) ? m.sender : null, isMe },
      kind: m.kind,
      text,
      attachments,
      sentAt,
      priority: 200,
      skipProcessing: skip,
      historical: true,
      actor: opts.actor,
      raw: { provider: "whatsapp_export" },
    });
    result.conversationId ??= r.conversationId;
    if (r.duplicate) result.duplicates++;
    else {
      result.imported++;
      if (!skip) result.queued++;
      else result.skipped++;
    }
  }

  await bumpUsage(opts.workspaceId, { messages_ingested: result.imported }, db).catch(() => {});
  if (result.imported) {
    await db.update(channels).set({ lastEventAt: new Date() }).where(eq(channels.id, channel.id));
  }
  await writeAudit(db, {
    workspaceId: opts.workspaceId,
    actor: opts.actor,
    action: "import.whatsapp",
    targetType: "conversation",
    targetId: result.conversationId,
    after: { imported: result.imported, duplicates: result.duplicates, queued: result.queued, skipped: result.skipped, attachmentsStored: result.attachmentsStored },
    meta: { channelId: channel.id, isGroup: chat.isGroup, process: opts.process, timezone: opts.timezone },
  });
  return result;
}
