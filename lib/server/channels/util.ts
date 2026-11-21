/**
 * Small helpers shared by the channel adapters, ingestion, webhook routes and
 * provider calls. No database access here.
 */
import { createHash } from "node:crypto";
import type { MessageKind } from "@/lib/shared/types";

/** Postgres `text` can't hold NUL; jsonb also rejects lone surrogates. Cap length, keep valid UTF-16. */
export function cleanStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\u0000/g, "").trim().slice(0, max).toWellFormed();
}

/** Same as cleanStr but keeps inner newlines normalised (message bodies). */
export function cleanBody(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max)
    .toWellFormed();
}

export const sha256 = (s: string | Buffer | Uint8Array) => createHash("sha256").update(s).digest("hex");

/** Provider ids are stored verbatim when short; very long ones are hashed (stable) to keep the unique index small. */
export function normalizeExternalId(v: unknown): string {
  const s = typeof v === "number" ? String(v) : cleanStr(v, 100_000);
  if (!s) throw new Error("externalId is required");
  return s.length > 255 ? `h:${sha256(s)}` : s;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Makes a value safe for a jsonb column (no NUL, no lone surrogates) and caps
 * its serialised size. Oversized payloads are replaced by a marker.
 */
export function sanitizeJson(value: unknown, maxBytes = 32 * 1024): unknown {
  if (value === undefined) return null;
  let text: string;
  try {
    text = JSON.stringify(value, (_k, v) => (typeof v === "string" ? v.replace(/\u0000/g, "").toWellFormed() : typeof v === "bigint" ? String(v) : v));
  } catch {
    return { unserializable: true };
  }
  if (text === undefined) return null;
  if (Buffer.byteLength(text) > maxBytes) return { truncated: true, bytes: Buffer.byteLength(text) };
  return JSON.parse(text);
}

/** Wraps a provider payload with Infera's own notes under `_infera`. */
export function withNotes(raw: unknown, notes: Record<string, unknown>): unknown {
  const hasNotes = Object.keys(notes).length > 0;
  if (!hasNotes) return raw ?? null;
  if (raw === undefined || raw === null) return { _infera: notes };
  return isPlainObject(raw) ? { ...raw, _infera: notes } : { payload: raw, _infera: notes };
}

export function kindForMime(mime: string): MessageKind {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "text/vcard" || m === "text/x-vcard") return "contact";
  return "document";
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

/** "image/jpeg; codecs=x" → "jpg" (fallback "bin"). */
export function extForMime(mime: string): string {
  return EXT[mime.split(";")[0].trim().toLowerCase()] ?? "bin";
}

/** Strips parameters and validates the shape of a MIME type. */
export function cleanMime(v: unknown, fallback = "application/octet-stream"): string {
  const s = cleanStr(v, 200).split(";")[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(s) ? s : fallback;
}

/** Seconds (number or numeric string) or ISO string → Date; invalid → null. */
export function parseTimestamp(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Accept both seconds and milliseconds.
    const d = new Date(n > 1e12 ? n : n * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/* ------------------------------ HTTP bodies ------------------------------ */

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
  }
}

/** Reads a request body as bytes, aborting as soon as it exceeds `max` (Content-Length may lie or be absent). */
export async function readCappedBytes(req: Request, max: number): Promise<Buffer> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) throw new BodyTooLargeError();
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Reads a fetch Response body with a byte cap. Returns null when the cap is exceeded. */
export async function readResponseCapped(res: Response, max: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Parses JSON without throwing. */
export function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/* --------------------------- Untyped payload access --------------------------- */

/** Safe accessors for untrusted provider JSON. */
export const obj = (v: unknown): Record<string, unknown> => (isPlainObject(v) ? v : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
export const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
