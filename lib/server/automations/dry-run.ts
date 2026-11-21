/**
 * Dry run of one automation (POST /api/v1/automations/:id/test): evaluates the trigger
 * and every condition against a sample record or message of the workspace and reports
 * which actions would run. Read-only — nothing is written, sent or queued.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { DOMAIN_EVENT_TYPES, type Actor, type AutomationAction, type DomainEvent, type DomainEventType } from "@/lib/shared/types";
import type { Database } from "../db";
import { messages, records, recordSources, workspaces, type AutomationRow } from "../db/schema";
import { notFound } from "../api/handler";
import { normalizeValue, sameValue } from "../records/coerce";
import { automationActor, checkAction, settingsOf } from "./actions";
import type { ConditionResult } from "./conditions";
import { EventSubject, evaluateAutomation } from "./match";

export type DryRunResult = {
  matched: boolean;
  triggerMatched: boolean;
  triggerReason: string | null;
  conditionResults: ConditionResult[];
  actions: { type: AutomationAction["type"]; wouldRun: boolean; reason?: string }[];
  /** The sample the automation was evaluated against. */
  sample: { eventType: string; recordId: string | null; messageId: string | null };
};

const isDomainType = (t: string): t is DomainEventType => (DOMAIN_EVENT_TYPES as readonly string[]).includes(t);

export async function dryRunAutomation(db: Database, workspaceId: string, automation: AutomationRow, input: { recordId?: string; messageId?: string }, by: Actor): Promise<DryRunResult> {
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) throw notFound("Workspace");
  const settings = settingsOf(ws.settings);
  const trigger = automation.trigger;

  const data: DomainEvent["data"] = {};
  if (input.recordId) {
    const [rec] = await db
      .select({ id: records.id, collectionId: records.collectionId, values: records.values, status: records.status })
      .from(records)
      .where(and(eq(records.id, input.recordId), eq(records.workspaceId, workspaceId)))
      .limit(1);
    if (!rec) throw notFound("Record");
    const [src] = await db
      .select({ messageId: recordSources.messageId })
      .from(recordSources)
      .where(and(eq(recordSources.recordId, rec.id), eq(recordSources.workspaceId, workspaceId), isNotNull(recordSources.messageId)))
      .orderBy(desc(recordSources.createdAt))
      .limit(1);
    Object.assign(data, { recordId: rec.id, collectionId: rec.collectionId, values: rec.values, toStatus: rec.status, fromStatus: null }, src?.messageId ? { messageId: src.messageId } : {});
  }
  if (input.messageId) {
    const [msg] = await db
      .select({ id: messages.id, eventId: messages.eventId })
      .from(messages)
      .where(and(eq(messages.id, input.messageId), eq(messages.workspaceId, workspaceId)))
      .limit(1);
    if (!msg) throw notFound("Message");
    data.messageId = msg.id;
    if (msg.eventId) data.eventId = msg.eventId;
  }

  const eventType: DomainEventType = isDomainType(trigger.type) ? trigger.type : input.recordId ? "record.updated" : "message.processed";
  const subject = trigger.type === "schedule.daily" ? null : new EventSubject({ type: eventType, workspaceId, actor: by, data });

  let triggerMatched: boolean;
  let triggerReason: string | null;
  let conditionResults: ConditionResult[] = [];
  if (!subject) {
    triggerMatched = true;
    triggerReason = `Runs every day at ${String(trigger.hour ?? 0).padStart(2, "0")}:00 (${settings.timezone}).`;
  } else {
    const ev = await evaluateAutomation(db, automation, subject, { explain: true });
    triggerMatched = ev.triggerPass;
    triggerReason = ev.triggerReason;
    conditionResults = ev.results;
  }
  const matched = triggerMatched && conditionResults.every((r) => r.pass);

  const env = { db, workspaceId, settings, automation, actor: automationActor(automation), trigger: { id: "dry_run", type: subject ? eventType : "schedule.daily", at: new Date().toISOString(), data }, subject };
  const actions: DryRunResult["actions"] = [];
  for (const action of automation.actions) {
    const check = await checkAction(env, action);
    let reason: string | undefined = check.ok ? undefined : check.reason;
    // Automations never overwrite a value a person edited (record ops would report a conflict).
    if (check.ok && action.type === "set_field" && subject && check.field && !(typeof action.value === "string" && action.value.includes("{{"))) {
      const rec = await subject.record(db);
      const meta = rec?.fieldMeta[action.key];
      const next = normalizeValue(check.field, action.value).value;
      if (rec && meta?.edited && !sameValue(rec.values[action.key], next)) reason = `“${check.field.label}” was edited by a person; automations never overwrite manual edits.`;
    }
    if (!reason && !matched) reason = triggerMatched ? "The conditions don't match this sample." : "The trigger doesn't match this sample.";
    actions.push({ type: action.type, wouldRun: !reason, ...(reason ? { reason } : {}) });
  }

  return { matched, triggerMatched, triggerReason, conditionResults, actions, sample: { eventType: env.trigger.type, recordId: data.recordId ?? null, messageId: data.messageId ?? null } };
}
