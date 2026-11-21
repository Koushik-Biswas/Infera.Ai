/**
 * Re-run the pipeline over past messages so a new / changed collection fills
 * up from history. Re-uses each message's event (status reset to "queued") —
 * processing is idempotent (same event → same record, NO_OP when nothing new).
 */
import { and, asc, eq, gte, inArray, lte, ne, notInArray } from "drizzle-orm";
import { z } from "zod";
import { sourceOf } from "@/lib/shared/types";
import { getDb, type Database } from "../db";
import { channels, collections, conversations, events, jobs, messages } from "../db/schema";
import { newId } from "../ids";
import { log } from "../http";
import { PermanentJobError } from "../jobs/queue";

export const BACKFILL_CAP = 5000;
const DEFAULT_WINDOW_DAYS = 30;
const BATCH = 500;

export type BackfillInput = { workspaceId: string; collectionId: string; since?: string | Date | null; until?: string | Date | null };

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Queues `process_message` jobs (priority 200) for the collection's messages in the window. */
export async function backfillCollection(db: Database, input: BackfillInput): Promise<{ queued: number; capped: boolean }> {
  const [collection] = await db
    .select()
    .from(collections)
    .where(and(eq(collections.id, input.collectionId), eq(collections.workspaceId, input.workspaceId)))
    .limit(1);
  if (!collection || collection.archivedAt) return { queued: 0, capped: false };

  const until = toDate(input.until) ?? new Date();
  const since = toDate(input.since) ?? new Date(until.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);
  const channelIds = collection.routing.channelIds?.length ? collection.routing.channelIds : null;

  const rows = await db
    .select({ id: messages.id, eventId: messages.eventId, channelType: channels.type })
    .from(messages)
    .innerJoin(channels, and(eq(channels.id, messages.channelId), eq(channels.workspaceId, input.workspaceId)))
    // Agents run only on selected chats.
    .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.agentsEnabled, true)))
    .where(
      and(
        eq(messages.workspaceId, input.workspaceId),
        gte(messages.sentAt, since),
        lte(messages.sentAt, until),
        notInArray(messages.kind, ["system", "deleted"]),
        channelIds ? inArray(messages.channelId, channelIds) : undefined,
      ),
    )
    .orderBy(asc(messages.sentAt))
    .limit(BACKFILL_CAP + 1);
  const capped = rows.length > BACKFILL_CAP;
  const picked = rows.slice(0, BACKFILL_CAP);
  if (capped) log("warn", "backfill_capped", { workspaceId: input.workspaceId, collectionId: collection.id, cap: BACKFILL_CAP });
  if (!picked.length) return { queued: 0, capped };

  const eventIds: string[] = [];
  await db.transaction(async (tx) => {
    // Messages stored without processing (e.g. imports with processing off) get their event now.
    for (const m of picked.filter((r) => !r.eventId)) {
      const id = newId("evt");
      await tx.insert(events).values({ id, workspaceId: input.workspaceId, messageId: m.id, source: sourceOf[m.channelType], status: "queued" });
      await tx
        .update(messages)
        .set({ eventId: id, status: "queued" })
        .where(and(eq(messages.id, m.id), eq(messages.workspaceId, input.workspaceId)));
      eventIds.push(id);
    }
    const existing = picked.filter((r) => r.eventId).map((r) => r.eventId!);
    for (let i = 0; i < existing.length; i += BATCH) {
      // Events currently being processed are left alone; their result is fresh.
      const reset = await tx
        .update(events)
        .set({ status: "queued", error: null })
        .where(and(eq(events.workspaceId, input.workspaceId), inArray(events.id, existing.slice(i, i + BATCH)), ne(events.status, "processing")))
        .returning({ id: events.id });
      eventIds.push(...reset.map((r) => r.id));
    }
    const now = new Date();
    for (let i = 0; i < eventIds.length; i += BATCH) {
      await tx.insert(jobs).values(
        eventIds.slice(i, i + BATCH).map((eventId) => ({
          type: "process_message",
          payload: { eventId },
          workspaceId: input.workspaceId,
          runAt: now,
          priority: 200,
          maxAttempts: 5,
        })),
      );
    }
  });
  log("info", "backfill_queued", { workspaceId: input.workspaceId, collectionId: collection.id, queued: eventIds.length, capped });
  return { queued: eventIds.length, capped };
}

const Payload = z.object({ workspaceId: z.string().min(1).max(100), collectionId: z.string().min(1).max(100), since: z.string().nullish(), until: z.string().nullish() });

/** Job handler for `backfill_collection`. */
export async function handleBackfillCollection(payload: { workspaceId: string; collectionId: string; since?: string | null; until?: string | null }): Promise<void> {
  const p = Payload.safeParse(payload);
  if (!p.success) throw new PermanentJobError("Invalid backfill_collection payload.");
  const db = await getDb();
  await backfillCollection(db, p.data);
}

