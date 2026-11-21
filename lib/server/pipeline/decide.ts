/**
 * Step 9 — what to do with one collection's extracted values.
 *
 *  - confidence ≥ autoApplyThreshold → applied;
 *    reviewThreshold ≤ confidence < autoApply → held for human review (low_confidence);
 *    below reviewThreshold → dropped to suggestions (never applied, rule 11).
 *  - An existing record (same event / same match key / the contact's open record) is updated:
 *    metadata only fills empty fields, "last activity" dates never move back, statuses never
 *    regress along the pipeline (except to Cancelled/Lost/Refunded), initial statuses are not re-applied.
 *  - A record deleted by a person is never re-created from the same information (NO_OP + warning).
 *  - A new record needs every required field at auto-apply confidence, otherwise the whole create
 *    is held for review (missing_required / low_confidence, rule 14). Messages with nothing but
 *    metadata/status for the collection don't create anything (NO_OP).
 *
 * Pure: the target record is looked up by the caller.
 */
import type { CellValue, ProcessingWarning, RecordAction, Suggestion } from "@/lib/shared/types";
import type { CollectionRow } from "../db/schema";
import { computeMatchKey, sameValue, statusFieldOf } from "../records/coerce";
import type { Target } from "./context";
import type { Candidate } from "./types";
import { isNegativeStatus } from "./vocab";

export type Thresholds = { autoApply: number; review: number };

export type Plan = {
  collection: CollectionRow;
  candidates: Candidate[];
  updateOnly: boolean;
  via: "category" | "keyword" | "forced";
};

export type Decision = {
  collection: CollectionRow;
  action: RecordAction;
  target: Target;
  /** Values to write now (or, for PENDING_REVIEW, the whole proposal). */
  apply: Candidate[];
  /** Values held for review after the write (low confidence). */
  hold: Candidate[];
  reviewKind: "missing_required" | "low_confidence" | null;
  reason: string;
  warnings: ProcessingWarning[];
  suggestions: Suggestion[];
  /** NO_OP on an existing record whose values already match the message (read back = verified). */
  alreadyApplied: boolean;
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Roles that merely restate the message or its sender — they never justify a new record on their own. */
const ECHO_ROLES = new Set(["status", "summary", "caption", "link_context", "sender", "chat", "file_type"]);

/** A value that is real content for this collection (the shared photo/file counts, sender metadata doesn't). */
function isSubstantive(c: Candidate): boolean {
  if (c.isDefault) return false;
  if (c.role === "image" || c.role === "file") return true;
  return c.method !== "metadata" && !ECHO_ROLES.has(c.role);
}

/** Values that identify the record (applied + held), used for the match key. */
export function identityValues(plan: Plan, th: Thresholds): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const c of plan.candidates) if (c.value !== null && !c.isDefault && c.confidence >= th.review) out[c.field.key] = c.value;
  return out;
}

export function planMatchKey(plan: Plan, th: Thresholds, owner: { contactId: string | null; conversationId: string | null }): string | null {
  return computeMatchKey(plan.collection.matchFields, identityValues(plan, th), owner);
}

/** Moving from `from` to `to` goes backwards in the status pipeline (and isn't a cancellation/refund/loss). */
export function isStatusRegression(collection: CollectionRow, from: CellValue, to: CellValue): boolean {
  const options = statusFieldOf(collection.fields)?.options ?? [];
  if (typeof from !== "string" || typeof to !== "string") return false;
  const a = options.findIndex((o) => o.toLowerCase() === from.toLowerCase());
  const b = options.findIndex((o) => o.toLowerCase() === to.toLowerCase());
  if (a < 0 || b < 0 || b >= a) return false;
  return !isNegativeStatus(to);
}

export function decide(plan: Plan, target: Target, th: Thresholds, opts: { newerFields?: Set<string> } = {}): Decision {
  const { collection } = plan;
  const warnings: ProcessingWarning[] = [];
  const suggestions: Suggestion[] = [];
  const apply: Candidate[] = [];
  const hold: Candidate[] = [];

  for (const c of plan.candidates) {
    if (c.value === null) continue;
    if (c.isDefault || c.confidence >= th.autoApply) apply.push(c);
    else if (c.confidence >= th.review) hold.push(c);
    else
      suggestions.push({
        type: "field_value",
        text: `Possible ${c.field.label}: ${String(c.value)} (confidence ${pct(c.confidence)}, below the review threshold — not applied).`,
        field: c.field.key,
        value: c.value,
        confidence: c.confidence,
        collection_id: collection.id,
      });
  }

  const base = { collection, target, warnings, suggestions, alreadyApplied: false };

  if (target.kind === "deleted") {
    warnings.push({ code: "record_deleted_by_user", message: `A matching ${collection.name} record was deleted by a person, so it was not re-created.` });
    return { ...base, action: "NO_OP", apply: [], hold: [], reviewKind: null, reason: "record deleted by a person" };
  }

  if (target.kind === "live") {
    const rec = target.record;
    const keep = (c: Candidate) => {
      if (c.isDefault) return false; // initial status only on create
      const existing = rec.values[c.field.key] ?? null;
      if (c.method === "metadata" && c.role !== "activity_date" && existing !== null && existing !== "") return false; // metadata only fills gaps
      if (opts.newerFields?.has(c.field.key) && existing !== null && existing !== "") return false; // a newer message already set it
      if (c.role === "activity_date" && typeof existing === "string" && typeof c.value === "string" && existing > c.value) return false;
      if (c.role === "status" && isStatusRegression(collection, existing, c.value)) {
        warnings.push({ code: "status_not_regressed", field: c.field.key, message: `${c.field.label} stays “${String(existing)}”: the message suggests the earlier stage “${String(c.value)}”.` });
        return false;
      }
      return true;
    };
    const applyU = apply.filter(keep);
    const holdU = hold.filter(keep).filter((c) => !sameValue(rec.values[c.field.key] ?? null, c.value));
    const changing = applyU.filter((c) => !sameValue(rec.values[c.field.key] ?? null, c.value));
    const upgrades = applyU.filter((c) => {
      const m = rec.fieldMeta[c.field.key];
      return sameValue(rec.values[c.field.key] ?? null, c.value) && !m?.edited && c.confidence > (m?.confidence ?? 0) && c.method !== "metadata";
    });
    if (!changing.length && !upgrades.length && !holdU.length) {
      return { ...base, action: "NO_OP", apply: [], hold: [], reviewKind: null, reason: "the record already has this information", alreadyApplied: true };
    }
    if (!changing.length && !upgrades.length) {
      return { ...base, action: "PENDING_REVIEW", apply: [], hold: holdU, reviewKind: "low_confidence", reason: lowReason(holdU) };
    }
    return { ...base, action: "UPDATE_RECORD", apply: applyU, hold: holdU, reviewKind: holdU.length ? "low_confidence" : null, reason: "update existing record" };
  }

  if (plan.updateOnly) return { ...base, action: "NO_OP", apply: [], hold: [], reviewKind: null, reason: "no open record to update" };

  if (![...apply, ...hold].some(isSubstantive)) return { ...base, action: "NO_OP", apply: [], hold: [], reviewKind: null, reason: "nothing to record for this collection" };

  const required = collection.fields.filter((f) => f.required);
  const missing = required.filter((f) => !apply.some((c) => c.field.key === f.key));
  if (missing.length) {
    const allHeld = missing.every((f) => hold.some((c) => c.field.key === f.key));
    const labels = missing.map((f) => `“${f.label}”`).join(", ");
    for (const f of missing) {
      if (!hold.some((c) => c.field.key === f.key)) warnings.push({ code: "missing_required", field: f.key, message: `${collection.name}: required field ${f.label} was not found in the message.` });
    }
    return {
      ...base,
      action: "PENDING_REVIEW",
      apply: [...apply, ...hold],
      hold: [],
      reviewKind: allHeld ? "low_confidence" : "missing_required",
      reason: allHeld ? `Low confidence for required ${missing.length > 1 ? "fields" : "field"} ${labels}.` : `Required ${missing.length > 1 ? "fields" : "field"} ${labels} could not be extracted from the message.`,
    };
  }
  return { ...base, action: "CREATE_RECORD", apply, hold, reviewKind: hold.length ? "low_confidence" : null, reason: "new record" };
}

function lowReason(hold: Candidate[]): string {
  return `Low confidence for ${hold.map((c) => `“${c.field.label}” (${pct(c.confidence)})`).join(", ")}.`;
}

export { lowReason };
