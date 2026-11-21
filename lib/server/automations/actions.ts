/**
 * Running an automation: one transaction per (automation, trigger occurrence).
 *
 * The `automation_runs` row is inserted FIRST with ON CONFLICT DO NOTHING on
 * (automation_id, domain_event_id): a retried job (or a second worker) finds the row and
 * skips, so actions never run twice. Every action's side effects are database writes
 * (notifications, record ops, contact tags, queued jobs, webhook deliveries) and live in
 * the same transaction, so a crash rolls the whole run back and the retry starts clean.
 * Each action runs in a savepoint: a failing action is recorded as "failed" without
 * undoing the others.
 *
 * External effects (rule 8): `webhook` and `reply` only run when the workspace enables
 * `allowExternalActions`; automations themselves can only be created by admins.
 */
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { defaultWorkspaceSettings, type Actor, type AutomationAction, type AutomationOutcome, type CellValue, type DomainEvent, type Field, type FieldMeta, type WorkspaceSettings } from "@/lib/shared/types";
import type { Database } from "../db";
import { automationRuns, automations, collections, contacts, memberships, webhookEndpoints, type AutomationRow, type CollectionRow } from "../db/schema";
import { ApiError } from "../api/handler";
import { cleanText } from "../http";
import { newId } from "../ids";
import { enqueue } from "../jobs/queue";
import { notify } from "../notify";
import { DuplicateRecordError, createRecord, updateRecord } from "../records/ops";
import { normalizeValue } from "../records/coerce";
import { bumpUsage } from "../usage";
import { queueDelivery } from "./deliver";
import type { EventSubject } from "./match";

export const EXTERNAL_DISABLED = "External actions are turned off for this workspace (Settings → Allow external actions).";
const RECORD_WRITE_EVENTS = new Set(["record.created", "record.updated", "record.status_changed"]);
export const MAX_CONTACT_TAGS = 50;

export type ActionStatus = "ran" | "skipped" | "failed";
export type ActionOutcome = { index: number; type: AutomationAction["type"]; status: ActionStatus; reason?: string; detail?: Record<string, unknown> };

/** What triggered a run: a domain event, or a daily schedule occurrence (`subject` null). */
export type RunTrigger = { id: string; type: string; at: string; data: DomainEvent["data"] };

export type RunEnv = {
  db: Database;
  workspaceId: string;
  settings: WorkspaceSettings;
  automation: AutomationRow;
  actor: Actor;
  trigger: RunTrigger;
  subject: EventSubject | null;
  runId: string;
};

export const automationActor = (a: Pick<AutomationRow, "id" | "name">): Actor => ({ type: "automation", id: a.id, label: a.name.slice(0, 120) });

export function settingsOf(s: Partial<WorkspaceSettings> | null | undefined): WorkspaceSettings {
  return { ...defaultWorkspaceSettings, ...(s ?? {}) };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Hour (0-23) and calendar date (YYYY-MM-DD) of `now` in `timeZone` (invalid zones → UTC). */
export function localClock(now: Date, timeZone: string): { hour: number; date: string } {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    } catch {
      return { hour: now.getUTCHours(), date: now.toISOString().slice(0, 10) };
    }
    if (formatters.size > 500) formatters.clear();
    formatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: Number(get("hour")) % 24, date: `${get("year")}-${get("month")}-${get("day")}` };
}

/* ----------------------------- Placeholders ---------------------------- */

const PLACEHOLDER_G = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]{0,63})\s*\}\}/g;

export type RenderVars = { values: Record<string, CellValue>; vars: Record<string, CellValue | undefined> };

async function renderVars(env: RunEnv): Promise<RenderVars> {
  const d = env.trigger.data;
  const ctx = env.subject ? await env.subject.context(env.db, true) : null;
  return {
    values: ctx?.values ?? {},
    vars: {
      category: ctx?.category ?? d.category ?? null,
      priority: ctx?.priority ?? d.priority ?? null,
      intent: ctx?.intent ?? d.intent ?? null,
      source: ctx?.source ?? null,
      channel: ctx?.channel ?? null,
      toStatus: d.toStatus ?? null,
      fromStatus: d.fromStatus ?? null,
      event: env.trigger.type,
      "event.type": env.trigger.type,
      "automation.name": env.automation.name,
      // Calendar date in the workspace's timezone.
      date: localClock(new Date(env.trigger.at), env.settings.timezone || "UTC").date,
    },
  };
}

const show = (v: CellValue | undefined): string => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

/**
 * Replaces `{{name}}` placeholders: `values.x` / `record.x` (record values), or a bare name —
 * a record value when the record has that field, else event context (category, priority,
 * toStatus, date, …). Unknown names render as "".
 */
export function renderTemplate(text: string, r: RenderVars): string {
  if (!text.includes("{{")) return text;
  return text.replace(PLACEHOLDER_G, (_m, name: string) => {
    if (name.startsWith("values.") || name.startsWith("record.")) return show(r.values[name.slice(7)]);
    if (Object.hasOwn(r.values, name)) return show(r.values[name]);
    return Object.hasOwn(r.vars, name) ? show(r.vars[name]) : "";
  });
}

/* ------------------------------- Helpers ------------------------------- */

async function loadCollection(db: Database, workspaceId: string, id: string): Promise<CollectionRow | null> {
  const [row] = await db
    .select()
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

async function linkFor(env: RunEnv): Promise<string> {
  const d = env.trigger.data;
  if (d.recordId && d.collectionId) return `/console/collections/${d.collectionId}?record=${d.recordId}`;
  if (d.reviewItemId) return `/console/review?item=${d.reviewItemId}`;
  if (env.subject) {
    const { conversationId } = await env.subject.owner(env.db);
    if (conversationId) return `/console/inbox/${conversationId}`;
  }
  return `/console/automations/${env.automation.id}`;
}

const automationMeta = (now: string): FieldMeta => ({ source: "automation", confidence: 1, messageId: null, eventId: null, evidence: null, method: null, updatedAt: now });

type Check = { ok: true; collection?: CollectionRow; field?: Field; contactId?: string; conversationId?: string } | { ok: false; reason: string };

/**
 * Read-only precondition check for one action (also used by dry runs).
 * Never writes anything.
 */
export async function checkAction(env: Omit<RunEnv, "runId">, action: AutomationAction): Promise<Check> {
  const { db, workspaceId, trigger } = env;
  switch (action.type) {
    case "notify": {
      if (!Array.isArray(action.to)) return { ok: true };
      const ids = [...new Set(action.to)];
      const [{ n }] = await db
        .select({ n: count() })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, workspaceId), inArray(memberships.userId, ids)));
      return n > 0 ? { ok: true } : { ok: false, reason: "None of the selected people are members of this workspace any more." };
    }
    case "set_field": {
      const d = trigger.data;
      if (!RECORD_WRITE_EVENTS.has(trigger.type) || !d.recordId || !d.collectionId || !env.subject) return { ok: false, reason: "“Set field” only runs for record created / updated / status changed events." };
      const collection = await loadCollection(db, workspaceId, d.collectionId);
      if (!collection) return { ok: false, reason: "The collection no longer exists." };
      if (collection.archivedAt) return { ok: false, reason: `“${collection.name}” is archived.` };
      const field = collection.fields.find((f) => f.key === action.key);
      if (!field) return { ok: false, reason: `“${action.key}” is not a field of ${collection.name}.` };
      const record = await env.subject.record(db);
      if (!record || record.deletedAt) return { ok: false, reason: "The record no longer exists." };
      return { ok: true, collection, field };
    }
    case "create_record": {
      const collection = await loadCollection(db, workspaceId, action.collectionId);
      if (!collection) return { ok: false, reason: "The target collection no longer exists." };
      if (collection.archivedAt) return { ok: false, reason: `“${collection.name}” is archived.` };
      return { ok: true, collection };
    }
    case "add_tag": {
      const owner = env.subject ? await env.subject.owner(db) : null;
      return owner?.contactId ? { ok: true, contactId: owner.contactId } : { ok: false, reason: "There's no contact to tag for this event." };
    }
    case "reminder":
      return { ok: true };
    case "webhook": {
      if (!env.settings.allowExternalActions) return { ok: false, reason: EXTERNAL_DISABLED };
      const [ep] = await db
        .select({ id: webhookEndpoints.id, enabled: webhookEndpoints.enabled })
        .from(webhookEndpoints)
        .where(and(eq(webhookEndpoints.id, action.endpointId), eq(webhookEndpoints.workspaceId, workspaceId)))
        .limit(1);
      if (!ep) return { ok: false, reason: "The webhook endpoint no longer exists." };
      if (!ep.enabled) return { ok: false, reason: "The webhook endpoint is disabled." };
      return { ok: true };
    }
    case "reply": {
      if (!env.settings.allowExternalActions) return { ok: false, reason: EXTERNAL_DISABLED };
      const owner = env.subject ? await env.subject.owner(db) : null;
      return owner?.conversationId ? { ok: true, conversationId: owner.conversationId } : { ok: false, reason: "There's no conversation to reply to for this event." };
    }
  }
}

/** Executes one (already checked) action. Throws on unexpected errors. */
async function executeAction(env: RunEnv, action: AutomationAction, index: number, check: Extract<Check, { ok: true }>, r: RenderVars): Promise<ActionOutcome> {
  const { db, workspaceId } = env;
  const base = { index, type: action.type };
  const now = new Date();
  switch (action.type) {
    case "notify": {
      const n = await notify(db, {
        workspaceId,
        userIds: action.to,
        type: "automation",
        title: renderTemplate(action.title, r),
        body: renderTemplate(action.body ?? "", r),
        link: await linkFor(env),
      });
      return n > 0 ? { ...base, status: "ran", detail: { recipients: n } } : { ...base, status: "skipped", reason: "No one to notify." };
    }
    case "set_field": {
      const collection = check.collection!;
      const field = check.field!;
      const raw = typeof action.value === "string" ? renderTemplate(action.value, r) : action.value;
      const normalized = normalizeValue(field, raw);
      if (normalized.value === null) return { ...base, status: "skipped", reason: `The value isn't valid for “${field.label}”.` };
      const res = await updateRecord(db, {
        workspaceId,
        collection,
        recordId: env.trigger.data.recordId!,
        patch: { [field.key]: normalized.value },
        meta: { [field.key]: automationMeta(now.toISOString()) },
        mode: "machine",
        actor: env.actor,
      });
      if (res.conflicts.length) {
        const c = res.conflicts[0];
        return { ...base, status: "skipped", reason: c.reason === "human_edited" ? `“${field.label}” was edited by a person; automations never overwrite manual edits.` : `“${field.label}” has a conflicting value.` };
      }
      if (!res.changes.length) return { ...base, status: "skipped", reason: `“${field.label}” already has this value.` };
      return { ...base, status: "ran", detail: { recordId: res.record.id, field: field.key, verified: res.verified } };
    }
    case "create_record": {
      const collection = check.collection!;
      const values = Object.fromEntries(Object.entries(action.values).map(([k, v]) => [k, typeof v === "string" ? renderTemplate(v, r) : v]));
      const owner = env.subject ? await env.subject.owner(db) : { contactId: null, conversationId: null };
      const nowIso = now.toISOString();
      const fieldMeta = Object.fromEntries(Object.keys(values).map((k) => [k, automationMeta(nowIso)]));
      try {
        const res = await createRecord(db, { workspaceId, collection, values, fieldMeta, contactId: owner.contactId, conversationId: owner.conversationId, origin: "automation", actor: env.actor });
        return { ...base, status: "ran", detail: { recordId: res.record.id, collectionId: collection.id, verified: res.verified } };
      } catch (e) {
        if (e instanceof DuplicateRecordError) return { ...base, status: "skipped", reason: `A matching record already exists in ${collection.name}.`, detail: e.existingId ? { recordId: e.existingId } : undefined };
        throw e;
      }
    }
    case "add_tag": {
      const tag = cleanText(renderTemplate(action.tag, r), 40);
      if (!tag) return { ...base, status: "skipped", reason: "The tag is empty." };
      const [contact] = await db
        .select({ id: contacts.id, tags: contacts.tags })
        .from(contacts)
        .where(and(eq(contacts.id, check.contactId!), eq(contacts.workspaceId, workspaceId)))
        .for("update")
        .limit(1);
      if (!contact) return { ...base, status: "skipped", reason: "The contact no longer exists." };
      const tags = contact.tags ?? [];
      if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return { ...base, status: "skipped", reason: "The contact already has this tag." };
      if (tags.length >= MAX_CONTACT_TAGS) return { ...base, status: "skipped", reason: `The contact already has ${MAX_CONTACT_TAGS} tags.` };
      await db
        .update(contacts)
        .set({ tags: [...tags, tag], updatedAt: now })
        .where(and(eq(contacts.id, contact.id), eq(contacts.workspaceId, workspaceId)));
      return { ...base, status: "ran", detail: { contactId: contact.id, tag } };
    }
    case "reminder": {
      const runAt = new Date(now.getTime() + action.afterMinutes * 60_000);
      await enqueue(db, {
        type: "reminder",
        workspaceId,
        payload: { workspaceId, title: renderTemplate(action.title, r), body: renderTemplate(action.body ?? "", r), link: await linkFor(env), userIds: "all" },
        runAt,
        priority: 100,
        dedupeKey: `reminder:${env.runId}:${index}`,
      });
      return { ...base, status: "ran", detail: { runAt: runAt.toISOString() } };
    }
    case "webhook": {
      const id = newId("dlv");
      await queueDelivery(db, {
        id,
        workspaceId,
        endpointId: action.endpointId,
        payload: {
          id,
          type: env.trigger.type,
          created_at: env.trigger.at,
          workspace_id: workspaceId,
          data: { ...env.trigger.data, automation: { id: env.automation.id, name: env.automation.name } },
        },
      });
      return { ...base, status: "ran", detail: { deliveryId: id } };
    }
    case "reply": {
      const text = renderTemplate(action.text, r).trim();
      if (!text) return { ...base, status: "skipped", reason: "The reply text is empty." };
      await enqueue(db, {
        type: "send_reply",
        workspaceId,
        payload: { workspaceId, conversationId: check.conversationId!, text, actor: env.actor },
        priority: 40,
        maxAttempts: 5,
        dedupeKey: `reply:${env.runId}:${index}`,
      });
      return { ...base, status: "ran", detail: { conversationId: check.conversationId } };
    }
  }
}

const safeError = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Action failed.").replace(/\s+/g, " ").slice(0, 300);

async function runAction(env: RunEnv, action: AutomationAction, index: number, r: RenderVars): Promise<ActionOutcome> {
  try {
    // Savepoint: a failing action rolls back only its own writes.
    return await env.db.transaction(async (sp) => {
      const scoped = { ...env, db: sp };
      const check = await checkAction(scoped, action);
      if (!check.ok) return { index, type: action.type, status: "skipped", reason: check.reason } satisfies ActionOutcome;
      return executeAction(scoped, action, index, check, r);
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { index, type: action.type, status: "skipped", reason: e.message };
    return { index, type: action.type, status: "failed", reason: safeError(e) };
  }
}

export function runStatus(outcomes: ActionOutcome[]): "success" | "failed" | "skipped" {
  if (outcomes.some((o) => o.status === "failed")) return "failed";
  if (outcomes.some((o) => o.status === "ran")) return "success";
  return "skipped";
}

/**
 * Runs one automation for one trigger occurrence, exactly once per `runKey`.
 * Returns the outcome (from the existing run when it already happened).
 */
export async function runAutomation(
  db: Database,
  input: { workspaceId: string; settings: WorkspaceSettings; automation: AutomationRow; trigger: RunTrigger; subject: EventSubject | null; runKey: string },
): Promise<AutomationOutcome & { fresh: boolean }> {
  const { automation, trigger } = input;
  const types = automation.actions.map((a) => a.type);
  const d = trigger.data;
  return db.transaction(async (tx) => {
    const runId = newId("arun");
    const inserted = await tx
      .insert(automationRuns)
      .values({
        id: runId,
        workspaceId: input.workspaceId,
        automationId: automation.id,
        triggerType: trigger.type,
        domainEventId: input.runKey,
        subjectId: d.recordId ?? d.reviewItemId ?? d.messageId ?? null,
        status: "skipped",
        output: { state: "running" },
      })
      .onConflictDoNothing({ target: [automationRuns.automationId, automationRuns.domainEventId], where: sql`domain_event_id is not null` })
      .returning({ id: automationRuns.id });
    if (!inserted.length) {
      const [prev] = await tx
        .select({ status: automationRuns.status, error: automationRuns.error })
        .from(automationRuns)
        .where(and(eq(automationRuns.automationId, automation.id), eq(automationRuns.domainEventId, input.runKey)))
        .limit(1);
      return { automation_id: automation.id, name: automation.name, status: prev?.status ?? "skipped", actions: types, error: prev?.error ?? null, fresh: false };
    }

    const env: RunEnv = { db: tx, workspaceId: input.workspaceId, settings: input.settings, automation, actor: automationActor(automation), trigger, subject: input.subject, runId };
    const vars = await renderVars(env);
    const outcomes: ActionOutcome[] = [];
    for (const [i, action] of automation.actions.entries()) outcomes.push(await runAction(env, action, i, vars));

    const status = runStatus(outcomes);
    const error = outcomes.find((o) => o.status === "failed")?.reason ?? null;
    await tx
      .update(automationRuns)
      .set({ status, output: { trigger: { id: trigger.id, type: trigger.type }, actions: outcomes }, error })
      .where(eq(automationRuns.id, runId));
    await tx
      .update(automations)
      .set({ runCount: sql`${automations.runCount} + 1`, lastRunAt: new Date() })
      .where(and(eq(automations.id, automation.id), eq(automations.workspaceId, input.workspaceId)));
    await bumpUsage(input.workspaceId, { automations_run: 1 }, tx);
    return { automation_id: automation.id, name: automation.name, status, actions: types, error, fresh: true };
  });
}
