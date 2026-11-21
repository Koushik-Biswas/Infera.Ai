/**
 * Step 11 — the standard backend output (`ProcessingResult`, lib/shared/types.ts).
 * Ids, record ids and execution statuses are filled by the backend from what
 * was actually committed — never by the AI.
 */
import type {
  AutomationOutcome,
  ExtractedEntity,
  MessageClassification,
  ProcessingResult,
  ProcessingStep,
  ProcessingWarning,
  RecordOperation,
  Source,
  SourceReference,
  Suggestion,
} from "@/lib/shared/types";
import type { Plan } from "./decide";

export const PIPELINE_VERSION = "2026.11.1";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Every value considered: one per collection field (rules, AI or metadata) + message-level entities. */
export function entitiesFrom(plans: Plan[], generic: ExtractedEntity[]): ExtractedEntity[] {
  const out: ExtractedEntity[] = [...generic];
  for (const p of plans) {
    for (const c of p.candidates) {
      out.push({ field: c.field.key, value: c.value, confidence: round2(c.confidence), evidence: c.evidence, method: c.method, collection_id: p.collection.id });
    }
  }
  return out;
}

function dedupeWarnings(ws: ProcessingWarning[]): ProcessingWarning[] {
  const seen = new Set<string>();
  return ws.filter((w) => {
    const k = `${w.code}|${w.field ?? ""}|${w.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function buildResult(input: {
  eventId: string;
  status: ProcessingResult["status"];
  source: Source;
  classification: MessageClassification;
  entities: ExtractedEntity[];
  operations: RecordOperation[];
  automation: AutomationOutcome[];
  suggestions: Suggestion[];
  warnings: ProcessingWarning[];
  reviewItemIds: string[];
  requiresReview: boolean;
  sourceReferences: SourceReference[];
  processedAt: Date | null;
  model: string | null;
  durationMs: number | null;
  aiUsed: boolean;
  steps: ProcessingStep[];
}): ProcessingResult {
  // Operations that did something come first, so `record_operation` (= the first) is the meaningful one.
  const operations = [...input.operations.filter((o) => o.action !== "NO_OP"), ...input.operations.filter((o) => o.action === "NO_OP")];
  return {
    event_id: input.eventId,
    status: input.status,
    source: input.source,
    message_classification: { ...input.classification, confidence: round2(input.classification.confidence) },
    extracted_entities: input.entities,
    record_operation: operations[0] ?? null,
    record_operations: operations,
    automation: input.automation,
    suggestions: input.suggestions,
    warnings: dedupeWarnings(input.warnings),
    requires_human_review: input.requiresReview,
    review_item_ids: input.reviewItemIds,
    source_references: input.sourceReferences,
    processing_metadata: {
      processed_at: input.processedAt ? input.processedAt.toISOString() : null,
      model: input.model,
      duration_ms: input.durationMs,
      pipeline_version: PIPELINE_VERSION,
      ai_used: input.aiUsed,
      steps: input.steps,
    },
  };
}

/** Result stored when processing throws (no record operation was committed). */
export function failedResult(input: { eventId: string; source: Source; message: string; durationMs: number; classification?: MessageClassification | null; steps?: ProcessingStep[] }): ProcessingResult {
  return buildResult({
    eventId: input.eventId,
    status: "failed",
    source: input.source,
    classification: input.classification ?? { category: "general", intent: "unknown", priority: "low", confidence: 0, method: "rules" },
    entities: [],
    operations: [],
    automation: [],
    suggestions: [],
    warnings: [{ code: "processing_failed", message: input.message }],
    reviewItemIds: [],
    requiresReview: false,
    sourceReferences: [],
    processedAt: null,
    model: null,
    durationMs: input.durationMs,
    aiUsed: false,
    steps: input.steps ?? [],
  });
}
