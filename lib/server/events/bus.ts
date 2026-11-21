/**
 * Domain events (record.created, record.status_changed, message.processed...).
 *
 * Transactional outbox: `emitDomainEvent(tx, ...)` inserts a `domain_event` job
 * in the SAME transaction as the data change, so the event is published if and
 * only if the change commits. The job handler (lib/server/automations/jobs.ts)
 * runs automations, outbound webhooks and notifications.
 *
 * Each domain event is also published to the console's realtime stream
 * (ids only), delivered on commit — so open browsers refresh instantly.
 *
 * Loop guard: events whose actor is an automation do not trigger automations
 * again (they are still delivered to outbound webhooks).
 */
import type { DomainEvent } from "@/lib/shared/types";
import type { Database } from "../db";
import { newId } from "../ids";
import { enqueue } from "../jobs/queue";
import { publishRealtime } from "../realtime";

export async function emitDomainEvent(db: Database, e: Omit<DomainEvent, "id" | "at"> & { at?: string }): Promise<DomainEvent> {
  const event: DomainEvent = { ...e, id: newId("de"), at: e.at ?? new Date().toISOString() };
  await enqueue(db, {
    type: "domain_event",
    workspaceId: event.workspaceId,
    payload: event as unknown as Record<string, unknown>,
    priority: 50,
    dedupeKey: `de:${event.id}`,
  });
  const d = event.data;
  await publishRealtime(db, {
    type: event.type,
    workspaceId: event.workspaceId,
    at: event.at,
    data: { messageId: d.messageId, eventId: d.eventId, recordId: d.recordId, collectionId: d.collectionId, reviewItemId: d.reviewItemId },
  });
  return event;
}
