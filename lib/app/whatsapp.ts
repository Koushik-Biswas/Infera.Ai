/**
 * Parser for WhatsApp "Export chat" files (Android and iPhone, with or without
 * media). Accepts the .txt on its own or the .zip WhatsApp produces.
 */
import { unzipSync } from "fflate";
import type { MsgKind } from "./types";

export type ParsedMessage = {
  at: number;
  sender: string;
  text: string;
  kind: MsgKind;
  attachmentName?: string;
  system?: boolean;
};

export type ParsedChat = {
  name: string;
  isGroup: boolean;
  senders: string[];
  /** Best guess at which sender is the person importing. */
  guessedMe: string | null;
  messages: ParsedMessage[];
  media: Map<string, Blob>;
};

// Header: "12/11/2025, 10:42 - " (Android) or "[12/11/25, 10:42:03 AM] " (iPhone).
const HEADER =
  /^‎?\[?(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap]\.?\s?m\.?)?\]?\s*(?:[-–]\s*)?(.*)$/i;

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic",
  mp4: "video/mp4", "3gp": "video/3gpp", mov: "video/quicktime",
  opus: "audio/ogg", ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac",
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv", txt: "text/plain", vcf: "text/vcard", zip: "application/zip",
};

export function mimeFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export function kindForName(name: string): MsgKind {
  const mime = mimeFor(name);
  if (/sticker|\.webp$/i.test(name) && mime === "image/webp") return "sticker";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/") || /PTT-|AUD-/i.test(name)) return "audio";
  if (mime === "text/vcard") return "contact";
  return "document";
}

const OMITTED: [RegExp, MsgKind][] = [
  [/^(image|photo|gif) omitted$/i, "image"],
  [/^video omitted$/i, "video"],
  [/^(audio|voice message) omitted$/i, "audio"],
  [/^sticker omitted$/i, "sticker"],
  [/^document omitted$/i, "document"],
  [/^contact card omitted$/i, "contact"],
  [/^<media omitted>$/i, "image"],
];

function clean(s: string) {
  return s
    .replace(/[‎‏‪-‮]/g, "")
    .replace(/[  ]/g, " ")
    .replace(/\s*<this message was edited>\s*$/i, "")
    .trimEnd();
}

function chatNameFromFile(fileName: string) {
  const base = fileName.replace(/\.(txt|zip)$/i, "");
  const m = base.match(/WhatsApp Chat (?:with|-|–)\s*(.+)$/i);
  if (m) return m[1].trim();
  if (/^_?chat$/i.test(base)) return "";
  return base.trim();
}

type RawLine = { d1: number; d2: number; d3: number; h: number; mi: number; s: number; ampm?: string; rest: string };

export function parseExportText(text: string, fileName = "", media = new Map<string, Blob>()): ParsedChat {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const raws: RawLine[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/[  ]/g, " ");
    const m = line.match(HEADER);
    if (m) {
      raws.push({
        d1: +m[1], d2: +m[2], d3: +m[3], h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0,
        ampm: m[7]?.replace(/[.\s]/g, "").toLowerCase(),
        rest: m[8],
      });
    } else if (raws.length) {
      raws[raws.length - 1].rest += "\n" + rawLine;
    }
  }
  if (!raws.length) throw new Error("This doesn't look like a WhatsApp chat export.");

  // Work out the date order (day-first vs month-first) across the whole file.
  const yearFirst = raws.some((r) => r.d1 > 999);
  const monthFirst = !yearFirst && !raws.some((r) => r.d1 > 12) && raws.some((r) => r.d2 > 12);

  const messages: ParsedMessage[] = [];
  const senderCount = new Map<string, number>();
  for (const r of raws) {
    let y: number, mo: number, d: number;
    if (yearFirst) [y, mo, d] = [r.d1, r.d2, r.d3];
    else if (monthFirst) [mo, d, y] = [r.d1, r.d2, r.d3];
    else [d, mo, y] = [r.d1, r.d2, r.d3];
    if (y < 100) y += 2000;
    let h = r.h;
    if (r.ampm === "pm" && h < 12) h += 12;
    if (r.ampm === "am" && h === 12) h = 0;
    const at = new Date(y, mo - 1, d, h, r.mi, r.s).getTime();

    const rest = clean(r.rest);
    const sep = rest.indexOf(": ");
    if (sep <= 0 || sep > 60) {
      messages.push({ at, sender: "", text: rest, kind: "system", system: true });
      continue;
    }
    const sender = rest.slice(0, sep).trim();
    let body = rest.slice(sep + 2);
    let kind: MsgKind = "text";
    let attachmentName: string | undefined;

    const ios = body.match(/^<attached:\s*([^>]+)>\s*\n?([\s\S]*)$/i);
    const android = body.match(/^(.+?\.[a-z0-9]{2,5})\s*\(file attached\)\s*\n?([\s\S]*)$/i);
    if (ios || android) {
      const mm = (ios ?? android)!;
      attachmentName = mm[1].trim();
      body = mm[2].trim();
      kind = kindForName(attachmentName);
    } else {
      const om = OMITTED.find(([re]) => re.test(body.trim()));
      if (om) {
        kind = om[1];
        body = "";
      } else if (/^(this message was deleted|you deleted this message)\.?$/i.test(body.trim())) {
        kind = "deleted";
      }
    }
    senderCount.set(sender, (senderCount.get(sender) ?? 0) + 1);
    messages.push({ at, sender, text: body, kind, attachmentName });
  }

  const senders = [...senderCount.keys()];
  let name = chatNameFromFile(fileName);
  const isGroup = senders.length > 2 || messages.some((m) => m.system && /created group|added|changed the subject|changed this group/i.test(m.text));
  if (!name) {
    const subject = messages.find((m) => m.system && /created group "(.+)"/i.test(m.text))?.text.match(/created group "(.+)"/i)?.[1];
    name = subject ?? senders[0] ?? "Imported chat";
  }
  let guessedMe: string | null = null;
  // Only guess "me" in a 1:1 chat whose name we know (from the export's file name).
  if (!isGroup && senders.length === 2 && senders.includes(name)) guessedMe = senders.find((s) => s !== name) ?? null;

  return { name, isGroup, senders, guessedMe, messages, media };
}

/** Accepts a WhatsApp export as .txt or .zip (with media). */
export async function parseExportFile(file: File): Promise<ParsedChat> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    let txtName = "";
    let txt = "";
    const media = new Map<string, Blob>();
    for (const [path, bytes] of Object.entries(entries)) {
      const base = path.split("/").pop() ?? path;
      if (!base || path.endsWith("/")) continue;
      if (/\.txt$/i.test(base) && (!txt || /chat/i.test(base))) {
        txtName = base;
        txt = new TextDecoder().decode(bytes);
      } else {
        media.set(base, new Blob([bytes as BlobPart], { type: mimeFor(base) }));
      }
    }
    if (!txt) throw new Error("No chat text found in this zip. Export the chat from WhatsApp again.");
    const parsed = parseExportText(txt, txtName === "_chat.txt" ? file.name : txtName, media);
    if (!parsed.name || parsed.name === "_chat") parsed.name = chatNameFromFile(file.name) || parsed.name;
    return parsed;
  }
  return parseExportText(await file.text(), file.name);
}
