/**
 * Executes an operation that was held for human review (called by the review
 * approve endpoint). Re-checks that the collection / record still belong to
 * the workspace, writes machine values (approved by a person, so they may
 * replace edited values and count as confirmed) and the reviewer's corrections
 * as human input, then reports the verified outcome.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Actor, CellValue, FieldChange, FieldConflict, FieldMeta, ProposedOperation, RecordOperation } from "@/lib/shared/types";
import type { Database } from "../db";
import { collections, contacts, conversations, records } from "../db/schema";
import { conflict, notFound, unprocessable } from "../api/handler";
import { DuplicateRecordError, createRecord, updateRecord, type SourceRef } from "../records/ops";
import { normalizeValues } from "../records/coerce";

export async function applyProposedOperation(
  db: Database,
  input: { workspaceId: string; proposed: ProposedOperation; actor: Actor; overrides?: Record<string, CellValue>; reviewItemId: string },
): Promise<RecordOperation> {
  const { workspaceId, proposed, actor } = input;
  return db.transaction(async (tx) => {
    const [collection] = await tx
      .select()
      .from(collections)
      .where(and(eq(collections.id, proposed.collectionId), eq(collections.workspaceId, workspaceId)))
      .limit(1);
    if (!collection) throw notFound("Collection");
    if (collection.archivedAt) throw conflict("This collection is archived. Restore it before approving.");

    const fieldKeys = new Set(collection.fields.map((f) => f.key));
    const overrides = Object.fromEntries(Object.entries(input.overrides ?? {}).filter(([k]) => fieldKeys.has(k)));
    // Proposed machine values the reviewer did not correct; a person approved them, so they count as confirmed.
    const machine: Record<string, CellValue> = {};
    const machineMeta: Record<string, FieldMeta> = {};
    const nowIso = new Date().toISOString();
    for (const [k, v] of Object.entries(proposed.values ?? {})) {
      if (!fieldKeys.has(k) || k in overrides || v === null || v === undefined) continue;
      machine[k] = v;
      const m = proposed.fieldMeta?.[k];
      machineMeta[k] = m
        ? { ...m, confidence: 1, updatedAt: nowIso }
        : { source: "extracted", confidence: 1, messageId: proposed.messageId, eventId: proposed.eventId, evidence: null, method: "rules", updatedAt: nowIso };
    }

    const sources: SourceRef[] = proposed.messageId
      ? [
          { messageId: proposed.messageId, eventId: proposed.eventId, fieldKey: null, evidence: null, confidence: null },
          ...Object.keys(machine).map((k) => ({ messageId: machineMeta[k].messageId ?? proposed.messageId, eventId: proposed.eventId, fieldKey: k, evidence: machineMeta[k].evidence, confidence: proposed.fieldMeta?.[k]?.confidence ?? null })),
        ]
      : [];

    // Contact / conversation must still be in this workspace (they may have been deleted since).
    const contactId = proposed.contactId
      ? ((
          await tx
            .select({ id: contacts.id })
            .from(contacts)
            .where(and(eq(contacts.id, proposed.contactId), eq(contacts.workspaceId, workspaceId)))
            .limit(1)
        )[0]?.id ?? null)
      : null;
    const conversationId = proposed.conversationId
      ? ((
          await tx
            .select({ id: conversations.id })
            .from(conversations)
            .where(and(eq(conversations.id, proposed.conversationId), eq(conversations.workspaceId, workspaceId)))
            .limit(1)
        )[0]?.id ?? null)
      : null;

    const base = { collection: collection.name, collection_id: collection.id, review_item_id: input.reviewItemId };

    const update = async (recordId: string, action: "CREATE_RECORD" | "UPDATE_RECORD"): Promise<RecordOperation> => {
      const [rec] = await tx
        .select({ id: records.id, deletedAt: records.deletedAt })
        .from(records)
        .where(and(eq(records.id, recordId), eq(records.workspaceId, workspaceId), eq(records.collectionId, collection.id)))
        .limit(1);
      if (!rec) throw notFound("Record");
      if (rec.deletedAt) throw conflict("This record was deleted. Restore it before approving the change.");
      const changes: FieldChange[] = [];
      let conflicts: FieldConflict[] = [];
      let verified = true;
      if (Object.keys(machine).length) {
        const r = await updateRecord(tx, { workspaceId, collection, recordId, patch: machine, meta: machineMeta, mode: "machine", actor, allowOverrideEdited: true, sources });
        changes.push(...r.changes);
        conflicts = r.conflicts;
        verified = r.verified;
      }
      if (Object.keys(overrides).length) {
        const r = await updateRecord(tx, { workspaceId, collection, recordId, patch: overrides, mode: "human", actor, sources: proposed.messageId ? [{ messageId: proposed.messageId, eventId: proposed.eventId, fieldKey: null }] : [] });
        for (const c of r.changes) {
          const i = changes.findIndex((x) => x.field === c.field);
          if (i >= 0) changes[i] = { field: c.field, from: changes[i].from, to: c.to };
          else changes.push(c);
        }
        verified = verified && r.verified;
      }
      return { ...base, action, record_id: recordId, status: "completed", changes, conflicts, verified };
    };

    if (proposed.action === "UPDATE_RECORD") {
      if (!proposed.recordId) throw unprocessable("The proposed update has no record.");
      return update(proposed.recordId, "UPDATE_RECORD");
    }

    // CREATE_RECORD: every required field needs a value (from the proposal or the reviewer).
    const merged = { ...machine, ...overrides };
    const { values } = normalizeValues(collection.fields, merged);
    const missing = collection.fields.filter((f) => f.required && (values[f.key] === null || values[f.key] === undefined || values[f.key] === ""));
    if (missing.length) {
      throw unprocessable(`Fill in ${missing.map((f) => `"${f.label}"`).join(", ")} before approving.`, { missing: missing.map((f) => f.key) });
    }
    try {
      const r = await createRecord(tx, {
        workspaceId,
        collection,
        values: merged,
        // Fields without meta (the reviewer's corrections) are recorded as human input.
        fieldMeta: machineMeta,
        contactId,
        conversationId,
        origin: "pipeline",
        actor,
        sources,
      });
      return { ...base, action: "CREATE_RECORD", record_id: r.record.id, status: "completed", changes: r.changes, conflicts: [], verified: r.verified };
    } catch (e) {
      // Someone created the same record meanwhile: apply the approved values to it.
      if (e instanceof DuplicateRecordError && e.existingId) {
        const [live] = await tx
          .select({ id: records.id })
          .from(records)
          .where(and(eq(records.id, e.existingId), eq(records.workspaceId, workspaceId), isNull(records.deletedAt)))
          .limit(1);
        if (live) return update(live.id, "UPDATE_RECORD");
      }
      throw e;
    }
  });
}
