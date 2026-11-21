/**
 * The message-processing pipeline (docs/ARCHITECTURE.md §3).
 *
 *   load → validate → classify (rules) → [AI] → route → extract → verify evidence
 *   → normalise → decide → execute (one transaction) → verify → audit → respond
 *
 * `processEvent` runs it for a stored event (job / reprocess); `dryRunProcess`
 * runs the same analysis and decisions for the playground without writing.
 */
import { openText } from "../data/sealed";
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  SOURCES,
  defaultWorkspaceSettings,
  type AutomationOutcome,
  type Category,
  type ExtractedEntity,
  type MessageClassification,
  type ProcessingResult,
  type ProcessingStep,
  type ProcessingWarning,
  type RecordOperation,
  type Source,
  type SourceReference,
  type Suggestion,
  type WorkspaceSettings,
} from "@/lib/shared/types";
import { getDb, type Database } from "../db";
import { channels, collections, contacts, conversations, events, messages, workspaces, type CollectionRow, type EventRow } from "../db/schema";
import { notFound } from "../api/handler";
import { AiError, aiConfigured } from "../ai/client";
import { runPipelineAi, type PipelineAiOutput } from "../ai/pipeline";
import { PIPELINE_ACTOR, writeAudit } from "../audit";
import { emitDomainEvent } from "../events/bus";
import { log } from "../http";
import { bumpUsage } from "../usage";
import { matchAutomations } from "../automations/match";
import { normalizePhone, normalizeValue, sameValue } from "../records/coerce";
import { classifyRules, type RulesClassification } from "./classify";
import { fieldsFromNewerMessages, findTarget, loadContextMessages, loadOpenRecords, type Target } from "./context";
import { decide, planMatchKey, type Decision, type Plan, type Thresholds } from "./decide";
import { PipelineError, safeErrorMessage } from "./errors";
import { executeDecision, type MatchableEvent } from "./execute";
import { extractRules, fieldRole, genericEntities, type ExtractEnv } from "./extract";
import { buildResult, entitiesFrom, failedResult } from "./result";
import { eligibleCollections, keywordHit, routeCollections, type Route } from "./route";
import { defaultCountryFor, localDateTime, wallClock } from "./text";
import type { Candidate, ContextMessage, PipelineMessage } from "./types";
import { verifyAiValue, type EvidenceSource } from "./verify-evidence";

/** Event statuses whose stored result is returned as-is unless re-processing is forced. */
const FINAL_STATUSES = new Set<EventRow["status"]>(["processed", "needs_review", "skipped", "duplicate"]);
/** A "processing" event older than this is considered abandoned (crashed worker) and can be re-claimed. */
const STALE_LOCK_MS = 10 * 60_000;
/** Retryable AI errors are retried by the job queue up to this many attempts, then rules take over. */
const AI_RETRY_ATTEMPTS = 3;
/** Assist mode calls the AI when the rules are less sure than this. */
const ASSIST_CONFIDENCE = 0.75;
/** Rule 18: chit-chat/spam this certain is skipped before any AI call. */
const SKIP_CONFIDENCE = 0.85;

/* ------------------------------ Helpers ------------------------------ */

class Steps {
  list: ProcessingStep[] = [];
  async run<T>(name: string, fn: () => Promise<T> | T, note?: (r: T) => string | undefined): Promise<T> {
    const t = performance.now();
    try {
      const r = await fn();
      const n = note?.(r);
      this.list.push({ name, status: "ok", ms: Math.round(performance.now() - t), ...(n ? { note: n } : {}) });
      return r;
    } catch (e) {
      this.list.push({ name, status: "failed", ms: Math.round(performance.now() - t) });
      throw e;
    }
  }
  skip(name: string, note?: string) {
    this.list.push({ name, status: "skipped", ms: 0, ...(note ? { note } : {}) });
  }
}

export function settingsOf(raw: Partial<WorkspaceSettings> | null | undefined): WorkspaceSettings {
  return { ...defaultWorkspaceSettings, ...(raw ?? {}) };
}

export function thresholdsOf(s: WorkspaceSettings): Thresholds {
  const clamp = (n: unknown, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d);
  const autoApply = clamp(s.autoApplyThreshold, defaultWorkspaceSettings.autoApplyThreshold);
  return { autoApply, review: Math.min(autoApply, clamp(s.reviewThreshold, defaultWorkspaceSettings.reviewThreshold)) };
}

const asSource = (s: string | null | undefined): Source => (SOURCES as readonly string[]).includes(s ?? "") ? (s as Source) : "api";

/* ------------------------------ Analysis ----------------------------- */

type Analysis = {
  skipped: string | null;
  classification: MessageClassification;
  rules: RulesClassification;
  aiUsed: boolean;
  model: string | null;
  plans: Plan[];
  generic: ExtractedEntity[];
  warnings: ProcessingWarning[];
  suggestions: Suggestion[];
  context: ContextMessage[];
};

type AnalyzeArgs = {
  db: Database;
  message: PipelineMessage;
  settings: WorkspaceSettings;
  source: Source;
  steps: Steps;
  attempts: number;
  allowAiRetry: boolean;
  /** Playground: analyse for exactly these collections. */
  forcedCollections: CollectionRow[] | null;
  now: Date;
};

const toClassification = (r: RulesClassification): MessageClassification => ({ category: r.category, intent: r.intent, priority: r.priority, confidence: r.confidence, method: "rules" });

/** Steps 2-8: everything up to the per-collection decision. Reads only. */
async function analyze(a: AnalyzeArgs): Promise<Analysis> {
  const { db, message: msg, settings, steps } = a;
  const tz = settings.timezone || "UTC";
  const defaultCountry = defaultCountryFor(settings.currency);
  const th = thresholdsOf(settings);
  const warnings: ProcessingWarning[] = [];
  const suggestions: Suggestion[] = [];
  const empty = (skipped: string, rules: RulesClassification, context: ContextMessage[] = []): Analysis => ({
    skipped,
    classification: toClassification(rules),
    rules,
    aiUsed: false,
    model: null,
    plans: [],
    generic: [],
    warnings,
    suggestions,
    context,
  });

  // 2. Validate.
  const invalid =
    msg.kind === "deleted" || msg.kind === "system" ? `${msg.kind} message` : !msg.text.trim() && !msg.attachments.length && !["contact", "location"].includes(msg.kind) ? "empty message" : null;
  if (invalid) {
    steps.list.push({ name: "validate", status: "ok", ms: 0, note: `skipped: ${invalid}` });
    return empty(invalid, { category: "general", intent: "unknown", priority: "low", confidence: 1, signals: [invalid] });
  }
  steps.list.push({ name: "validate", status: "ok", ms: 0 });

  // 3. Rules classification.
  const rules = await steps.run(
    "classify",
    () => classifyRules({ text: msg.text, kind: msg.kind, direction: msg.direction, attachments: msg.attachments }),
    (r) => `${r.category}/${r.intent} (${r.confidence}) [${r.signals.join(", ")}]`,
  );

  const all = a.forcedCollections ?? (await db.select().from(collections).where(and(eq(collections.workspaceId, msg.workspaceId), isNull(collections.archivedAt))));
  const eligible = a.forcedCollections ?? eligibleCollections(all, msg.channelId);

  // Rule 18: confident chit-chat / spam stops here (no AI call) unless a collection asked for its keywords.
  if ((rules.category === "spam" || rules.intent === "greeting" || rules.intent === "acknowledgement") && rules.confidence >= SKIP_CONFIDENCE && !a.forcedCollections && !eligible.some((c) => keywordHit(c, msg.text))) {
    steps.skip("route", rules.category === "spam" ? "spam" : "chit-chat");
    return empty(rules.category === "spam" ? "spam" : rules.intent, rules);
  }

  const aiPossible = aiConfigured() && settings.aiMode !== "off" && eligible.length > 0;
  const context = (aiPossible || rules.category === "payment") && msg.conversationId ? await steps.run("context", () => loadContextMessages(db, msg), (c) => `${c.length} earlier message(s)`) : [];

  const env = (category: Category): ExtractEnv => ({ message: msg, context, timezone: tz, defaultCountry, category });
  const routeFor = (category: Category) => routeCollections(eligible, { category, text: msg.text, outbound: msg.direction === "outbound", forced: Boolean(a.forcedCollections) });
  const extractFor = (routes: Route[], category: Category) => new Map(routes.map((r) => [r.collection.id, extractRules(r.collection, env(category), { updateOnly: r.updateOnly })]));

  let classification = toClassification(rules);
  let routes = routeFor(rules.category);
  let rulesCands = extractFor(routes, rules.category);

  // 4. AI — "full": every relevant message; "assist": only when the rules are unsure
  // (low classification confidence, or a required field the rules couldn't fill).
  const gap = routes.some((r) => !r.updateOnly && r.collection.fields.some((f) => f.required && !(rulesCands.get(r.collection.id) ?? []).some((c) => c.field.key === f.key && c.confidence >= th.autoApply)));
  const wantAi = aiPossible && (settings.aiMode === "full" || (settings.aiMode === "assist" && (rules.confidence < ASSIST_CONFIDENCE || gap)));
  let ai: PipelineAiOutput | null = null;
  const refs = new Map<string, CollectionRow>();
  if (wantAi) {
    const aiCollections = eligible.slice(0, 12);
    aiCollections.forEach((c, i) => refs.set(`c${i + 1}`, c));
    try {
      ai = await steps.run(
        "ai",
        async () => {
          const open = msg.contactId || msg.conversationId ? await loadOpenRecords(db, { workspaceId: msg.workspaceId, collections: aiCollections, contactId: msg.contactId, conversationId: msg.conversationId, now: a.now }) : [];
          const refOf = new Map([...refs].map(([ref, c]) => [c.id, ref]));
          return runPipelineAi({
            workspaceId: msg.workspaceId,
            currency: settings.currency,
            timezone: tz,
            redact: settings.redactPII,
            message: {
              text: msg.text,
              senderName: msg.direction === "outbound" ? msg.senderName || "Business" : msg.senderName,
              direction: msg.direction,
              sentAtLocal: localDateTime(msg.sentAt, tz),
              kind: msg.kind,
              attachments: msg.attachments.map((x) => x.name).slice(0, 10),
              source: a.source,
            },
            context: context.map((m) => ({ text: m.text, senderName: m.senderName, direction: m.direction, sentAtLocal: localDateTime(m.sentAt, tz) })),
            collections: [...refs].map(([ref, c]) => ({ ref, name: c.name, description: c.description, fields: c.fields.slice(0, 25) })),
            openRecords: open.map((o) => ({ collectionRef: refOf.get(o.collectionId) ?? "", values: o.values })).filter((o) => o.collectionRef),
          });
        },
        (o) => o.model,
      );
    } catch (e) {
      const retryable = e instanceof AiError && e.retryable;
      if (retryable && a.allowAiRetry && a.attempts < AI_RETRY_ATTEMPTS) throw e;
      warnings.push({ code: "ai_unavailable", message: "AI processing was unavailable for this message; results come from the rules engine only." });
      log("warn", "pipeline_ai_unavailable", { workspaceId: msg.workspaceId, eventId: msg.eventId, status: e instanceof AiError ? e.status : null, retryable, error: e instanceof Error ? e.name : "unknown" });
    }
  } else {
    steps.skip("ai", settings.aiMode === "off" ? "AI mode is off" : !aiConfigured() ? "AI not configured" : !eligible.length ? "no collections" : "rules were confident");
  }

  if (ai) {
    if (ai.classification.confidence >= 0.5) {
      classification = {
        category: ai.classification.category,
        intent: ai.classification.intent,
        // Explicit urgency words found by the rules are kept.
        priority: rules.priority === "urgent" ? "urgent" : ai.classification.priority,
        confidence: ai.classification.confidence,
        method: "ai",
      };
      if (classification.category !== rules.category) {
        routes = routeFor(classification.category);
        rulesCands = extractFor(routes, classification.category);
      }
    }
    for (const s of ai.suggestions) suggestions.push({ type: s.type, text: s.text });
  }

  if (classification.category === "spam" && !a.forcedCollections) {
    steps.skip("route", "spam");
    return { ...empty("spam", rules, context), classification, aiUsed: Boolean(ai), model: ai?.model ?? null };
  }

  // 5-8. Route, merge AI values (verified), normalise.
  const sources: EvidenceSource[] = [{ ref: "m0", messageId: msg.id, text: msg.text }, ...context.map((m, i) => ({ ref: `m${context.length - i}`, messageId: m.id, text: m.text }))];
  const refDate = wallClock(msg.sentAt, tz);
  const knownNames = [msg.senderName, msg.contact?.displayName ?? "", msg.conversationTitle].filter(Boolean);
  const refByCollection = new Map([...refs].map(([ref, c]) => [c.id, ref]));
  const plans = await steps.run(
    "extract",
    () =>
      routes.map((r): Plan => {
        let cands = normalizeCandidates(r.collection, rulesCands.get(r.collection.id) ?? [], { refDate, defaultCountry }, warnings);
        const ref = refByCollection.get(r.collection.id);
        if (ai && ref) cands = mergeCandidates(cands, aiCandidates(r, ref, ai, { sources, refDate, defaultCountry, knownNames, rules: cands }, warnings, suggestions));
        return { collection: r.collection, candidates: cands, updateOnly: r.updateOnly, via: r.via };
      }),
    (p) => `${p.length} collection(s): ${p.map((x) => `${x.collection.name}${x.updateOnly ? " (update only)" : ""}`).join(", ") || "none"}`,
  );

  const generic = genericEntities(env(classification.category));
  return { skipped: null, classification, rules, aiUsed: Boolean(ai), model: ai?.model ?? null, plans, generic, warnings, suggestions, context };
}

/** AI values for one collection, each checked against the conversation (rules 1-3). */
function aiCandidates(
  route: Route,
  ref: string,
  ai: PipelineAiOutput,
  ctx: { sources: EvidenceSource[]; refDate: Date; defaultCountry?: string; knownNames: string[]; rules: Candidate[] },
  warnings: ProcessingWarning[],
  suggestions: Suggestion[],
): Candidate[] {
  const c = route.collection;
  const out: Candidate[] = [];
  for (const e of ai.entities) {
    if (e.collectionRef !== ref || e.value === null) continue;
    const field = c.fields.find((f) => f.key === e.field);
    if (!field) continue;
    const role = fieldRole(c, field);
    if (route.updateOnly && role !== "status" && role !== "activity_date") continue;
    if (["file", "file_type", "chat", "image", "none", "activity_date", "created_date"].includes(role)) continue; // metadata-only fields
    const rule = ctx.rules.find((x) => x.field.key === field.key);
    if (!e.evidence && rule?.method === "metadata" && sameValue(normalizeValue(field, e.value, { refDate: ctx.refDate, defaultCountry: ctx.defaultCountry }).value, rule.value)) continue; // agrees with metadata
    const v = verifyAiValue({ field, role, raw: e.value, evidence: e.evidence, messageRef: e.messageRef, sources: ctx.sources, refDate: ctx.refDate, defaultCountry: ctx.defaultCountry, knownNames: ctx.knownNames });
    if (v.ok) {
      out.push({ field, role, value: v.value, confidence: e.confidence, evidence: v.evidence, method: "ai", messageId: v.messageId });
      continue;
    }
    warnings.push({ code: v.code, field: field.key, message: `${c.name} › ${field.label}: AI value not used — ${v.reason}.` });
    suggestions.push({
      type: "field_value",
      text: `AI suggested ${field.label}: ${String(v.value)} — not verified against the message, so it was not applied.`,
      field: field.key,
      value: v.value,
      confidence: e.confidence,
      collection_id: c.id,
    });
  }
  return out;
}

/** AI wins only where the rules found nothing (or only a default) or AI is more confident — and verified. */
function mergeCandidates(rules: Candidate[], ai: Candidate[]): Candidate[] {
  const byKey = new Map(rules.map((c) => [c.field.key, c]));
  for (const a of ai) {
    const r = byKey.get(a.field.key);
    if (!r || r.isDefault) byKey.set(a.field.key, a);
    else if (sameValue(r.value, a.value)) continue;
    else if (a.confidence > r.confidence) byKey.set(a.field.key, a);
  }
  return [...byKey.values()];
}

/** Step 8: deterministic normalisation (rule 15); invalid → dropped with a warning (rule 12). */
function normalizeCandidates(c: CollectionRow, cands: Candidate[], opts: { refDate: Date; defaultCountry?: string }, warnings: ProcessingWarning[]): Candidate[] {
  const out: Candidate[] = [];
  for (const cand of cands) {
    const n = normalizeValue(cand.field, cand.value, opts);
    if (n.value === null) {
      warnings.push({ code: "invalid_value", field: cand.field.key, message: `${c.name} › ${n.warning ?? `${cand.field.label}: invalid value`}` });
      continue;
    }
    out.push({ ...cand, value: n.value });
  }
  return out;
}

/* ------------------------------- Load -------------------------------- */

type Loaded = { message: PipelineMessage; settings: WorkspaceSettings };

async function loadForEvent(db: Database, ev: EventRow): Promise<Loaded> {
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, ev.workspaceId)).limit(1);
  if (!ws) throw new PipelineError("Workspace not found.", "workspace_not_found");
  const [row] = await db
    .select({ m: messages, conv: conversations, ch: { id: channels.id, type: channels.type } })
    .from(messages)
    .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.workspaceId, ev.workspaceId)))
    .innerJoin(channels, and(eq(channels.id, messages.channelId), eq(channels.workspaceId, ev.workspaceId)))
    .where(and(eq(messages.id, ev.messageId), eq(messages.workspaceId, ev.workspaceId)))
    .limit(1);
  if (!row) throw new PipelineError("The message for this event no longer exists.", "message_not_found");
  const { m, conv, ch } = row;
  const contactId = m.contactId ?? conv.contactId ?? null;
  const [ct] = contactId
    ? await db
        .select({ displayName: contacts.displayName, phone: contacts.phone, email: contacts.email })
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, ev.workspaceId)))
        .limit(1)
    : [];
  return {
    settings: settingsOf(ws.settings),
    message: {
      id: m.id,
      externalId: m.externalId,
      eventId: ev.id,
      workspaceId: ev.workspaceId,
      text: openText(m.text),
      kind: m.kind,
      direction: m.direction,
      senderName: m.senderName ?? "",
      senderHandle: m.senderHandle,
      attachments: m.attachments ?? [],
      sentAt: m.sentAt,
      channelId: ch.id,
      channelType: ch.type,
      conversationId: conv.id,
      conversationTitle: conv.title,
      isGroup: conv.isGroup,
      contactId: ct ? contactId : null,
      contact: ct ?? null,
    },
  };
}

/* ------------------------------ Live run ----------------------------- */

/** Runs steps 1-11 for one event and returns the stored result. */
export async function processEvent(eventId: string, opts: { force?: boolean; noAiRetry?: boolean } = {}): Promise<ProcessingResult> {
  const db = await getDb();
  const t0 = Date.now();
  const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!ev) throw new PipelineError("Event not found.", "event_not_found");
  // Minimal duplicate processing: a finished event returns its stored result.
  if (!opts.force && ev.result && FINAL_STATUSES.has(ev.status)) return ev.result;

  // Claim atomically so concurrent workers never process the same event twice.
  const claimed = await db
    .update(events)
    .set({ status: "processing", attempts: sql`${events.attempts} + 1`, startedAt: new Date(), error: null })
    .where(and(eq(events.id, ev.id), or(ne(events.status, "processing"), isNull(events.startedAt), lt(events.startedAt, new Date(Date.now() - STALE_LOCK_MS)))))
    .returning();
  const claim = claimed[0];
  if (!claim) throw new PipelineError("This event is already being processed.", "busy", true);

  const steps = new Steps();
  try {
    return await runLive(db, claim, ev, steps, opts, t0);
  } catch (e) {
    await recordFailure(db, claim, ev, e, Date.now() - t0, steps).catch((err) =>
      log("error", "pipeline_failure_not_recorded", { eventId: ev.id, workspaceId: ev.workspaceId, error: err instanceof Error ? err.name : "unknown" }),
    );
    throw e;
  }
}

async function recordFailure(db: Database, claim: EventRow, before: EventRow, e: unknown, durationMs: number, steps: Steps) {
  const message = safeErrorMessage(e);
  const result = before.result && before.status !== "failed" ? before.result : failedResult({ eventId: claim.id, source: claim.source, message, durationMs, steps: steps.list });
  await db.update(events).set({ status: "failed", error: message, durationMs, result }).where(eq(events.id, claim.id));
  await db
    .update(messages)
    .set({ status: "failed", eventId: claim.id })
    .where(and(eq(messages.id, claim.messageId), eq(messages.workspaceId, claim.workspaceId)));
  log(e instanceof PipelineError && !e.retryable ? "warn" : "error", "event_failed", {
    eventId: claim.id,
    workspaceId: claim.workspaceId,
    attempt: claim.attempts,
    code: e instanceof PipelineError ? e.code : e instanceof AiError ? `ai_${e.status}` : e instanceof Error ? e.name : "unknown",
    message,
  });
}

async function runLive(db: Database, ev: EventRow, before: EventRow, steps: Steps, opts: { noAiRetry?: boolean }, t0: number): Promise<ProcessingResult> {
  const { message: msg, settings } = await steps.run("load", () => loadForEvent(db, ev));
  await db
    .update(messages)
    .set({ status: "processing", eventId: ev.id })
    .where(and(eq(messages.id, ev.messageId), eq(messages.workspaceId, ev.workspaceId)));

  const now = new Date();
  const analysis = await analyze({ db, message: msg, settings, source: ev.source, steps, attempts: ev.attempts, allowAiRetry: !opts.noAiRetry, forcedCollections: null, now });
  const th = thresholdsOf(settings);
  const tz = settings.timezone || "UTC";
  const owner = { contactId: msg.contactId, conversationId: msg.conversationId };
  const classification = analysis.classification;

  const result = await db.transaction(async (tx) => {
    const operations: RecordOperation[] = [];
    const reviewItemIds: string[] = [];
    const emitted: MatchableEvent[] = [];
    const warnings = [...analysis.warnings];
    const suggestions = [...analysis.suggestions];
    let created = 0;
    let updated = 0;

    if (!analysis.skipped && analysis.plans.length) {
      await steps.run(
        "execute",
        async () => {
          for (const plan of analysis.plans) {
            const target = await findTarget(tx, {
              workspaceId: msg.workspaceId,
              collection: plan.collection,
              eventId: ev.id,
              matchKey: planMatchKey(plan, th, owner),
              ...owner,
              sentAt: msg.sentAt,
              now,
            });
            const newerFields = target.kind === "live" ? await fieldsFromNewerMessages(tx, msg.workspaceId, target.record, msg.sentAt, msg.id) : undefined;
            const decision = decide(plan, target, th, { newerFields });
            warnings.push(...decision.warnings);
            suggestions.push(...decision.suggestions);
            const out = await executeDecision(
              {
                tx,
                workspaceId: msg.workspaceId,
                message: msg,
                actor: PIPELINE_ACTOR,
                thresholds: th,
                defaultCountry: defaultCountryFor(settings.currency),
                refDate: wallClock(msg.sentAt, tz),
                classification: { category: classification.category, priority: classification.priority, intent: classification.intent },
              },
              plan,
              decision,
            );
            operations.push(out.op);
            reviewItemIds.push(...out.reviewItemIds);
            emitted.push(...out.events);
            warnings.push(...out.warnings);
            created += out.created;
            updated += out.updated;
          }
        },
        () => `${operations.filter((o) => o.action !== "NO_OP").length} write(s), ${reviewItemIds.length} review item(s)`,
      );
      const written = operations.filter((o) => o.action === "CREATE_RECORD" || o.action === "UPDATE_RECORD");
      steps.list.push({ name: "verify", status: written.every((o) => o.verified) ? "ok" : "failed", ms: 0, note: `${written.filter((o) => o.verified).length}/${written.length} write(s) read back and matched` });
    } else {
      steps.skip("execute", analysis.skipped ?? "no collection matched");
    }

    const requiresReview = reviewItemIds.length > 0 || operations.some((o) => o.status === "failed" || o.status === "needs_review");
    const skipped = Boolean(analysis.skipped) || (!operations.some((o) => o.action !== "NO_OP") && (classification.intent === "greeting" || classification.intent === "acknowledgement"));
    const status: ProcessingResult["status"] = skipped && !requiresReview ? "skipped" : requiresReview ? "needs_review" : "processed";

    if (status !== "skipped") {
      const mp: MatchableEvent = {
        type: "message.processed",
        workspaceId: msg.workspaceId,
        actor: PIPELINE_ACTOR,
        data: { messageId: msg.id ?? undefined, eventId: ev.id, category: classification.category, priority: classification.priority, intent: classification.intent },
      };
      // Fired once per message: re-processing only emits record.* events for real changes.
      if (!before.processedAt) {
        await emitDomainEvent(tx, mp);
        emitted.push(mp);
      }
    }

    const automation = await matchAll(tx, emitted);
    const usedContext = new Set(analysis.plans.flatMap((p) => p.candidates.map((c) => c.messageId)).filter((id): id is string => Boolean(id) && id !== msg.id));
    const sourceReferences: SourceReference[] = [
      { message_id: msg.id!, external_id: msg.externalId ?? "", conversation_id: msg.conversationId ?? "", channel_id: msg.channelId ?? "", sent_at: msg.sentAt.toISOString() },
      ...analysis.context
        .filter((m) => usedContext.has(m.id))
        .map((m) => ({ message_id: m.id, external_id: m.externalId, conversation_id: m.conversationId, channel_id: m.channelId, sent_at: m.sentAt.toISOString() })),
    ];
    const processedAt = new Date();
    const res = buildResult({
      eventId: ev.id,
      status,
      source: ev.source,
      classification,
      entities: entitiesFrom(analysis.plans, analysis.generic),
      operations,
      automation,
      suggestions,
      warnings,
      reviewItemIds: [...new Set(reviewItemIds)],
      requiresReview,
      sourceReferences,
      processedAt,
      model: analysis.model,
      durationMs: Date.now() - t0,
      aiUsed: analysis.aiUsed,
      steps: steps.list,
    });

    // Persist the outcome with the writes (verification + audit happen in the same commit).
    await tx.update(events).set({ status, result: res, error: null, model: analysis.model, durationMs: res.processing_metadata.duration_ms, processedAt }).where(eq(events.id, ev.id));
    await tx
      .update(messages)
      .set({ status, classification, eventId: ev.id })
      .where(and(eq(messages.id, ev.messageId), eq(messages.workspaceId, ev.workspaceId)));
    if (operations.some((o) => o.action !== "NO_OP") || reviewItemIds.length) {
      await writeAudit(tx, {
        workspaceId: msg.workspaceId,
        actor: PIPELINE_ACTOR,
        action: "event.process",
        targetType: "event",
        targetId: ev.id,
        after: { status, category: classification.category, intent: classification.intent, priority: classification.priority },
        meta: {
          messageId: msg.id,
          attempt: ev.attempts,
          operations: operations.map((o) => ({ action: o.action, collectionId: o.collection_id, recordId: o.record_id, status: o.status, verified: o.verified })),
          reviewItemIds: res.review_item_ids,
          aiUsed: analysis.aiUsed,
          model: analysis.model,
          pipelineVersion: res.processing_metadata.pipeline_version,
          sources: sourceReferences.map((s) => ({ messageId: s.message_id, eventId: ev.id })),
        },
      });
    }
    await bumpUsage(msg.workspaceId, { events_processed: 1, records_created: created, records_updated: updated }, tx);
    return res;
  });

  log("info", "event_processed", {
    eventId: ev.id,
    workspaceId: ev.workspaceId,
    status: result.status,
    category: result.message_classification.category,
    operations: result.record_operations.filter((o) => o.action !== "NO_OP").length,
    reviews: result.review_item_ids.length,
    ai: result.processing_metadata.ai_used,
    ms: result.processing_metadata.duration_ms,
  });
  return result;
}

/** Automations that will run for the emitted events (listed as "queued"; the domain_event job runs them). */
async function matchAll(db: Database, emitted: MatchableEvent[]): Promise<AutomationOutcome[]> {
  const out = new Map<string, AutomationOutcome>();
  for (const e of emitted) {
    for (const m of await matchAutomations(db, e)) {
      if (!out.has(m.id)) out.set(m.id, { automation_id: m.id, name: m.name, status: "queued", actions: m.actions });
    }
  }
  return [...out.values()];
}

/* ------------------------------ Dry run ------------------------------ */

/** Playground: full classification/extraction/decision without writing anything. */
export async function dryRunProcess(
  db: Database,
  workspaceId: string,
  input: { text: string; senderName?: string | null; senderPhone?: string | null; source?: string | null; collectionIds?: string[] | null },
): Promise<ProcessingResult> {
  const t0 = Date.now();
  const steps = new Steps();
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) throw notFound("Workspace");
  const settings = settingsOf(ws.settings);
  const th = thresholdsOf(settings);
  const defaultCountry = defaultCountryFor(settings.currency);

  let forced: CollectionRow[] | null = null;
  if (input.collectionIds?.length) {
    const ids = [...new Set(input.collectionIds)];
    const rows = await db.select().from(collections).where(and(eq(collections.workspaceId, workspaceId), isNull(collections.archivedAt)));
    forced = rows.filter((r) => ids.includes(r.id));
    if (forced.length !== ids.length) throw notFound("Collection");
  }

  // An existing contact with this phone makes the dry run show the record it would update.
  const phone = input.senderPhone ? normalizePhone(input.senderPhone, defaultCountry) : null;
  const [ct] = phone
    ? await db
        .select({ id: contacts.id, displayName: contacts.displayName, phone: contacts.phone, email: contacts.email })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.phone, phone)))
        .limit(1)
    : [];
  const senderName = input.senderName?.trim() || ct?.displayName || "";
  const message: PipelineMessage = {
    id: null,
    externalId: null,
    eventId: null,
    workspaceId,
    text: input.text,
    kind: "text",
    direction: "inbound",
    senderName,
    senderHandle: phone,
    attachments: [],
    sentAt: new Date(),
    channelId: null,
    channelType: null,
    conversationId: null,
    conversationTitle: senderName,
    isGroup: false,
    contactId: ct?.id ?? null,
    contact: ct ? { displayName: ct.displayName, phone: ct.phone, email: ct.email } : phone ? { displayName: senderName, phone, email: null } : null,
  };
  const now = new Date();
  const analysis = await analyze({ db, message, settings, source: asSource(input.source), steps, attempts: 1, allowAiRetry: false, forcedCollections: forced, now });

  const operations: RecordOperation[] = [];
  const warnings = [...analysis.warnings];
  const suggestions = [...analysis.suggestions];
  let heldForReview = false;
  if (!analysis.skipped) {
    await steps.run("decide", async () => {
      for (const plan of analysis.plans) {
        const target: Target = await findTarget(db, { workspaceId, collection: plan.collection, eventId: null, matchKey: planMatchKey(plan, th, message), contactId: message.contactId, conversationId: null, sentAt: message.sentAt, now });
        const d = decide(plan, target, th);
        warnings.push(...d.warnings);
        suggestions.push(...d.suggestions);
        operations.push(pendingOperation(plan, d));
        heldForReview ||= d.action === "PENDING_REVIEW" || d.hold.length > 0;
      }
    });
  }
  const requiresReview = heldForReview || operations.some((o) => o.conflicts.length > 0);
  const skipped = Boolean(analysis.skipped) || (!operations.some((o) => o.action !== "NO_OP") && (analysis.classification.intent === "greeting" || analysis.classification.intent === "acknowledgement"));
  return buildResult({
    eventId: "",
    status: skipped && !requiresReview ? "skipped" : requiresReview ? "needs_review" : "processed",
    source: asSource(input.source),
    classification: analysis.classification,
    entities: entitiesFrom(analysis.plans, analysis.generic),
    operations,
    automation: [],
    suggestions,
    warnings,
    reviewItemIds: [],
    requiresReview,
    sourceReferences: [],
    processedAt: null,
    model: analysis.model,
    durationMs: Date.now() - t0,
    aiUsed: analysis.aiUsed,
    steps: steps.list,
  });
}

/** What the live run would do, as a not-yet-executed operation. */
function pendingOperation(plan: Plan, d: Decision): RecordOperation {
  const base = { collection: plan.collection.name, collection_id: plan.collection.id, verified: false, review_item_id: null };
  const live = d.target.kind === "live" ? d.target.record : null;
  switch (d.action) {
    case "NO_OP":
      return { ...base, action: "NO_OP", record_id: d.target.kind === "none" ? null : d.target.record.id, status: "skipped", changes: [], conflicts: [] };
    case "PENDING_REVIEW":
      return {
        ...base,
        action: "PENDING_REVIEW",
        record_id: live?.id ?? null,
        status: "needs_review",
        changes: (live ? d.hold : d.apply).map((c) => ({ field: c.field.key, from: live?.values[c.field.key] ?? null, to: c.value })),
        conflicts: [],
      };
    case "CREATE_RECORD":
      return { ...base, action: "CREATE_RECORD", record_id: null, status: "pending", changes: d.apply.map((c) => ({ field: c.field.key, from: null, to: c.value })), conflicts: [] };
    case "UPDATE_RECORD": {
      const rec = live!;
      const changes = [];
      const conflicts = [];
      for (const c of d.apply) {
        const from = rec.values[c.field.key] ?? null;
        if (sameValue(from, c.value)) continue;
        const meta = rec.fieldMeta[c.field.key];
        if (meta?.edited) conflicts.push({ field: c.field.key, existing: from, proposed: c.value, reason: "human_edited" as const });
        else changes.push({ field: c.field.key, from, to: c.value });
      }
      return { ...base, action: "UPDATE_RECORD", record_id: rec.id, status: "pending", changes, conflicts };
    }
  }
}
