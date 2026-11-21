/**
 * Automation matching — which enabled automations fire for a domain event.
 *
 * Pure with respect to data: it only reads (automations, and — lazily, only when a
 * trigger filter or condition needs them — the event's record and message).
 *
 * Matching order:
 *  1. trigger.type === event.type (`schedule.daily` never matches a domain event);
 *  2. trigger.collectionId equals the event's collection;
 *  3. trigger.toStatus (record.status_changed) equals the new status, case-insensitively;
 *  4. trigger.categories contains the message category;
 *  5. every condition passes (AND), evaluated against the record values
 *     (`event.data.values`, or the record itself when the event carries none) and the
 *     message context (category, priority, intent, source, channel).
 *
 * Events caused by an automation never match (loop guard, see events/bus.ts).
 *
 * The `EventSubject` loaders take the connection explicitly: inside a transaction they
 * must be given the transaction (embedded Postgres serialises connections, so a query on
 * the outer pool would wait for the transaction forever).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { sourceOf, type AutomationCondition, type AutomationTrigger, type CellValue, type ChannelType, type DomainEvent, type FieldMeta, type MessageClassification } from "@/lib/shared/types";
import type { Database } from "../db";
import { automations, channels, messages, records, type AutomationRow } from "../db/schema";
import { evaluateConditions, isContextField, type ConditionContext, type ConditionResult } from "./conditions";

export type MatchableEvent = Omit<DomainEvent, "id" | "at">;

/** Upper bound of automations considered per event (= the per-workspace cap). */
const MAX_CANDIDATES = 200;

export type SubjectRecord = {
  id: string;
  collectionId: string;
  values: Record<string, CellValue>;
  fieldMeta: Record<string, FieldMeta>;
  status: string | null;
  contactId: string | null;
  conversationId: string | null;
  deletedAt: Date | null;
};

export type SubjectMessage = {
  id: string;
  contactId: string | null;
  conversationId: string;
  classification: MessageClassification | null;
  channelId: string;
  channelType: ChannelType;
};

/** Lazily loaded, memoised view of what an event is about (its record and message). */
export class EventSubject {
  private recordP: Promise<SubjectRecord | null> | undefined;
  private messageP: Promise<SubjectMessage | null> | undefined;
  private contextP = new Map<boolean, Promise<ConditionContext>>();

  constructor(readonly event: MatchableEvent) {}

  get workspaceId() {
    return this.event.workspaceId;
  }

  /** The record the event refers to (tenant-checked), or null. Deleted records are returned with `deletedAt`. */
  record(db: Database): Promise<SubjectRecord | null> {
    const id = this.event.data.recordId;
    if (!id) return Promise.resolve(null);
    this.recordP ??= db
      .select({
        id: records.id,
        collectionId: records.collectionId,
        values: records.values,
        fieldMeta: records.fieldMeta,
        status: records.status,
        contactId: records.contactId,
        conversationId: records.conversationId,
        deletedAt: records.deletedAt,
      })
      .from(records)
      .where(and(eq(records.id, id), eq(records.workspaceId, this.workspaceId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return this.recordP;
  }

  /** The message the event refers to, with its channel type (tenant-checked), or null. */
  message(db: Database): Promise<SubjectMessage | null> {
    const id = this.event.data.messageId;
    if (!id) return Promise.resolve(null);
    this.messageP ??= db
      .select({
        id: messages.id,
        contactId: messages.contactId,
        conversationId: messages.conversationId,
        classification: messages.classification,
        channelId: messages.channelId,
        channelType: channels.type,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(and(eq(messages.id, id), eq(messages.workspaceId, this.workspaceId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return this.messageP;
  }

  /** Record values: the event's snapshot, else the stored record's values. */
  async values(db: Database): Promise<Record<string, CellValue>> {
    if (this.event.data.values) return this.event.data.values;
    return (await this.record(db))?.values ?? {};
  }

  /** Contact and conversation the event is about (record first, then message). */
  async owner(db: Database): Promise<{ contactId: string | null; conversationId: string | null }> {
    const rec = await this.record(db);
    const msg = rec?.contactId && rec.conversationId ? null : await this.message(db);
    return { contactId: rec?.contactId ?? msg?.contactId ?? null, conversationId: rec?.conversationId ?? msg?.conversationId ?? null };
  }

  /** Condition context. `withMessage` loads the message for category/priority/intent/source/channel. */
  context(db: Database, withMessage: boolean): Promise<ConditionContext> {
    let p = this.contextP.get(withMessage);
    if (!p) {
      p = this.buildContext(db, withMessage);
      this.contextP.set(withMessage, p);
    }
    return p;
  }

  private async buildContext(db: Database, withMessage: boolean): Promise<ConditionContext> {
    const d = this.event.data;
    const values = await this.values(db);
    const ctx: ConditionContext = {
      values,
      category: d.category ?? null,
      priority: d.priority ?? null,
      intent: d.intent ?? null,
      source: null,
      channel: null,
      channelId: null,
    };
    if (withMessage && d.messageId) {
      const m = await this.message(db);
      if (m) {
        ctx.category ??= m.classification?.category ?? null;
        ctx.priority ??= m.classification?.priority ?? null;
        ctx.intent ??= m.classification?.intent ?? null;
        ctx.source = sourceOf[m.channelType] ?? null;
        ctx.channel = m.channelType;
        ctx.channelId = m.channelId;
      }
    }
    return ctx;
  }
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether the trigger filters or conditions read message context. */
const needsMessage = (trigger: AutomationTrigger, conditions: readonly AutomationCondition[]) => Boolean(trigger.categories?.length) || conditions.some((c) => isContextField(c.field));

export type Evaluation = {
  /** Trigger type + collection/status/category filters. */
  triggerPass: boolean;
  triggerReason: string | null;
  /** Trigger and every condition pass. */
  matched: boolean;
  results: ConditionResult[];
};

/**
 * Evaluates one automation against an event. With `explain` the conditions are evaluated
 * even when the trigger doesn't match (dry runs show every condition's outcome).
 */
export async function evaluateAutomation(
  db: Database,
  automation: Pick<AutomationRow, "trigger" | "conditions">,
  subject: EventSubject,
  opts: { explain?: boolean } = {},
): Promise<Evaluation> {
  const t = automation.trigger;
  const e = subject.event;
  const conditions = automation.conditions ?? [];
  const d = e.data;

  let triggerReason: string | null = null;
  if (t.type === "schedule.daily") triggerReason = "Daily schedules run at their hour, not on events.";
  else if (t.type !== e.type) triggerReason = `The trigger is “${t.type}” but the event is “${e.type}”.`;
  else if (t.collectionId && t.collectionId !== d.collectionId) triggerReason = "The event is about a different collection.";
  else if (t.toStatus && (e.type !== "record.status_changed" || !d.toStatus || !sameText(t.toStatus, d.toStatus))) triggerReason = `The status didn't change to “${t.toStatus}”.`;

  if (triggerReason && !opts.explain) return { triggerPass: false, triggerReason, matched: false, results: [] };

  const wantContext = Boolean(t.categories?.length) || conditions.length > 0;
  const ctx: ConditionContext = wantContext ? await subject.context(db, needsMessage(t, conditions)) : { values: {} };

  if (!triggerReason && t.categories?.length) {
    const category = ctx.category ?? null;
    if (!category || !(t.categories as string[]).includes(category)) triggerReason = "The message category isn't one of the trigger's categories.";
  }
  if (triggerReason && !opts.explain) return { triggerPass: false, triggerReason, matched: false, results: [] };

  const { pass, results } = evaluateConditions(conditions, ctx);
  return { triggerPass: !triggerReason, triggerReason, matched: !triggerReason && pass, results };
}

/** Enabled automations of the workspace whose trigger type is `type` (one indexed query). */
export async function candidateAutomations(db: Database, workspaceId: string, type: string): Promise<AutomationRow[]> {
  return db
    .select()
    .from(automations)
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.enabled, true), sql`${automations.trigger}->>'type' = ${type}`))
    .orderBy(asc(automations.createdAt), asc(automations.id))
    .limit(MAX_CANDIDATES);
}

export type Match = { automation: AutomationRow; results: ConditionResult[] };

/** Matching automations plus the (memoised) subject, so callers can reuse what was loaded. */
export async function findMatches(db: Database, event: MatchableEvent): Promise<{ subject: EventSubject; matches: Match[] }> {
  const subject = new EventSubject(event);
  if (event.actor.type === "automation") return { subject, matches: [] };
  const candidates = await candidateAutomations(db, event.workspaceId, event.type);
  const matches: Match[] = [];
  for (const automation of candidates) {
    const ev = await evaluateAutomation(db, automation, subject);
    if (ev.matched) matches.push({ automation, results: ev.results });
  }
  return { subject, matches };
}

/**
 * Enabled automations whose trigger + conditions match `event` (no side effects).
 * The pipeline uses it to list `automation` outcomes as "queued" in the
 * processing result before the domain_event job runs them.
 */
export async function matchAutomations(db: Database, event: Omit<DomainEvent, "id" | "at">): Promise<{ id: string; name: string; actions: string[] }[]> {
  const { matches } = await findMatches(db, event);
  return matches.map(({ automation }) => ({ id: automation.id, name: automation.name, actions: automation.actions.map((a) => a.type) }));
}
