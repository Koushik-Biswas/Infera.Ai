/**
 * Human review resolution (approve / reject), shared by the review routes.
 *
 * One transaction: lock the item (only `open` items can be resolved → 409
 * `already_resolved`), apply the proposed operation on approval through
 * `applyProposedOperation` (record ops: normalised, versioned, audited, verified), mark
 * the item resolved, emit `review.resolved`, audit, and — when the originating event has
 * no open items left — mark it processed (events.status, result.status,
 * result.requires_human_review) and update its record operations with the outcome.
 * Any failure rolls everything back, so the item stays open.
 */
import { and, count, eq } from "drizzle-orm";
import type { Actor, CellValue, ProcessingResult, RecordOperation } from "@/lib/shared/types";
import type { Database } from "../db";
import { events, messages, reviewItems, type ReviewItemRow } from "../db/schema";
import { ApiError, notFound, unprocessable } from "../api/handler";
import { writeAudit } from "../audit";
import { emitDomainEvent } from "../events/bus";
import { applyProposedOperation } from "../pipeline/apply";

export type ResolveInput = {
  workspaceId: string;
  reviewItemId: string;
  decision: "approve" | "reject";
  actor: Actor;
  /** User id or API key id recorded as `resolvedBy`. */
  resolvedBy: string | null;
  values?: Record<string, CellValue>;
  note?: string | null;
};

export const alreadyResolved = (status: string) => new ApiError(409, "already_resolved", `This review item was already ${status}.`, { status });

function patchOperations(result: ProcessingResult, itemId: string, decision: "approve" | "reject", operation: RecordOperation | null): ProcessingResult {
  const apply = (op: RecordOperation): RecordOperation => {
    if (op.review_item_id !== itemId) return op;
    if (decision === "reject") return { ...op, status: "skipped" };
    if (!operation) return { ...op, status: "completed" };
    return { ...op, ...operation, review_item_id: itemId };
  };
  const ops = Array.isArray(result.record_operations) ? result.record_operations.map(apply) : result.record_operations;
  return { ...result, record_operations: ops, record_operation: result.record_operation ? apply(result.record_operation) : result.record_operation };
}

/** Updates the originating event after one of its review items was resolved. */
async function settleEvent(tx: Database, item: ReviewItemRow, decision: "approve" | "reject", operation: RecordOperation | null): Promise<void> {
  if (!item.eventId) return;
  const [ev] = await tx
    .select({ id: events.id, status: events.status, result: events.result, messageId: events.messageId })
    .from(events)
    .where(and(eq(events.id, item.eventId), eq(events.workspaceId, item.workspaceId)))
    .for("update")
    .limit(1);
  if (!ev) return;
  const [{ open }] = await tx
    .select({ open: count() })
    .from(reviewItems)
    .where(and(eq(reviewItems.workspaceId, item.workspaceId), eq(reviewItems.eventId, ev.id), eq(reviewItems.status, "open")));
  const allResolved = open === 0;

  let result = ev.result ? patchOperations(ev.result, item.id, decision, operation) : null;
  if (result && allResolved) result = { ...result, requires_human_review: false, status: result.status === "needs_review" ? "processed" : result.status };
  const status = allResolved && ev.status === "needs_review" ? "processed" : ev.status;

  await tx
    .update(events)
    .set({ status, ...(result ? { result } : {}) })
    .where(and(eq(events.id, ev.id), eq(events.workspaceId, item.workspaceId)));
  if (allResolved && ev.status === "needs_review") {
    await tx
      .update(messages)
      .set({ status: "processed" })
      .where(and(eq(messages.id, ev.messageId), eq(messages.workspaceId, item.workspaceId), eq(messages.status, "needs_review")));
  }
}

export async function resolveReviewItem(db: Database, input: ResolveInput): Promise<{ item: ReviewItemRow; operation: RecordOperation | null }> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(reviewItems)
      .where(and(eq(reviewItems.id, input.reviewItemId), eq(reviewItems.workspaceId, input.workspaceId)))
      .for("update")
      .limit(1);
    if (!item) throw notFound("Review item");
    if (item.status !== "open") throw alreadyResolved(item.status);

    let operation: RecordOperation | null = null;
    const overrides = input.values && Object.keys(input.values).length ? input.values : undefined;
    if (input.decision === "approve") {
      if (item.proposed) {
        operation = await applyProposedOperation(tx, { workspaceId: input.workspaceId, proposed: item.proposed, actor: input.actor, overrides, reviewItemId: item.id });
      } else if (overrides) {
        throw unprocessable("This review item has no proposed change to edit — reject it or edit the record directly.");
      }
    }

    const now = new Date();
    const status = input.decision === "approve" ? "approved" : "rejected";
    const note = input.note?.trim() ? input.note.trim() : null;
    const [updated] = await tx
      .update(reviewItems)
      .set({ status, resolvedBy: input.resolvedBy, resolvedAt: now, resolutionNote: note, recordId: operation?.record_id ?? item.recordId })
      .where(and(eq(reviewItems.id, item.id), eq(reviewItems.workspaceId, input.workspaceId)))
      .returning();

    await emitDomainEvent(tx, {
      type: "review.resolved",
      workspaceId: input.workspaceId,
      actor: input.actor,
      data: {
        reviewItemId: item.id,
        collectionId: item.collectionId ?? undefined,
        recordId: updated.recordId ?? undefined,
        messageId: item.messageId ?? undefined,
        eventId: item.eventId ?? undefined,
      },
    });

    await writeAudit(tx, {
      workspaceId: input.workspaceId,
      actor: input.actor,
      action: input.decision === "approve" ? "review.approve" : "review.reject",
      targetType: "review_item",
      targetId: item.id,
      before: { status: "open" },
      after: {
        status,
        recordId: updated.recordId ?? null,
        ...(operation ? { action: operation.action, changes: operation.changes.map((c) => c.field), verified: operation.verified } : {}),
      },
      meta: {
        kind: item.kind,
        collectionId: item.collectionId,
        eventId: item.eventId,
        overriddenFields: overrides ? Object.keys(overrides) : [],
        hasNote: Boolean(note),
        sources: item.messageId ? [{ messageId: item.messageId, eventId: item.eventId }] : [],
      },
    });

    await settleEvent(tx, item, input.decision, operation);
    return { item: updated, operation };
  });
}
