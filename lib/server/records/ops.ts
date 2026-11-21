/**
 * Record operations — the ONLY code that writes `records`. Used by the
 * pipeline, the REST API, automations and review approvals, so the rules
 * below hold everywhere:
 *
 *  - Values are normalised deterministically against the collection's fields.
 *  - Machine writes (pipeline/automation) never overwrite a human-edited value,
 *    and never replace a value with a lower-confidence one. Those become
 *    `conflicts` (rule 4: never silently overwrite).
 *  - Every write bumps `version` (optimistic concurrency for API clients).
 *  - Every write records its source messages (`record_sources`, rule 10),
 *    writes an audit entry, emits domain events (transactional outbox), and is
 *    read back and compared before being reported as `verified` (rule 9).
 *  - Deletes are soft and only happen through `softDeleteRecord`, which callers
 *    must authorise first (rule 5).
 *
 * All functions run inside a transaction (nested calls use savepoints).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Actor, CellValue, FieldChange, FieldConflict, FieldMeta, ValueSource } from "@/lib/shared/types";
import type { Database } from "../db";
import { collections, recordSources, records, type CollectionRow, type RecordRow } from "../db/schema";
import { writeAudit } from "../audit";
import { emitDomainEvent } from "../events/bus";
import { newId } from "../ids";
import { ApiError } from "../api/handler";
import { computeMatchKey, normalizeValues, sameValue, statusFieldOf } from "./coerce";

export type SourceRef = { messageId: string | null; eventId?: string | null; fieldKey?: string | null; evidence?: string | null; confidence?: number | null };

export type Origin = RecordRow["origin"];

/** Thrown when a create collides with an existing live record that has the same match key. */
export class DuplicateRecordError extends Error {
  constructor(public existingId: string) {
    super("A record with the same identity already exists.");
  }
}

const sourceForActor = (actor: Actor): ValueSource =>
  actor.type === "api_key" ? "api" : actor.type === "automation" ? "automation" : actor.type === "user" ? "manual" : "extracted";

function humanMeta(actor: Actor, now: string): FieldMeta {
  return { source: sourceForActor(actor), confidence: null, messageId: null, eventId: null, evidence: null, method: "human", updatedAt: now, edited: actor.type === "user" || actor.type === "api_key" };
}

async function addSources(db: Database, workspaceId: string, recordId: string, sources: SourceRef[] | undefined) {
  if (!sources?.length) return;
  const existing = await db.select({ messageId: recordSources.messageId, fieldKey: recordSources.fieldKey }).from(recordSources).where(eq(recordSources.recordId, recordId));
  const seen = new Set(existing.map((s) => `${s.messageId}|${s.fieldKey ?? ""}`));
  const fresh = sources.filter((s) => {
    const k = `${s.messageId}|${s.fieldKey ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!fresh.length) return;
  await db.insert(recordSources).values(
    fresh.map((s) => ({
      workspaceId,
      recordId,
      messageId: s.messageId,
      eventId: s.eventId ?? null,
      fieldKey: s.fieldKey ?? null,
      evidence: s.evidence?.slice(0, 1000) ?? null,
      confidence: s.confidence ?? null,
    })),
  );
}

async function readBack(db: Database, id: string, expected: Record<string, CellValue>, version: number): Promise<boolean> {
  const row = await db.query.records.findFirst({ where: (r, { eq: e }) => e(r.id, id) });
  if (!row || row.version !== version) return false;
  return Object.entries(expected).every(([k, v]) => sameValue(row.values[k], v));
}

export async function getCollection(db: Database, workspaceId: string, collectionId: string): Promise<CollectionRow | null> {
  const rows = await db
    .select()
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

/* ------------------------------- Create ------------------------------ */

export type CreateRecordInput = {
  workspaceId: string;
  collection: CollectionRow;
  values: Record<string, unknown>;
  /** Per-field provenance. Fields without meta get human/actor meta. */
  fieldMeta?: Record<string, FieldMeta>;
  contactId?: string | null;
  conversationId?: string | null;
  origin: Origin;
  actor: Actor;
  sources?: SourceRef[];
  /** undefined → computed from collection.matchFields. */
  matchKey?: string | null;
  defaultCountry?: string;
  refDate?: Date;
};

export type WriteResult = { record: RecordRow; changes: FieldChange[]; conflicts: FieldConflict[]; warnings: { field: string; message: string }[]; verified: boolean };

export async function createRecord(db: Database, input: CreateRecordInput): Promise<WriteResult> {
  if (input.collection.workspaceId !== input.workspaceId) throw new ApiError(404, "not_found", "Collection not found.");
  return db.transaction(async (tx) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const { values, warnings } = normalizeValues(input.collection.fields, input.values, { refDate: input.refDate, defaultCountry: input.defaultCountry });
    const meta: Record<string, FieldMeta> = {};
    for (const k of Object.keys(values)) {
      if (values[k] === null) continue;
      meta[k] = input.fieldMeta?.[k] ?? humanMeta(input.actor, nowIso);
    }
    const statusField = statusFieldOf(input.collection.fields);
    const matchKey = input.matchKey !== undefined ? input.matchKey : computeMatchKey(input.collection.matchFields, values, input);
    const id = newId("rec");
    const inserted = await tx
      .insert(records)
      .values({
        id,
        workspaceId: input.workspaceId,
        collectionId: input.collection.id,
        values,
        fieldMeta: meta,
        matchKey,
        status: statusField ? ((values[statusField.key] as string | null) ?? null) : null,
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        origin: input.origin,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    const record = inserted[0];
    if (!record) {
      const existing = matchKey
        ? await tx
            .select({ id: records.id })
            .from(records)
            .where(and(eq(records.collectionId, input.collection.id), eq(records.matchKey, matchKey), isNull(records.deletedAt)))
            .limit(1)
        : [];
      throw new DuplicateRecordError(existing[0]?.id ?? "");
    }
    await addSources(tx, input.workspaceId, id, input.sources);
    const changes: FieldChange[] = Object.entries(values)
      .filter(([, v]) => v !== null)
      .map(([field, to]) => ({ field, from: null, to }));
    await writeAudit(tx, {
      workspaceId: input.workspaceId,
      actor: input.actor,
      action: "record.create",
      targetType: "record",
      targetId: id,
      after: values,
      meta: { collectionId: input.collection.id, origin: input.origin, sources: input.sources?.map((s) => ({ messageId: s.messageId, eventId: s.eventId ?? null })) ?? [] },
    });
    await emitDomainEvent(tx, {
      type: "record.created",
      workspaceId: input.workspaceId,
      actor: input.actor,
      data: { recordId: id, collectionId: input.collection.id, values, changes, messageId: input.sources?.[0]?.messageId ?? undefined, eventId: input.sources?.[0]?.eventId ?? undefined },
    });
    const verified = await readBack(tx, id, values, 1);
    return { record, changes, conflicts: [], warnings, verified };
  });
}

/* ------------------------------- Update ------------------------------ */

export type UpdateRecordInput = {
  workspaceId: string;
  collection: CollectionRow;
  recordId: string;
  patch: Record<string, unknown>;
  /** Provenance per patched field (machine writes). */
  meta?: Record<string, FieldMeta>;
  /** "human": a person/API client — always applied, marked edited. "machine": pipeline/automation — guarded. */
  mode: "human" | "machine";
  actor: Actor;
  /** If set and the row's version differs → 409. */
  expectedVersion?: number;
  sources?: SourceRef[];
  /** Review approval: a person explicitly accepted these machine values over edited ones. */
  allowOverrideEdited?: boolean;
  defaultCountry?: string;
  refDate?: Date;
};

export async function updateRecord(db: Database, input: UpdateRecordInput): Promise<WriteResult> {
  if (input.collection.workspaceId !== input.workspaceId) throw new ApiError(404, "not_found", "Collection not found.");
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(records)
      .where(and(eq(records.id, input.recordId), eq(records.workspaceId, input.workspaceId), eq(records.collectionId, input.collection.id)))
      .for("update")
      .limit(1);
    const current = locked[0];
    if (!current || current.deletedAt) throw new ApiError(404, "not_found", "Record not found.");
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new ApiError(409, "version_conflict", "This record was changed by someone else. Reload and try again.", { currentVersion: current.version });
    }

    const nowIso = new Date().toISOString();
    const { values: normalized, warnings } = normalizeValues(input.collection.fields, input.patch, { refDate: input.refDate, defaultCountry: input.defaultCountry });
    const nextValues = { ...current.values };
    const nextMeta = { ...current.fieldMeta };
    const changes: FieldChange[] = [];
    const conflicts: FieldConflict[] = [];

    for (const [key, proposed] of Object.entries(normalized)) {
      const existing = current.values[key] ?? null;
      const existingMeta = current.fieldMeta[key];
      if (input.mode === "human") {
        if (sameValue(existing, proposed) && existingMeta?.edited) continue;
        nextValues[key] = proposed;
        nextMeta[key] = humanMeta(input.actor, nowIso);
        if (!sameValue(existing, proposed)) changes.push({ field: key, from: existing, to: proposed });
        continue;
      }
      // Machine write.
      if (proposed === null) continue; // unknown never erases a known value
      const m = input.meta?.[key];
      if (sameValue(existing, proposed)) {
        // Same fact seen again: keep the value, upgrade provenance if more confident.
        if (m && !existingMeta?.edited && (m.confidence ?? 0) > (existingMeta?.confidence ?? 0)) nextMeta[key] = m;
        continue;
      }
      if (existingMeta?.edited && !input.allowOverrideEdited) {
        conflicts.push({ field: key, existing, proposed, reason: "human_edited" });
        continue;
      }
      if (existing !== null && !input.allowOverrideEdited && (m?.confidence ?? 0) < (existingMeta?.confidence ?? 0)) {
        conflicts.push({ field: key, existing, proposed, reason: "lower_confidence" });
        continue;
      }
      nextValues[key] = proposed;
      nextMeta[key] = m ?? { source: sourceForActor(input.actor), confidence: null, messageId: null, eventId: null, evidence: null, method: null, updatedAt: nowIso };
      changes.push({ field: key, from: existing, to: proposed });
    }

    if (!changes.length && JSON.stringify(nextMeta) === JSON.stringify(current.fieldMeta)) {
      await addSources(tx, input.workspaceId, current.id, input.sources);
      return { record: current, changes, conflicts, warnings, verified: true };
    }

    const statusField = statusFieldOf(input.collection.fields);
    const fromStatus = current.status;
    const toStatus = statusField ? ((nextValues[statusField.key] as string | null) ?? null) : null;
    const matchKey = computeMatchKey(input.collection.matchFields, nextValues, { contactId: current.contactId, conversationId: current.conversationId }) ?? current.matchKey;
    const version = current.version + 1;
    const [record] = await tx
      .update(records)
      .set({ values: nextValues, fieldMeta: nextMeta, status: toStatus, matchKey, version, updatedAt: new Date() })
      .where(eq(records.id, current.id))
      .returning();

    await addSources(tx, input.workspaceId, current.id, input.sources);
    if (changes.length) {
      await writeAudit(tx, {
        workspaceId: input.workspaceId,
        actor: input.actor,
        action: "record.update",
        targetType: "record",
        targetId: current.id,
        before: Object.fromEntries(changes.map((c) => [c.field, c.from])),
        after: Object.fromEntries(changes.map((c) => [c.field, c.to])),
        meta: { collectionId: input.collection.id, mode: input.mode, version, conflicts, sources: input.sources?.map((s) => ({ messageId: s.messageId, eventId: s.eventId ?? null })) ?? [] },
      });
      const base = { recordId: current.id, collectionId: input.collection.id, values: nextValues, changes, messageId: input.sources?.[0]?.messageId ?? undefined, eventId: input.sources?.[0]?.eventId ?? undefined };
      await emitDomainEvent(tx, { type: "record.updated", workspaceId: input.workspaceId, actor: input.actor, data: base });
      if (statusField && !sameValue(fromStatus, toStatus)) {
        await emitDomainEvent(tx, { type: "record.status_changed", workspaceId: input.workspaceId, actor: input.actor, data: { ...base, fromStatus, toStatus } });
      }
    }
    const verified = await readBack(tx, current.id, Object.fromEntries(changes.map((c) => [c.field, c.to])), version);
    return { record, changes, conflicts, warnings, verified };
  });
}

/* --------------------------- Delete / restore ------------------------ */

/** Soft delete. Callers MUST check authorisation first (admin role or API "delete" scope). */
export async function softDeleteRecord(db: Database, input: { workspaceId: string; recordId: string; actor: Actor; reason?: string }): Promise<RecordRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(records)
      .set({ deletedAt: new Date(), deletedBy: input.actor.id ?? input.actor.type, updatedAt: new Date() })
      .where(and(eq(records.id, input.recordId), eq(records.workspaceId, input.workspaceId), isNull(records.deletedAt)))
      .returning();
    if (!row) throw new ApiError(404, "not_found", "Record not found.");
    await tx
      .update(records)
      .set({ version: row.version + 1 })
      .where(eq(records.id, row.id));
    await writeAudit(tx, { workspaceId: input.workspaceId, actor: input.actor, action: "record.delete", targetType: "record", targetId: row.id, before: row.values, meta: { collectionId: row.collectionId, reason: input.reason ?? null } });
    await emitDomainEvent(tx, { type: "record.deleted", workspaceId: input.workspaceId, actor: input.actor, data: { recordId: row.id, collectionId: row.collectionId, values: row.values } });
    return { ...row, version: row.version + 1 };
  });
}

export async function restoreRecord(db: Database, input: { workspaceId: string; recordId: string; actor: Actor }): Promise<RecordRow> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(records)
      .where(and(eq(records.id, input.recordId), eq(records.workspaceId, input.workspaceId)))
      .limit(1);
    const row = rows[0];
    if (!row || !row.deletedAt) throw new ApiError(404, "not_found", "Deleted record not found.");
    if (row.matchKey) {
      const live = await tx
        .select({ id: records.id })
        .from(records)
        .where(and(eq(records.collectionId, row.collectionId), eq(records.matchKey, row.matchKey), isNull(records.deletedAt)))
        .limit(1);
      if (live[0]) throw new ApiError(409, "conflict", "A newer record with the same identity exists.", { recordId: live[0].id });
    }
    const [restored] = await tx
      .update(records)
      .set({ deletedAt: null, deletedBy: null, version: row.version + 1, updatedAt: new Date() })
      .where(eq(records.id, row.id))
      .returning();
    await writeAudit(tx, { workspaceId: input.workspaceId, actor: input.actor, action: "record.restore", targetType: "record", targetId: row.id, after: row.values });
    return restored;
  });
}
