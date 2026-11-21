/**
 * Cryptographic helpers (node:crypto only, no dependencies).
 *
 * - Passwords: scrypt (N=2^15, r=8, p=1), salted, constant-time verify.
 * - Tokens (sessions, API keys, invites): random, stored only as SHA-256 hashes.
 * - Secrets at rest (channel tokens, webhook signing secrets): AES-256-GCM with
 *   ENCRYPTION_KEY. ENCRYPTION_KEY_PREVIOUS is tried on decrypt for key rotation.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { isProd } from "./env";

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A real hash of a random password, used to keep login timing constant for unknown emails. */
let dummyHash: Promise<string> | null = null;
export const dummyPasswordHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

/** Random URL-safe token. */
export const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const sha256Hex = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

export const hmacHex = (algo: "sha256" | "sha1", secret: string | Buffer, data: string | Buffer) => createHmac(algo, secret).update(data).digest("hex");
export const hmacBase64 = (algo: "sha256" | "sha1", secret: string | Buffer, data: string | Buffer) => createHmac(algo, secret).update(data).digest("base64");

/** Constant-time string comparison (false on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/* ------------------------------ AES-GCM ----------------------------- */

let warned = false;
function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  const b64 = Buffer.from(trimmed, "base64");
  if (b64.length === 32) return b64;
  // Any other string: derive a key from it.
  return createHash("sha256").update(trimmed).digest();
}

function keys(): Buffer[] {
  const out: Buffer[] = [];
  const current = process.env.ENCRYPTION_KEY;
  if (current) out.push(parseKey(current));
  else {
    if (isProd) throw new Error("ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"");
    if (!warned) {
      warned = true;
      console.warn(JSON.stringify({ level: "warn", event: "encryption_key_missing", message: "Using an insecure development key. Set ENCRYPTION_KEY." }));
    }
    out.push(createHash("sha256").update("infera-insecure-development-key").digest());
  }
  if (process.env.ENCRYPTION_KEY_PREVIOUS) out.push(parseKey(process.env.ENCRYPTION_KEY_PREVIOUS));
  return out;
}

export function encryptionConfigured(): boolean {
  return Boolean(process.env.ENCRYPTION_KEY);
}

export function encrypt(plain: string): string {
  const [key] = keys();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}

export function decrypt(payload: string): string {
  const [v, ivB, tagB, ctB] = payload.split(".");
  if (v !== "v1" || !ivB || !tagB || ctB === undefined) throw new Error("Malformed ciphertext");
  let lastError: unknown;
  for (const key of keys()) {
    try {
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
      d.setAuthTag(Buffer.from(tagB, "base64url"));
      return Buffer.concat([d.update(Buffer.from(ctB, "base64url")), d.final()]).toString("utf8");
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Decryption failed");
}

export const encryptJson = (obj: unknown) => encrypt(JSON.stringify(obj));
export function decryptJson<T = Record<string, string>>(payload: string | null | undefined): T | null {
  if (!payload) return null;
  return JSON.parse(decrypt(payload)) as T;
}
