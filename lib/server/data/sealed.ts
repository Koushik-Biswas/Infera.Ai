/**
 * Encryption at rest for conversation content.
 *
 * What is sealed (AES-256-GCM, ENCRYPTION_KEY — held by the app server, never stored in the database):
 *   - messages.text, conversations.last_message_preview
 *   - files.data (photos, documents, voice notes)
 * Structured results — records.values, processing results and the short evidence quotes attached to
 * extracted fields — stay readable so tables can be filtered, sorted and audited.
 *
 * Search over sealed text uses a blind index: `messages.search_tokens` holds keyed hashes
 * (HMAC-SHA256, key derived from ENCRYPTION_KEY) of every word and word prefix (≥ 3 chars),
 * so "bask" finds "basketball" without the database ever seeing the words.
 *
 * Sealed strings look like `enc:v1.<iv>.<tag>.<ct>`. Anything without the prefix is legacy
 * plaintext and is returned as-is (`sealLegacyContent()` converts old rows in the background).
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, isNull, not, sql } from "drizzle-orm";
import { decrypt, encrypt } from "../crypto";
import { isProd } from "../env";
import type { Database } from "../db";
import { conversations, files, messages } from "../db/schema";

const PREFIX = "enc:";
const UNREADABLE = "[encrypted — key unavailable]";

export const isSealed = (v: string | null | undefined): boolean => typeof v === "string" && v.startsWith(PREFIX);

export function sealText(plain: string): string {
  if (!plain) return "";
  return PREFIX + encrypt(plain);
}

/** Decrypts a sealed string (legacy plaintext passes through). Never throws. */
export function openText(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored;
  try {
    return decrypt(stored.slice(PREFIX.length));
  } catch {
    return UNREADABLE;
  }
}

/* ------------------------------ Bytes ------------------------------ */

const BYTES_MAGIC = Buffer.from("INFENC1\0");

/** Derived from ENCRYPTION_KEY (current first, then ENCRYPTION_KEY_PREVIOUS for rotation). */
function fileKeys(): Buffer[] {
  const out = [createHash("sha256").update(`files:${keyMaterial()}`).digest()];
  const prev = process.env.ENCRYPTION_KEY_PREVIOUS?.trim();
  if (prev) out.push(createHash("sha256").update(`files:${prev}`).digest());
  return out;
}

/** Encrypted bytes = magic(8) | iv(12) | tag(16) | ciphertext. */
export function sealBytes(data: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", fileKeys()[0], iv);
  const ct = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([BYTES_MAGIC, iv, c.getAuthTag(), ct]);
}

export function openBytes(stored: Buffer): Buffer {
  if (stored.length < 36 || !stored.subarray(0, 8).equals(BYTES_MAGIC)) return stored; // legacy plaintext
  const iv = stored.subarray(8, 20);
  const tag = stored.subarray(20, 36);
  let last: unknown;
  for (const key of fileKeys()) {
    try {
      const d = createDecipheriv("aes-256-gcm", key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(stored.subarray(36)), d.final()]);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("File decryption failed");
}

/* --------------------------- Blind index --------------------------- */

function keyMaterial(): string {
  const k = process.env.ENCRYPTION_KEY;
  if (k) return k.trim();
  if (isProd) throw new Error("ENCRYPTION_KEY is not set.");
  // Same development fallback as lib/server/crypto.ts (which refuses to run without a key in production).
  return "infera-insecure-development-key";
}

let tokenKey: { material: string; key: Buffer } | null = null;
function indexKey(): Buffer {
  const material = keyMaterial();
  if (tokenKey?.material !== material) tokenKey = { material, key: createHash("sha256").update(`search-index:v1:${material}`).digest() };
  return tokenKey.key;
}

const MAX_WORD = 24;
const MAX_TOKENS = 600;

/** Lowercased words (letters/digits, any script); digits inside numbers like 1,200 or 98765-43210 are joined. */
export function wordsOf(text: string): string[] {
  const norm = text.normalize("NFKC").toLowerCase().replace(/(\d)[,.\-\s](?=\d)/g, "$1");
  return norm.match(/[\p{L}\p{N}]+/gu) ?? [];
}

const hashToken = (t: string) => createHmac("sha256", indexKey()).update(t).digest("base64url").slice(0, 16);

/** Hashed tokens for a message: each word (≥ 2 chars) plus its prefixes from 3 chars. */
export function searchTokens(text: string): string[] {
  const out = new Set<string>();
  for (const w of wordsOf(text)) {
    if (out.size >= MAX_TOKENS) break;
    const word = w.slice(0, MAX_WORD);
    if (word.length < 2) continue;
    if (word.length === 2) {
      out.add(hashToken(word));
      continue;
    }
    for (let i = 3; i <= word.length; i++) out.add(hashToken(word.slice(0, i)));
  }
  return [...out];
}

/** Tokens a search query must ALL match (each query word, as typed, is a prefix). Empty when nothing searchable. */
export function queryTokens(q: string): string[] {
  const out = new Set<string>();
  for (const w of wordsOf(q)) {
    const word = w.slice(0, MAX_WORD);
    if (word.length >= 2) out.add(hashToken(word));
  }
  return [...out].slice(0, 12);
}

/* ------------------------- Legacy migration ------------------------ */

/**
 * Seals rows written before encryption at rest existed (plaintext text/previews/files) and
 * fills the search index. Runs in small batches; safe to run repeatedly and on several instances.
 */
export async function sealLegacyContent(db: Database, opts: { batch?: number; maxBatches?: number } = {}): Promise<{ messages: number; conversations: number; files: number }> {
  const batch = opts.batch ?? 200;
  const maxBatches = opts.maxBatches ?? 1000;
  const done = { messages: 0, conversations: 0, files: 0 };

  for (let i = 0; i < maxBatches; i++) {
    const rows = await db
      .select({ id: messages.id, text: messages.text })
      .from(messages)
      .where(isNull(messages.searchTokens))
      .limit(batch);
    if (!rows.length) break;
    for (const r of rows) {
      const plain = openText(r.text);
      await db
        .update(messages)
        .set({ text: isSealed(r.text) ? r.text : sealText(plain), searchTokens: searchTokens(plain) })
        .where(eq(messages.id, r.id));
    }
    done.messages += rows.length;
  }

  for (let i = 0; i < maxBatches; i++) {
    const rows = await db
      .select({ id: conversations.id, p: conversations.lastMessagePreview })
      .from(conversations)
      .where(and(not(sql`${conversations.lastMessagePreview} like 'enc:%'`), sql`${conversations.lastMessagePreview} <> ''`))
      .limit(batch);
    if (!rows.length) break;
    for (const r of rows) await db.update(conversations).set({ lastMessagePreview: sealText(r.p) }).where(eq(conversations.id, r.id));
    done.conversations += rows.length;
  }

  for (let i = 0; i < maxBatches; i++) {
    // Only ids first: file bytes can be large.
    const ids = await db
      .select({ id: files.id })
      .from(files)
      .where(sql`substring(${files.data} from 1 for 8) <> ${BYTES_MAGIC}`)
      .limit(Math.min(batch, 20));
    if (!ids.length) break;
    for (const { id } of ids) {
      const [f] = await db.select({ data: files.data }).from(files).where(eq(files.id, id)).limit(1);
      if (f) await db.update(files).set({ data: sealBytes(Buffer.from(f.data)) }).where(eq(files.id, id));
    }
    done.files += ids.length;
  }
  return done;
}
