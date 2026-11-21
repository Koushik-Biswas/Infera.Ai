/**
 * Job handlers of the automations module (wired in lib/server/jobs/registry.ts):
 *
 *  - domain_event     → run matching automations (idempotent per automation + event) and
 *                       fan the event out to subscribed outbound webhook endpoints;
 *  - deliver_webhook  → one signed delivery attempt (retried by the queue on failure);
 *  - reminder         → in-app notification;
 *  - retention_sweep  → delete messages older than each workspace's `retentionDays`;
 *  - schedule_tick    → run `schedule.daily` automations whose hour has come (workspace timezone).
 *
 * Handlers validate their payloads (malformed → PermanentJobError, no retry) and never
 * log message text or personal data.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { DOMAIN_EVENT_TYPES, type AutomationOutcome, type DomainEvent } from "@/lib/shared/types";
import { getDb, type Database } from "../db";
import { automations, conversations, events, messages, webhookEndpoints, workspaces } from "../db/schema";
import { PermanentJobError, enqueue } from "../jobs/queue";
import { SYSTEM_ACTOR, writeAudit } from "../audit";
import { log } from "../http";
import { notify } from "../notify";
import { localClock, runAutomation, settingsOf } from "./actions";
import { deliverWebhook, queueDelivery } from "./deliver";
import { findMatches } from "./match";

export { localClock };

/* ----------------------------- domain_event ---------------------------- */

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const optId = z.string().min(1).max(100).optional();

const DomainEventSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(DOMAIN_EVENT_TYPES),
  workspaceId: z.string().min(1).max(64),
  at: z.string().min(1).max(40),
  actor: z.object({
    type: z.enum(["user", "api_key", "system", "pipeline", "automation"]),
    id: z.string().max(200).nullable(),
    label: z.string().max(300).optional(),
  }),
  data: z.object({
    messageId: optId,
    eventId: optId,
    recordId: optId,
    collectionId: optId,
    reviewItemId: optId,
    // Lenient: unknown classifier output must not make the event undeliverable.
    category: z.string().max(60).optional(),
    priority: z.string().max(20).optional(),
    intent: z.string().max(80).optional(),
    fromStatus: z.string().max(200).nullable().optional(),
    toStatus: z.string().max(200).nullable().optional(),
    changes: z.array(z.object({ field: z.string().max(100), from: cell, to: cell })).max(500).optional(),
    values: z.record(z.string().max(100), cell).optional(),
  }),
});

/** Deterministic delivery id per (endpoint, event): a retried fan-out never duplicates deliveries. */
const fanoutDeliveryId = (endpointId: string, eventId: string) => `dlv_${createHash("sha256").update(`${endpointId}|${eventId}`).digest("hex").slice(0, 20)}`;

/** Replaces (or appends) the automation outcomes on the processing event's stored result. */
async function patchEventResult(db: Database, workspaceId: string, eventId: string, outcomes: AutomationOutcome[]): Promise<void> {
  if (!outcomes.length) return;
  await db.transaction(async (tx) => {
    const [ev] = await tx
      .select({ id: events.id, result: events.result })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.workspaceId, workspaceId)))
      .for("update")
      .limit(1);
    if (!ev?.result) return;
    const list: AutomationOutcome[] = Array.isArray(ev.result.automation) ? [...ev.result.automation] : [];
    for (const o of outcomes) {
      const i = list.findIndex((x) => x.automation_id === o.automation_id);
      if (i >= 0) list[i] = o;
      else list.push(o);
    }
    await tx
      .update(events)
      .set({ result: sql`jsonb_set(${events.result}, '{automation}', ${JSON.stringify(list)}::jsonb, true)` })
      .where(and(eq(events.id, ev.id), eq(events.workspaceId, workspaceId)));
  });
}

async function fanOut(db: Database, event: DomainEvent): Promise<number> {
  const endpoints = await db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.workspaceId, event.workspaceId), eq(webhookEndpoints.enabled, true), sql`${webhookEndpoints.events} @> ${JSON.stringify([event.type])}::jsonb`))
    .limit(100);
  if (!endpoints.length) return 0;
  await db.transaction(async (tx) => {
    for (const ep of endpoints) {
      await queueDelivery(tx, {
        id: fanoutDeliveryId(ep.id, event.id),
        workspaceId: event.workspaceId,
        endpointId: ep.id,
        payload: { id: event.id, type: event.type, created_at: event.at, workspace_id: event.workspaceId, data: event.data },
      });
    }
  });
  return endpoints.length;
}

export async function handleDomainEventJob(payload: Record<string, unknown>): Promise<void> {
  const parsed = DomainEventSchema.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError("Invalid domain_event payload");
  const event = parsed.data as DomainEvent;
  const db = await getDb();

  // (a) Automations — events caused by an automation never trigger automations (loop guard).
  if (event.actor.type !== "automation") {
    const { subject, matches } = await findMatches(db, event);
    if (matches.length) {
      const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, event.workspaceId)).limit(1);
      if (!ws) return; // workspace deleted meanwhile
      const settings = settingsOf(ws.settings);
      const outcomes: AutomationOutcome[] = [];
      for (const { automation } of matches) {
        const r = await runAutomation(db, { workspaceId: event.workspaceId, settings, automation, trigger: event, subject, runKey: event.id });
        outcomes.push({ automation_id: r.automation_id, name: r.name, status: r.status, actions: r.actions, error: r.error ?? null });
        if (r.fresh) log("info", "automation_run", { workspaceId: event.workspaceId, automationId: automation.id, eventType: event.type, status: r.status });
      }
      if (event.data.eventId) await patchEventResult(db, event.workspaceId, event.data.eventId, outcomes);
    }
  }

  // (b) Outbound webhooks subscribed to this event type.
  await fanOut(db, event);
}

/* ---------------------------- deliver_webhook --------------------------- */

const DeliverSchema = z.object({ deliveryId: z.string().min(1).max(100) });

export async function handleDeliverWebhook(payload: { deliveryId: string }): Promise<void> {
  const parsed = DeliverSchema.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError("Invalid deliver_webhook payload");
  const db = await getDb();
  const out = await deliverWebhook(db, parsed.data.deliveryId);
  // Throwing makes the queue retry with backoff; after MAX_DELIVERY_ATTEMPTS the delivery is "failed" and the job dead.
  if (out.state === "retry") throw new Error(`Webhook delivery failed: ${out.error}`);
  // Final failure (attempts exhausted, blocked destination): the job ends as dead, mirroring the delivery.
  if (out.state === "failed" && !out.inactive) throw new PermanentJobError(`Webhook delivery failed: ${out.error}`);
}

/* -------------------------------- reminder ------------------------------ */

const ReminderSchema = z.object({
  workspaceId: z.string().min(1).max(64),
  title: z.string().max(1000),
  body: z.string().max(10_000).nullish(),
  link: z.string().max(1000).nullish(),
  userIds: z.union([z.literal("all"), z.literal("admins"), z.array(z.string().max(64)).max(500)]).nullish(),
});

export async function handleReminder(payload: Record<string, unknown>): Promise<void> {
  const parsed = ReminderSchema.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError("Invalid reminder payload");
  const p = parsed.data;
  const db = await getDb();
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, p.workspaceId)).limit(1);
  if (!ws) return;
  await notify(db, { workspaceId: p.workspaceId, userIds: p.userIds ?? "all", type: "reminder", title: p.title || "Reminder", body: p.body ?? "", link: p.link ?? null });
}

/* ----------------------------- retention_sweep -------------------------- */

const RETENTION_BATCH = 1000;
const RETENTION_BUDGET_MS = 20_000;

/**
 * Deletes messages older than each workspace's `retentionDays` (by sent time), in
 * batches. Attachments (files) and processing events cascade; record_sources keep their
 * evidence with message_id set to null; records are kept. Conversation previews older
 * than the cutoff are cleared too. Continues in a follow-up job if the budget runs out.
 */
export async function handleRetentionSweep(): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select({ id: workspaces.id, settings: workspaces.settings })
    .from(workspaces)
    .where(sql`jsonb_typeof(${workspaces.settings}->'retentionDays') = 'number'`)
    .limit(10_000);
  if (!rows.length) return;
  const deadline = Date.now() + RETENTION_BUDGET_MS;
  let unfinished = false;

  for (const ws of rows) {
    const days = Number(ws.settings.retentionDays);
    if (!Number.isFinite(days) || days < 1) continue;
    const cutoff = new Date(Date.now() - Math.floor(days) * 86_400_000);
    let total = 0;
    for (;;) {
      if (Date.now() > deadline) {
        unfinished = true;
        break;
      }
      const batch = db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.workspaceId, ws.id), lt(messages.sentAt, cutoff)))
        .limit(RETENTION_BATCH);
      const deleted = await db
        .delete(messages)
        .where(and(eq(messages.workspaceId, ws.id), inArray(messages.id, batch)))
        .returning({ id: messages.id });
      total += deleted.length;
      if (deleted.length < RETENTION_BATCH) break;
    }
    if (total > 0) {
      await db
        .update(conversations)
        .set({ lastMessagePreview: "" })
        .where(and(eq(conversations.workspaceId, ws.id), isNotNull(conversations.lastMessageAt), lt(conversations.lastMessageAt, cutoff), ne(conversations.lastMessagePreview, "")));
      await writeAudit(db, {
        workspaceId: ws.id,
        actor: SYSTEM_ACTOR,
        action: "retention.sweep",
        targetType: "workspace",
        targetId: ws.id,
        after: { count: total },
        meta: { retentionDays: Math.floor(days), cutoff: cutoff.toISOString() },
      });
      log("info", "retention_sweep", { workspaceId: ws.id, deleted: total });
    }
    if (unfinished) break;
  }

  if (unfinished) {
    await enqueue(db, { type: "retention_sweep", payload: { continued: true }, priority: 250, dedupeKey: `retention:cont:${new Date().toISOString().slice(0, 16)}` });
    log("info", "retention_sweep_continues", {});
  }
}

/* ------------------------------ schedule_tick --------------------------- */

/**
 * Runs enabled `schedule.daily` automations whose hour equals the current hour in their
 * workspace's timezone. Idempotent per automation per local day (run key
 * `daily:<automationId>:<YYYY-MM-DD>`), so overlapping ticks never double-run.
 */
export async function handleScheduleTick(now = new Date()): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select({ automation: automations, settings: workspaces.settings })
    .from(automations)
    .innerJoin(workspaces, eq(workspaces.id, automations.workspaceId))
    .where(and(eq(automations.enabled, true), sql`${automations.trigger}->>'type' = 'schedule.daily'`))
    .limit(10_000);
  if (!rows.length) return;

  let failed = 0;
  for (const { automation, settings: raw } of rows) {
    const settings = settingsOf(raw);
    const clock = localClock(now, settings.timezone || "UTC");
    if (automation.trigger.hour !== clock.hour) continue;
    const runKey = `daily:${automation.id}:${clock.date}`;
    try {
      const r = await runAutomation(db, {
        workspaceId: automation.workspaceId,
        settings,
        automation,
        trigger: { id: runKey, type: "schedule.daily", at: now.toISOString(), data: {} },
        subject: null,
        runKey,
      });
      if (r.fresh) log("info", "automation_run", { workspaceId: automation.workspaceId, automationId: automation.id, eventType: "schedule.daily", status: r.status });
    } catch (e) {
      failed++;
      log("error", "scheduled_automation_failed", { workspaceId: automation.workspaceId, automationId: automation.id, message: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
  }
  // Retry the tick for the failed ones; finished runs are skipped on retry.
  if (failed) throw new Error(`${failed} scheduled automation(s) failed`);
}
