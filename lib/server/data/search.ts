/**
 * Workspace search across messages, records and contacts.
 *
 * Messages are sealed at rest, so they are found through the blind index
 * (`search_tokens @> hashed query words`, each word matching as a prefix) and
 * decrypted only for the returned page. Records (structured, readable) use
 * Postgres full-text search with an ILIKE fallback; contacts use ILIKE.
 */
import { and, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { SearchHitDTO } from "@/lib/shared/types";
import type { Database } from "../db";
import { collections, contacts, conversations, messages, records } from "../db/schema";
import { openText, queryTokens, wordsOf } from "./sealed";

export type SearchOpts = { type?: "all" | "messages" | "records" | "contacts"; from?: Date | null; to?: Date | null; channelId?: string | null; conversationId?: string | null; limit?: number };

const likeEscape = (s: string) => s.replace(/[%_\\]/g, "\\$&");

/** A short excerpt around the first query word (case-insensitive), or the start of the text. */
export function snippetOf(text: string, q: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const lower = flat.toLowerCase();
  let at = -1;
  for (const w of wordsOf(q)) {
    at = lower.indexOf(w);
    if (at >= 0) break;
  }
  const start = Math.max(0, (at < 0 ? 0 : at) - 50);
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + max).trim()}${start + max < flat.length ? "…" : ""}`;
}

export const tokenFilter = (tokens: string[]): SQL => sql`${messages.searchTokens} @> ARRAY[${sql.join(tokens.map((t) => sql`${t}`), sql`, `)}]::text[]`;

export type MessageHit = { id: string; conversationId: string; channelId: string; senderName: string; direction: "inbound" | "outbound"; text: string; sentAt: Date; title: string };

/** Messages containing every query word (as a prefix), newest first, decrypted. */
export async function searchMessageRows(db: Database, workspaceId: string, q: string, opts: SearchOpts = {}): Promise<MessageHit[]> {
  const tokens = queryTokens(q);
  if (!tokens.length) return [];
  const where = [eq(messages.workspaceId, workspaceId), tokenFilter(tokens)];
  if (opts.from) where.push(gte(messages.sentAt, opts.from));
  if (opts.to) where.push(lte(messages.sentAt, opts.to));
  if (opts.channelId) where.push(eq(messages.channelId, opts.channelId));
  if (opts.conversationId) where.push(eq(messages.conversationId, opts.conversationId));
  const rows = await db
    .select({ id: messages.id, conversationId: messages.conversationId, channelId: messages.channelId, senderName: messages.senderName, direction: messages.direction, text: messages.text, sentAt: messages.sentAt, title: conversations.title })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(...where))
    .orderBy(desc(messages.sentAt), desc(messages.id))
    .limit(Math.min(opts.limit ?? 30, 200));
  return rows.map((r) => ({ ...r, text: openText(r.text) }));
}

export async function search(db: Database, workspaceId: string, q: string, opts: SearchOpts = {}): Promise<SearchHitDTO[]> {
  const query = q.trim().slice(0, 200);
  if (!query) return [];
  const type = opts.type ?? "all";
  const limit = Math.min(opts.limit ?? 30, 100);
  const hits: SearchHitDTO[] = [];

  if (type === "all" || type === "messages") {
    const rows = await searchMessageRows(db, workspaceId, query, { ...opts, limit });
    rows.forEach((r, i) =>
      hits.push({ type: "message", id: r.id, conversationId: r.conversationId, title: `${r.direction === "outbound" ? "You" : r.senderName || "Unknown"} · ${r.title}`, snippet: snippetOf(r.text, query), at: r.sentAt.toISOString(), score: 1 - i / (rows.length + 1) }),
    );
  }

  if ((type === "all" || type === "records") && !opts.conversationId) {
    const doc = sql`to_tsvector('simple', ${records.values}::text)`;
    const tsq = sql`websearch_to_tsquery('simple', ${query})`;
    const where = [eq(records.workspaceId, workspaceId), isNull(records.deletedAt), isNull(collections.archivedAt), or(sql`${doc} @@ ${tsq}`, ilike(sql`${records.values}::text`, `%${likeEscape(query)}%`))!];
    if (opts.from) where.push(gte(records.updatedAt, opts.from));
    if (opts.to) where.push(lte(records.updatedAt, opts.to));
    const rows = await db
      .select({ id: records.id, collectionId: records.collectionId, values: records.values, updatedAt: records.updatedAt, collection: collections.name, fields: collections.fields, rank: sql<number>`ts_rank(${doc}, ${tsq})` })
      .from(records)
      .innerJoin(collections, eq(collections.id, records.collectionId))
      .where(and(...where))
      .orderBy(desc(sql`ts_rank(${doc}, ${tsq})`), desc(records.updatedAt))
      .limit(limit);
    for (const r of rows) {
      const firstText = r.fields.find((f) => typeof r.values[f.key] === "string" && r.values[f.key] !== "");
      const title = firstText ? String(r.values[firstText.key]) : r.collection;
      const parts = r.fields.filter((f) => r.values[f.key] !== null && r.values[f.key] !== undefined && r.values[f.key] !== "").map((f) => `${f.label}: ${r.values[f.key]}`);
      hits.push({ type: "record", id: r.id, collectionId: r.collectionId, title: `${title} · ${r.collection}`, snippet: snippetOf(parts.join(" · "), query), at: r.updatedAt.toISOString(), score: 0.5 + Math.min(0.5, Number(r.rank) || 0) });
    }
  }

  if ((type === "all" || type === "contacts") && !opts.conversationId) {
    const like = `%${likeEscape(query)}%`;
    const digits = query.replace(/\D/g, "");
    const rows = await db
      .select({ id: contacts.id, displayName: contacts.displayName, phone: contacts.phone, email: contacts.email, updatedAt: contacts.updatedAt })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), or(ilike(contacts.displayName, like), ilike(contacts.email, like), digits.length >= 4 ? ilike(contacts.phone, `%${digits}%`) : sql`false`)))
      .orderBy(desc(contacts.updatedAt))
      .limit(Math.min(limit, 20));
    for (const c of rows) hits.push({ type: "contact", id: c.id, title: c.displayName || c.phone || c.email || "Contact", snippet: [c.phone, c.email].filter(Boolean).join(" · "), at: c.updatedAt.toISOString(), score: 0.6 });
  }

  return hits;
}
