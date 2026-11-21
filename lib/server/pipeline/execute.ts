/**
 * Step 10 — executes one collection's decision inside the message's
 * transaction, only through the record ops (which normalise, guard human
 * edits, version, audit, emit record.* events and read back to verify).
 * Uncertain or conflicting values become review items (rule 4, rule 14).
 */
import { and, eq } from "drizzle-orm";
import type { Actor, CellValue, DomainEvent, FieldChange, FieldConflict, FieldMeta, Intent, Category, Priority, ProcessingWarning, ProposedOperation, RecordOperation } from "@/lib/shared/types";
import type { Database } from "../db";
import { records, reviewItems, type RecordRow } from "../db/schema";
import { emitDomainEvent } from "../events/bus";
import { newId } from "../ids";
import { DuplicateRecordError, createRecord, updateRecord, type SourceRef } from "../records/ops";
import { sameValue, statusFieldOf } from "../records/coerce";
import { decide, isStatusRegression, lowReason, planMatchKey, type Decision, type Plan, type Thresholds } from "./decide";
import type { Candidate, PipelineMessage } from "./types";

export type MatchableEvent = Omit<DomainEvent, "id" | "at">;

export type ExecEnv = {
  tx: Database;
  workspaceId: string;
  message: PipelineMessage;
  actor: Actor;
  thresholds: Thresholds;
  defaultCountry?: string;
  /** Wall-clock reference for relative dates (workspace timezone). */
  refDate: Date;
  classification: { category: Category; priority: Priority; intent: Intent };
};

export type ExecOutcome = {
  op: RecordOperation;
  reviewItemIds: string[];
  /** Domain events emitted by this operation (for automation matching). */
  events: MatchableEvent[];
  created: number;
  updated: number;
  warnings: ProcessingWarning[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function fieldMetaFor(c: Candidate, msg: PipelineMessage, nowIso: string): FieldMeta {
  return {
    source: "extracted",
    confidence: round2(c.confidence),
    messageId: c.messageId ?? msg.id,
    eventId: msg.eventId,
    evidence: c.evidence,
    method: c.method === "ai" ? "ai" : "rules",
    updatedAt: nowIso,
  };
}

function sourcesFor(cands: Candidate[], msg: PipelineMessage): SourceRef[] {
  const out: SourceRef[] = [{ messageId: msg.id, eventId: msg.eventId, fieldKey: null, evidence: null, confidence: null }];
  for (const c of cands) out.push({ messageId: c.messageId ?? msg.id, eventId: msg.eventId, fieldKey: c.field.key, evidence: c.evidence, confidence: round2(c.confidence) });
  return out;
}

const valuesOf = (cands: Candidate[]) => Object.fromEntries(cands.map((c) => [c.field.key, c.value])) as Record<string, CellValue>;
const metaOf = (cands: Candidate[], msg: PipelineMessage, nowIso: string) => Object.fromEntries(cands.map((c) => [c.field.key, fieldMetaFor(c, msg, nowIso)])) as Record<string, FieldMeta>;

export function proposalFor(action: ProposedOperation["action"], plan: Plan, recordId: string | null, cands: Candidate[], msg: PipelineMessage, matchKey: string | null): ProposedOperation {
  const nowIso = new Date().toISOString();
  return {
    action,
    collectionId: plan.collection.id,
    recordId,
    values: valuesOf(cands),
    fieldMeta: metaOf(cands, msg, nowIso),
    matchKey,
    contactId: msg.contactId,
    conversationId: msg.conversationId,
    messageId: msg.id,
    eventId: msg.eventId,
  };
}

const opBase = (plan: Plan) => ({ collection: plan.collection.name, collection_id: plan.collection.id });

/** One open review item per (message, collection, kind): re-processing refreshes it instead of duplicating it. */
async function upsertReview(
  env: ExecEnv,
  input: { kind: "low_confidence" | "conflict" | "missing_required"; reason: string; collectionId: string; recordId: string | null; proposed: ProposedOperation; current: Record<string, CellValue> | null; conflicts: FieldConflict[] },
): Promise<{ id: string; created: boolean }> {
  const { tx, message: msg } = env;
  if (msg.id) {
    const existing = await tx
      .select({ id: reviewItems.id })
      .from(reviewItems)
      .where(and(eq(reviewItems.workspaceId, env.workspaceId), eq(reviewItems.messageId, msg.id), eq(reviewItems.collectionId, input.collectionId), eq(reviewItems.kind, input.kind), eq(reviewItems.status, "open")))
      .limit(1);
    if (existing[0]) {
      await tx
        .update(reviewItems)
        .set({ reason: input.reason, recordId: input.recordId, proposed: input.proposed, current: input.current, conflicts: input.conflicts, eventId: msg.eventId })
        .where(eq(reviewItems.id, existing[0].id));
      return { id: existing[0].id, created: false };
    }
  }
  const id = newId("rvw");
  await tx.insert(reviewItems).values({
    id,
    workspaceId: env.workspaceId,
    kind: input.kind,
    reason: input.reason,
    status: "open",
    eventId: msg.eventId,
    messageId: msg.id,
    collectionId: input.collectionId,
    recordId: input.recordId,
    proposed: input.proposed,
    current: input.current,
    conflicts: input.conflicts,
  });
  return { id, created: true };
}

async function review(env: ExecEnv, out: ExecOutcome, input: Parameters<typeof upsertReview>[1]): Promise<string> {
  const r = await upsertReview(env, input);
  out.reviewItemIds.push(r.id);
  if (r.created) {
    const e: MatchableEvent = {
      type: "review.created",
      workspaceId: env.workspaceId,
      actor: env.actor,
      data: { reviewItemId: r.id, collectionId: input.collectionId, recordId: input.recordId ?? undefined, messageId: env.message.id ?? undefined, eventId: env.message.eventId ?? undefined, ...env.classification },
    };
    await emitDomainEvent(env.tx, e);
    out.events.push(e);
  }
  return r.id;
}

function conflictReason(collectionName: string, conflicts: FieldConflict[], plan: Plan): string {
  const label = (k: string) => plan.collection.fields.find((f) => f.key === k)?.label ?? k;
  const parts = conflicts.map((c) => `“${label(c.field)}” (${c.reason === "human_edited" ? "edited by a person" : c.reason === "lower_confidence" ? "existing value is more certain" : "conflicting value"})`);
  return `${collectionName}: the message disagrees with ${parts.join(", ")}.`;
}

export async function executeDecision(env: ExecEnv, plan: Plan, decision: Decision): Promise<ExecOutcome> {
  const out: ExecOutcome = { op: { ...opBase(plan), action: decision.action, record_id: null, status: "skipped", changes: [], conflicts: [], verified: false, review_item_id: null }, reviewItemIds: [], events: [], created: 0, updated: 0, warnings: [] };
  const msg = env.message;
  const owner = { contactId: msg.contactId, conversationId: msg.conversationId };

  switch (decision.action) {
    case "NO_OP": {
      out.op.record_id = decision.target.kind === "none" ? null : decision.target.record.id;
      out.op.verified = decision.alreadyApplied;
      return out;
    }
    case "PENDING_REVIEW": {
      const live = decision.target.kind === "live" ? decision.target.record : null;
      const proposed = live
        ? proposalFor("UPDATE_RECORD", plan, live.id, decision.hold, msg, live.matchKey)
        : proposalFor("CREATE_RECORD", plan, null, decision.apply, msg, planMatchKey(plan, env.thresholds, owner));
      const id = await review(env, out, {
        kind: decision.reviewKind ?? "low_confidence",
        reason: decision.reason,
        collectionId: plan.collection.id,
        recordId: live?.id ?? null,
        proposed,
        current: live?.values ?? null,
        conflicts: [],
      });
      out.op = { ...out.op, action: "PENDING_REVIEW", record_id: live?.id ?? null, status: "needs_review", review_item_id: id };
      return out;
    }
    case "CREATE_RECORD": {
      const nowIso = new Date().toISOString();
      let res;
      try {
        res = await createRecord(env.tx, {
          workspaceId: env.workspaceId,
          collection: plan.collection,
          values: valuesOf(decision.apply),
          fieldMeta: metaOf(decision.apply, msg, nowIso),
          contactId: msg.contactId,
          conversationId: msg.conversationId,
          origin: "pipeline",
          actor: env.actor,
          sources: sourcesFor(decision.apply, msg),
          defaultCountry: env.defaultCountry,
          refDate: env.refDate,
        });
      } catch (e) {
        // A concurrent message created the same record first: update it instead.
        if (!(e instanceof DuplicateRecordError) || !e.existingId) throw e;
        const [existing] = await env.tx
          .select()
          .from(records)
          .where(and(eq(records.id, e.existingId), eq(records.workspaceId, env.workspaceId)))
          .limit(1);
        if (!existing) throw e;
        const again = decide(plan, { kind: "live", record: existing, via: "match_key" }, env.thresholds);
        return executeDecision(env, plan, { ...again, warnings: [] });
      }
      out.warnings.push(...res.warnings.map((w) => ({ code: "invalid_value", field: w.field, message: w.message })));
      const e: MatchableEvent = {
        type: "record.created",
        workspaceId: env.workspaceId,
        actor: env.actor,
        data: { recordId: res.record.id, collectionId: plan.collection.id, values: res.record.values, changes: res.changes, messageId: msg.id ?? undefined, eventId: msg.eventId ?? undefined, ...env.classification },
      };
      out.events.push(e);
      out.created = 1;
      out.op = { ...out.op, action: "CREATE_RECORD", record_id: res.record.id, status: res.verified ? "completed" : "failed", changes: res.changes, verified: res.verified };
      if (!res.verified) out.warnings.push({ code: "verification_failed", message: `${plan.collection.name}: the new record could not be read back identically — please check it.` });
      if (decision.hold.length) {
        out.op.review_item_id = await review(env, out, {
          kind: "low_confidence",
          reason: lowReason(decision.hold),
          collectionId: plan.collection.id,
          recordId: res.record.id,
          proposed: proposalFor("UPDATE_RECORD", plan, res.record.id, decision.hold, msg, res.record.matchKey),
          current: res.record.values,
          conflicts: [],
        });
      }
      return out;
    }
    case "UPDATE_RECORD": {
      if (decision.target.kind !== "live") throw new Error("UPDATE_RECORD without a live target");
      return runUpdate(env, plan, decision, decision.target.record, out);
    }
  }
}

async function runUpdate(env: ExecEnv, plan: Plan, decision: Decision, record: RecordRow, out: ExecOutcome): Promise<ExecOutcome> {
  const msg = env.message;
  const nowIso = new Date().toISOString();
  const changes: FieldChange[] = [];
  let conflicts: FieldConflict[] = [];
  let verified = true;
  let current = record;
  const meta = metaOf(decision.apply, msg, nowIso);

  if (decision.apply.length) {
    const r = await updateRecord(env.tx, {
      workspaceId: env.workspaceId,
      collection: plan.collection,
      recordId: record.id,
      patch: valuesOf(decision.apply),
      meta,
      mode: "machine",
      actor: env.actor,
      sources: sourcesFor(decision.apply, msg),
      defaultCountry: env.defaultCountry,
      refDate: env.refDate,
    });
    changes.push(...r.changes);
    conflicts = [...r.conflicts];
    verified = r.verified;
    current = r.record;
    out.warnings.push(...r.warnings.map((w) => ({ code: "invalid_value", field: w.field, message: w.message })));

    // A newer message that moves the status forward supersedes an older, more confident status
    // (only reached when the status was not edited by a person — those stay conflicts).
    const sf = statusFieldOf(plan.collection.fields);
    const sc = sf ? conflicts.find((c) => c.field === sf.key && c.reason === "lower_confidence") : undefined;
    if (sf && sc && !isStatusRegression(plan.collection, sc.existing, sc.proposed)) {
      const cand = decision.apply.filter((c) => c.field.key === sf.key);
      const r2 = await updateRecord(env.tx, {
        workspaceId: env.workspaceId,
        collection: plan.collection,
        recordId: record.id,
        patch: { [sf.key]: sc.proposed },
        meta: { [sf.key]: meta[sf.key] },
        mode: "machine",
        actor: env.actor,
        allowOverrideEdited: true,
        sources: sourcesFor(cand, msg),
        defaultCountry: env.defaultCountry,
        refDate: env.refDate,
      });
      changes.push(...r2.changes);
      conflicts = conflicts.filter((c) => c !== sc);
      verified = verified && r2.verified;
      current = r2.record;
    }
  }

  if (changes.length) {
    const base = { recordId: record.id, collectionId: plan.collection.id, values: current.values, changes, messageId: msg.id ?? undefined, eventId: msg.eventId ?? undefined, ...env.classification };
    out.events.push({ type: "record.updated", workspaceId: env.workspaceId, actor: env.actor, data: base });
    if (statusFieldOf(plan.collection.fields) && !sameValue(record.status, current.status)) {
      out.events.push({ type: "record.status_changed", workspaceId: env.workspaceId, actor: env.actor, data: { ...base, fromStatus: record.status, toStatus: current.status } });
    }
    out.updated = 1;
  }

  let reviewId: string | null = null;
  if (conflicts.length) {
    const byKey = new Map(decision.apply.map((c) => [c.field.key, c]));
    const conflicting = conflicts.map((c) => byKey.get(c.field)).filter((c): c is Candidate => Boolean(c));
    reviewId = await review(env, out, {
      kind: "conflict",
      reason: conflictReason(plan.collection.name, conflicts, plan),
      collectionId: plan.collection.id,
      recordId: record.id,
      proposed: proposalFor("UPDATE_RECORD", plan, record.id, conflicting, msg, current.matchKey),
      current: current.values,
      conflicts,
    });
  }
  if (decision.hold.length) {
    const id = await review(env, out, {
      kind: "low_confidence",
      reason: lowReason(decision.hold),
      collectionId: plan.collection.id,
      recordId: record.id,
      proposed: proposalFor("UPDATE_RECORD", plan, record.id, decision.hold, msg, current.matchKey),
      current: current.values,
      conflicts: [],
    });
    reviewId ??= id;
  }

  const action = changes.length ? "UPDATE_RECORD" : reviewId ? "PENDING_REVIEW" : "NO_OP";
  const status = action === "UPDATE_RECORD" ? (verified ? "completed" : "failed") : action === "PENDING_REVIEW" ? "needs_review" : "skipped";
  if (action === "UPDATE_RECORD" && !verified) out.warnings.push({ code: "verification_failed", message: `${plan.collection.name}: the updated record could not be read back identically — please check it.` });
  out.op = { ...out.op, action, record_id: record.id, status, changes, conflicts, verified, review_item_id: reviewId };
  return out;
}
