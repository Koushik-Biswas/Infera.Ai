/**
 * Conversation context (rule 17) and record targeting lookups. Every query is
 * scoped to the message's workspace (rule 6).
 */
import { openText } from "../data/sealed";
import { and, desc, eq, gt, inArray, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { CellValue, TemplateId } from "@/lib/shared/types";
import type { Database } from "../db";
import { messages, records, recordSources, type CollectionRow, type RecordRow } from "../db/schema";
import { statusFieldOf } from "../records/coerce";
import type { ContextMessage, PipelineMessage } from "./types";

export const CONTEXT_MESSAGES = 15;
const OPEN_RECORD_WINDOW_MS = 30 * 86_400_000;

/** The last `limit` messages before `msg` in its conversation, oldest first. */
export async function loadContextMessages(db: Database, msg: PipelineMessage, limit = CONTEXT_MESSAGES): Promise<ContextMessage[]> {
  if (!msg.conversationId) return [];
  const before = msg.id
    ? or(lt(messages.sentAt, msg.sentAt), and(eq(messages.sentAt, msg.sentAt), lt(messages.id, msg.id)))
    : lt(messages.sentAt, msg.sentAt);
  const rows = await db
    .select({
      id: messages.id,
      externalId: messages.externalId,
      conversationId: messages.conversationId,
      channelId: messages.channelId,
      text: messages.text,
      senderName: messages.senderName,
      direction: messages.direction,
      kind: messages.kind,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(and(eq(messages.workspaceId, msg.workspaceId), eq(messages.conversationId, msg.conversationId), before, notInArray(messages.kind, ["system", "deleted"])))
    .orderBy(desc(messages.sentAt), desc(messages.id))
    .limit(limit);
  return rows.reverse().map((r) => ({ ...r, text: openText(r.text) }));
}

const TERMINAL_BY_TEMPLATE: Partial<Record<TemplateId, string[]>> = {
  orders: ["Delivered", "Cancelled"],
  leads: ["Won", "Lost"],
  payments: ["Paid", "Refunded"],
  support: ["Resolved"],
  tasks: ["Done"],
};
const TERMINAL_RE = /^(delivered|cancell?ed|won|lost|paid|refunded|resolved|done|closed|completed?|rejected)$/i;

/** Status values that close a record (it is no longer the "open" record of a contact). */
export function terminalStatuses(collection: Pick<CollectionRow, "template" | "fields">): string[] {
  const sf = statusFieldOf(collection.fields);
  const options = sf?.options ?? [];
  const fixed = TERMINAL_BY_TEMPLATE[collection.template];
  const set = new Set<string>(options.filter((o) => (fixed ? fixed.some((f) => f.toLowerCase() === o.toLowerCase()) : TERMINAL_RE.test(o))));
  if (fixed && !options.length) fixed.forEach((f) => set.add(f));
  return [...set];
}

/** Open (non-terminal, recently active, live) record of this contact — or conversation when there is no contact. */
export async function findOpenRecord(db: Database, input: { workspaceId: string; collection: CollectionRow; contactId: string | null; conversationId: string | null; now: Date }): Promise<RecordRow | null> {
  const owner: SQL | undefined = input.contactId ? eq(records.contactId, input.contactId) : input.conversationId ? eq(records.conversationId, input.conversationId) : undefined;
  if (!owner) return null;
  const terminal = terminalStatuses(input.collection);
  const rows = await db
    .select()
    .from(records)
    .where(
      and(
        eq(records.workspaceId, input.workspaceId),
        eq(records.collectionId, input.collection.id),
        isNull(records.deletedAt),
        owner,
        gt(records.updatedAt, new Date(input.now.getTime() - OPEN_RECORD_WINDOW_MS)),
        terminal.length ? or(isNull(records.status), sql`lower(${records.status}) not in (${sql.join(terminal.map((t) => sql`${t.toLowerCase()}`), sql`, `)})`) : undefined,
      ),
    )
    .orderBy(desc(records.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Up to `perCollection` open records per collection for the AI prompt (current values only). */
export async function loadOpenRecords(
  db: Database,
  input: { workspaceId: string; collections: CollectionRow[]; contactId: string | null; conversationId: string | null; now: Date },
): Promise<{ collectionId: string; values: Record<string, CellValue> }[]> {
  const out: { collectionId: string; values: Record<string, CellValue> }[] = [];
  for (const collection of input.collections.slice(0, 8)) {
    const r = await findOpenRecord(db, { ...input, collection });
    if (r) out.push({ collectionId: collection.id, values: Object.fromEntries(Object.entries(r.values).filter(([, v]) => v !== null && v !== "")) });
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Fields of `record` whose current value was taken from a message sent AFTER `sentAt`.
 * An older message processed late (backfill, retries, a forced re-run) must not
 * overwrite newer facts with stale ones.
 */
export async function fieldsFromNewerMessages(db: Database, workspaceId: string, record: RecordRow, sentAt: Date, selfMessageId: string | null): Promise<Set<string>> {
  const byMessage = new Map<string, string[]>();
  for (const [key, meta] of Object.entries(record.fieldMeta ?? {})) {
    if (!meta?.messageId || meta.messageId === selfMessageId || meta.edited) continue;
    byMessage.set(meta.messageId, [...(byMessage.get(meta.messageId) ?? []), key]);
  }
  const out = new Set<string>();
  if (!byMessage.size) return out;
  const rows = await db
    .select({ id: messages.id, sentAt: messages.sentAt })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), inArray(messages.id, [...byMessage.keys()])));
  for (const r of rows) if (r.sentAt.getTime() > sentAt.getTime()) for (const k of byMessage.get(r.id) ?? []) out.add(k);
  return out;
}

export type Target =
  | { kind: "none" }
  | { kind: "live"; record: RecordRow; via: "source" | "match_key" | "open_record" }
  | { kind: "deleted"; record: RecordRow; via: "source" | "match_key" };

/**
 * The record a message should update (step 9):
 *  1. the record this same event already wrote to (idempotent re-processing);
 *  2. the live record with the same match key (a deleted one blocks re-creation
 *     when the message predates the deletion);
 *  3. without a match key: the contact's most recent open record (≤ 30 days).
 */
export async function findTarget(
  db: Database,
  input: { workspaceId: string; collection: CollectionRow; eventId: string | null; matchKey: string | null; contactId: string | null; conversationId: string | null; sentAt: Date; now: Date },
): Promise<Target> {
  if (input.eventId) {
    const anchored = await db
      .select({ record: records })
      .from(recordSources)
      .innerJoin(records, eq(records.id, recordSources.recordId))
      .where(and(eq(recordSources.workspaceId, input.workspaceId), eq(recordSources.eventId, input.eventId), eq(records.collectionId, input.collection.id), eq(records.workspaceId, input.workspaceId)))
      .orderBy(sql`${records.deletedAt} is not null`, desc(records.updatedAt))
      .limit(1);
    const a = anchored[0]?.record;
    if (a) return a.deletedAt ? { kind: "deleted", record: a, via: "source" } : { kind: "live", record: a, via: "source" };
  }
  if (input.matchKey) {
    const rows = await db
      .select()
      .from(records)
      .where(and(eq(records.workspaceId, input.workspaceId), eq(records.collectionId, input.collection.id), eq(records.matchKey, input.matchKey)))
      .orderBy(sql`${records.deletedAt} is not null`, desc(records.deletedAt))
      .limit(1);
    const r = rows[0];
    if (r && !r.deletedAt) return { kind: "live", record: r, via: "match_key" };
    if (r?.deletedAt && input.sentAt.getTime() <= r.deletedAt.getTime()) return { kind: "deleted", record: r, via: "match_key" };
    return { kind: "none" };
  }
  const open = await findOpenRecord(db, input);
  return open ? { kind: "live", record: open, via: "open_record" } : { kind: "none" };
}
