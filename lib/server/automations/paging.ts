/**
 * Keyset pagination over (created_at DESC, id DESC) with microsecond precision.
 *
 * Postgres timestamps carry microseconds but JS Dates only milliseconds, so a cursor
 * built from a Date can skip rows created within the same millisecond. These cursors
 * carry the exact database timestamp as text instead.
 */
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const ID_RE = /^[a-z]{1,8}_[0-9a-z]{1,40}$/;

/** Selectable expression: the row's created_at as an exact UTC ISO string (µs). */
export const exactTimestamp = (col: AnyColumn) => sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export function encodeKeyset(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`).toString("base64url");
}

export function decodeKeyset(cursor: string | null): { at: string; id: string } | null {
  if (!cursor || cursor.length > 200) return null;
  try {
    const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!at || !id || !AT_RE.test(at) || !ID_RE.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

/** WHERE fragment: rows strictly after the cursor in (created_at DESC, id DESC) order. */
export const afterKeyset = (createdAt: AnyColumn, id: AnyColumn, c: { at: string; id: string }): SQL => sql`(${createdAt}, ${id}) < (${c.at}::timestamptz, ${c.id})`;

/**
 * Splits a `limit + 1` result into the page and the next cursor.
 * Rows must carry `cursorAt` (from exactTimestamp) and `id`.
 */
export function pageOf<T extends { cursorAt: string; id: string }>(rows: T[], limit: number): { rows: T[]; nextCursor: string | null } {
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return { rows: page, nextCursor: more && last ? encodeKeyset(last.cursorAt, last.id) : null };
}
