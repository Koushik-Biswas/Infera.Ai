import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import dns from "node:dns";
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/server/db";
import {
  auditLog,
  automationRuns,
  automations,
  channels,
  collections,
  contacts,
  conversations,
  events,
  files,
  jobs,
  messages,
  notifications,
  records,
  recordSources,
  usageCounters,
  webhookDeliveries,
  webhookEndpoints,
  workspaces,
  type CollectionRow,
} from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { encrypt, newToken } from "@/lib/server/crypto";
import { templatePlan } from "@/lib/server/templates";
import { createRecord, updateRecord } from "@/lib/server/records/ops";
import { drainJobs, enqueue, runDueJobs, PermanentJobError } from "@/lib/server/jobs/queue";
import { PIPELINE_ACTOR } from "@/lib/server/audit";
import { notify, safeLink } from "@/lib/server/notify";
import { evaluateCondition, evaluateConditions } from "@/lib/server/automations/conditions";
import { matchAutomations } from "@/lib/server/automations/match";
import { handleDeliverWebhook, handleDomainEventJob, handleRetentionSweep, handleScheduleTick, localClock } from "@/lib/server/automations/jobs";
import { EXTERNAL_DISABLED, renderTemplate } from "@/lib/server/automations/actions";
import { queueDelivery } from "@/lib/server/automations/deliver";
import { SsrfBlockedError, assertPublicDestination, checkWebhookUrl, isBlockedIp } from "@/lib/server/automations/ssrf";
import { GET as listAutomations, POST as createAutomation } from "@/app/api/v1/automations/route";
import { DELETE as deleteAutomation, GET as getAutomation, PATCH as patchAutomation } from "@/app/api/v1/automations/[id]/route";
import { GET as listRuns } from "@/app/api/v1/automations/[id]/runs/route";
import { POST as testAutomation } from "@/app/api/v1/automations/[id]/test/route";
import { GET as listTemplates } from "@/app/api/v1/automations/templates/route";
import { GET as listEndpoints, POST as createEndpoint } from "@/app/api/v1/webhooks/route";
import { DELETE as deleteEndpoint, PATCH as patchEndpoint } from "@/app/api/v1/webhooks/[id]/route";
import { GET as listDeliveries } from "@/app/api/v1/webhooks/[id]/deliveries/route";
import { POST as testEndpoint } from "@/app/api/v1/webhooks/[id]/test/route";
import { GET as listNotifications } from "@/app/api/v1/notifications/route";
import { POST as readNotifications } from "@/app/api/v1/notifications/read/route";
import { GET as cronGet, POST as cronPost } from "@/app/api/cron/route";
import { defaultWorkspaceSettings, type Actor, type DomainEvent, type ProcessingResult, type TemplateId, type WorkspaceSettings } from "@/lib/shared/types";
import { addMember, call, createTestWorkspace, type TestWorkspace, opened } from "./helpers";

/* ------------------------------- Fixtures ------------------------------- */

type Ctx = { ws: TestWorkspace; cols: Record<string, CollectionRow>; channelId: string; user: Actor };

async function setup(opts: { templates?: Exclude<TemplateId, "custom">[]; settings?: Partial<WorkspaceSettings> } = {}): Promise<Ctx> {
  const ws = await createTestWorkspace();
  const db = await getDb();
  await db
    .update(workspaces)
    .set({ settings: { ...defaultWorkspaceSettings, aiMode: "off", ...opts.settings } })
    .where(eq(workspaces.id, ws.workspaceId));
  const cols: Record<string, CollectionRow> = {};
  for (const t of opts.templates ?? ["leads", "payments", "tasks"]) {
    const p = templatePlan(t);
    const [row] = await db
      .insert(collections)
      .values({ id: newId("col"), workspaceId: ws.workspaceId, name: p.name, description: p.description, icon: p.icon, template: p.template, fields: p.fields, routing: p.routing, matchFields: p.matchFields })
      .returning();
    cols[t] = row;
  }
  const [ch] = await db.insert(channels).values({ id: newId("chn"), workspaceId: ws.workspaceId, type: "whatsapp_cloud", name: "WhatsApp", webhookToken: newToken(16) }).returning();
  return { ws, cols, channelId: ch.id, user: { type: "user", id: ws.userId, label: "Owner" } };
}

let seq = 0;
async function chat(ctx: Ctx, name = "Rahul") {
  const db = await getDb();
  const phone = `+9198700${String(++seq).padStart(5, "0")}`;
  const [contact] = await db.insert(contacts).values({ id: newId("ctc"), workspaceId: ctx.ws.workspaceId, displayName: name, phone }).returning();
  const [conv] = await db
    .insert(conversations)
    .values({ id: newId("cnv"), workspaceId: ctx.ws.workspaceId, channelId: ctx.channelId, externalId: phone.slice(1), title: name, contactId: contact.id, lastMessagePreview: "hello" })
    .returning();
  return { contact, conv };
}

async function message(ctx: Ctx, c: Awaited<ReturnType<typeof chat>>, opts: { text?: string; sentAt?: Date; classification?: { category: "sales_enquiry" | "support"; priority: "low" | "high" | "urgent"; intent: string } } = {}) {
  const db = await getDb();
  const id = newId("msg");
  const eventId = newId("evt");
  await db.insert(messages).values({
    id,
    workspaceId: ctx.ws.workspaceId,
    channelId: ctx.channelId,
    conversationId: c.conv.id,
    contactId: c.contact.id,
    externalId: `wamid.${++seq}`,
    senderName: "Rahul",
    text: opts.text ?? "hello",
    sentAt: opts.sentAt ?? new Date(),
    status: "processed",
    eventId,
    classification: opts.classification ? { ...opts.classification, confidence: 0.9, method: "rules" } : null,
  });
  await db.insert(events).values({ id: eventId, workspaceId: ctx.ws.workspaceId, messageId: id, source: "whatsapp", status: "processed" });
  return { messageId: id, eventId };
}

async function newAutomation(ctx: Ctx, body: Record<string, unknown>) {
  const res = await call(createAutomation, { url: "/api/v1/automations", cookie: ctx.ws.cookie, body });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json as { id: string; trigger: Record<string, unknown>; actions: { type: string }[] };
}

async function newEndpoint(ctx: Ctx, events: string[], url = "https://hooks.example.com/infera") {
  const res = await call(createEndpoint, { url: "/api/v1/webhooks", cookie: ctx.ws.cookie, body: { url, events, description: "CRM" } });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json as { id: string; secret: string; events: string[] };
}

const runsOf = async (automationId: string) => (await getDb()).select().from(automationRuns).where(eq(automationRuns.automationId, automationId));
const notificationsOf = async (workspaceId: string) => (await getDb()).select().from(notifications).where(eq(notifications.workspaceId, workspaceId));
const domainEventPayloads = async (workspaceId: string, type: string) =>
  (await (await getDb()).select().from(jobs).where(and(eq(jobs.type, "domain_event"), eq(jobs.workspaceId, workspaceId)))).map((j) => j.payload as unknown as DomainEvent).filter((p) => p.type === type);

const okFetch = () => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("ok", { status: 200 }));

beforeAll(async () => {
  await getDb();
}, 180_000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ---------------------- Scheduled jobs on an empty DB --------------------- */

describe("scheduled jobs with no data", () => {
  it("schedule tick and retention sweep succeed quickly when there are no workspaces", async () => {
    const t0 = Date.now();
    await expect(handleScheduleTick()).resolves.toBeUndefined();
    await expect(handleRetentionSweep()).resolves.toBeUndefined();
    const db = await getDb();
    await enqueue(db, { type: "schedule_tick", payload: { at: "x" }, dedupeKey: "t-empty" });
    await enqueue(db, { type: "retention_sweep", payload: {}, dedupeKey: "r-empty" });
    expect(await runDueJobs({ types: ["schedule_tick", "retention_sweep"] })).toEqual({ ran: 2, failed: 0 });
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

/* ------------------------------- Conditions ------------------------------ */

describe("conditions", () => {
  const ctx = { values: { status: "Won", amount: "1,500", budget: 900, name: "Rahul Sharma", note: "  ", paid: true, due: "2026-11-20" }, category: "sales_enquiry", priority: "HIGH", intent: "purchase_interest", source: "whatsapp", channel: "whatsapp_cloud" };
  const pass = (field: string, op: Parameters<typeof evaluateCondition>[0]["op"], value?: Parameters<typeof evaluateCondition>[0]["value"]) => evaluateCondition({ field, op, value }, ctx).pass;

  it("eq / neq compare strings case-insensitively and numbers numerically", () => {
    expect(pass("status", "eq", "won")).toBe(true);
    expect(pass("status", "neq", "WON")).toBe(false);
    expect(pass("status", "neq", "Lost")).toBe(true);
    expect(pass("amount", "eq", 1500)).toBe(true);
    expect(pass("paid", "eq", "yes")).toBe(true);
    expect(pass("missing", "eq", "x")).toBe(false);
    expect(pass("missing", "eq", null)).toBe(true);
  });

  it("contains / not_contains, numeric comparisons, exists / not_exists and in", () => {
    expect(pass("name", "contains", "sharma")).toBe(true);
    expect(pass("name", "not_contains", "verma")).toBe(true);
    expect(pass("missing", "contains", "x")).toBe(false);
    expect(pass("amount", "gt", 1000)).toBe(true);
    expect(pass("amount", "gte", "1500")).toBe(true);
    expect(pass("budget", "lt", 1000)).toBe(true);
    expect(pass("budget", "lte", 899)).toBe(false);
    expect(pass("name", "gt", 1)).toBe(false); // not a number → never passes
    expect(pass("missing", "lt", 5)).toBe(false); // unknown never satisfies a comparison (rule 12)
    expect(pass("due", "gt", "2026-11-19")).toBe(true);
    expect(pass("name", "exists")).toBe(true);
    expect(pass("note", "exists")).toBe(false); // blank = unknown
    expect(pass("note", "not_exists")).toBe(true);
    expect(pass("priority", "in", ["high", "urgent"])).toBe(true);
    expect(pass("priority", "in", ["low"])).toBe(false);
    expect(pass("missing", "in", ["x"])).toBe(false);
  });

  it("reads message context fields and ANDs every condition", () => {
    expect(pass("category", "eq", "Sales_Enquiry")).toBe(true);
    expect(pass("channel", "eq", "whatsapp_cloud")).toBe(true);
    expect(pass("source", "in", ["whatsapp", "telegram"])).toBe(true);
    expect(pass("record.status", "eq", "won")).toBe(true);
    const r = evaluateConditions(
      [
        { field: "status", op: "eq", value: "Won" },
        { field: "amount", op: "gt", value: 5000 },
      ],
      ctx,
    );
    expect(r.pass).toBe(false);
    expect(r.results.map((x) => x.pass)).toEqual([true, false]);
    expect(r.results[1]).toMatchObject({ field: "amount", op: "gt", value: 5000, actual: "1,500" });
    expect(evaluateConditions([], ctx).pass).toBe(true);
  });

  it("renders placeholders from record values and event context", () => {
    const vars = { values: { name: "Rahul", amount: 1200, paid: false }, vars: { priority: "high", toStatus: "Won" } };
    expect(renderTemplate("Deal {{ name }} → {{toStatus}} ({{priority}}) {{values.amount}} paid={{paid}} {{unknown}}!", vars)).toBe("Deal Rahul → Won (high) 1200 paid=no !");
  });
});

/* ------------------------------- Matching -------------------------------- */

describe("matchAutomations", () => {
  it("filters by trigger type, collection, target status, categories, conditions and enabled; loop-guarded", async () => {
    const ctx = await setup();
    const other = await setup();
    const db = await getDb();
    const leads = ctx.cols.leads.id;
    const insert = async (name: string, trigger: object, conditions: object[] = [], enabled = true) => {
      const [row] = await db
        .insert(automations)
        .values({ id: newId("aut"), workspaceId: ctx.ws.workspaceId, name, enabled, trigger: trigger as never, conditions: conditions as never, actions: [{ type: "notify", to: "admins", title: name }] })
        .returning();
      return row.id;
    };
    const won = await insert("won", { type: "record.status_changed", collectionId: leads, toStatus: "Won" });
    const hot = await insert("hot", { type: "message.processed", categories: ["sales_enquiry"] }, [{ field: "priority", op: "in", value: ["high", "urgent"] }]);
    await insert("daily", { type: "schedule.daily", hour: 9 });
    await insert("off", { type: "record.status_changed", collectionId: leads }, [], false);
    const big = await insert("big", { type: "record.created" }, [{ field: "budget", op: "gte", value: 1000 }]);

    const base = { workspaceId: ctx.ws.workspaceId, actor: ctx.user };
    const ids = async (e: Omit<DomainEvent, "id" | "at">) => (await matchAutomations(db, e)).map((m) => m.id);

    expect(await matchAutomations(db, { ...base, type: "record.status_changed", data: { collectionId: leads, recordId: "rec_x", toStatus: "won", values: {} } })).toEqual([{ id: won, name: "won", actions: ["notify"] }]);
    expect(await ids({ ...base, type: "record.status_changed", data: { collectionId: leads, toStatus: "Lost" } })).toEqual([]);
    expect(await ids({ ...base, type: "record.status_changed", data: { collectionId: ctx.cols.payments.id, toStatus: "Won" } })).toEqual([]);
    expect(await ids({ ...base, type: "message.processed", data: { category: "sales_enquiry", priority: "high" } })).toEqual([hot]);
    expect(await ids({ ...base, type: "message.processed", data: { category: "sales_enquiry", priority: "low" } })).toEqual([]);
    expect(await ids({ ...base, type: "message.processed", data: { category: "support", priority: "urgent" } })).toEqual([]);
    // Classification loaded from the message when the event doesn't carry it.
    const c = await chat(ctx);
    const m = await message(ctx, c, { classification: { category: "sales_enquiry", priority: "urgent", intent: "purchase_interest" } });
    expect(await ids({ ...base, type: "message.processed", data: { messageId: m.messageId } })).toEqual([hot]);
    expect(await ids({ ...base, type: "record.created", data: { collectionId: leads, values: { budget: 5000 } } })).toEqual([big]);
    expect(await ids({ ...base, type: "record.created", data: { collectionId: leads, values: { budget: 10 } } })).toEqual([]);
    // Loop guard and tenancy.
    expect(await ids({ ...base, actor: { type: "automation", id: won }, type: "record.status_changed", data: { collectionId: leads, toStatus: "Won" } })).toEqual([]);
    expect(await ids({ workspaceId: other.ws.workspaceId, actor: other.user, type: "record.status_changed", data: { collectionId: leads, toStatus: "Won" } })).toEqual([]);
  });
});

/* --------------------------- Domain event job ---------------------------- */

describe("domain_event job", () => {
  it("notifies admins when a Leads record moves to Won — once, even if the job runs again", async () => {
    const ctx = await setup();
    const admin = await addMember(ctx.ws.workspaceId, "admin");
    await addMember(ctx.ws.workspaceId, "member");
    const db = await getDb();
    const a = await newAutomation(ctx, {
      name: "Won deals",
      trigger: { type: "record.status_changed", collectionId: ctx.cols.leads.id, toStatus: "won" },
      actions: [{ type: "notify", to: "admins", title: "Deal won: {{name}}", body: "{{name}} is now {{toStatus}}." }],
    });
    expect(a.trigger.toStatus).toBe("Won"); // normalised to the field's option

    const rec = await createRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.cols.leads, values: { name: "Rahul", interest: "Shirts", status: "New lead" }, origin: "manual", actor: ctx.user });
    await drainJobs();
    expect(await runsOf(a.id)).toHaveLength(0);

    await updateRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.cols.leads, recordId: rec.record.id, patch: { status: "Won" }, mode: "human", actor: ctx.user });
    await drainJobs();

    const notes = await notificationsOf(ctx.ws.workspaceId);
    expect(notes.map((n) => n.userId).sort()).toEqual([ctx.ws.userId, admin.userId].sort());
    expect(notes[0]).toMatchObject({ type: "automation", title: "Deal won: Rahul", body: "Rahul is now Won.", link: `/console/collections/${ctx.cols.leads.id}?record=${rec.record.id}` });
    const runs = await runsOf(a.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "success", triggerType: "record.status_changed", subjectId: rec.record.id, error: null });
    expect((runs[0].output as { actions: unknown[] }).actions).toEqual([{ index: 0, type: "notify", status: "ran", detail: { recipients: 2 } }]);
    const [aut] = await db.select().from(automations).where(eq(automations.id, a.id));
    expect(aut.runCount).toBe(1);
    expect(aut.lastRunAt).toBeInstanceOf(Date);
    const [usage] = await db.select().from(usageCounters).where(and(eq(usageCounters.workspaceId, ctx.ws.workspaceId), eq(usageCounters.metric, "automations_run")));
    expect(usage.value).toBe(1);

    // Re-running the same event (retry / duplicate delivery) is a no-op.
    const [payload] = await domainEventPayloads(ctx.ws.workspaceId, "record.status_changed");
    await handleDomainEventJob(payload as unknown as Record<string, unknown>);
    expect(await notificationsOf(ctx.ws.workspaceId)).toHaveLength(2);
    expect(await runsOf(a.id)).toHaveLength(1);

    // Runs endpoint (paginated, tenant-checked).
    const r = await call(listRuns, { url: `/api/v1/automations/${a.id}/runs`, cookie: ctx.ws.cookie, params: { id: a.id } });
    expect(r.status).toBe(200);
    expect(r.json.items).toHaveLength(1);
    expect(r.json.items[0]).toMatchObject({ automationId: a.id, status: "success", subjectId: rec.record.id });
    const other = await createTestWorkspace();
    expect((await call(listRuns, { url: `/api/v1/automations/${a.id}/runs`, cookie: other.cookie, params: { id: a.id } })).status).toBe(404);
  });

  it("rejects malformed payloads permanently", async () => {
    await expect(handleDomainEventJob({ id: "x" })).rejects.toBeInstanceOf(PermanentJobError);
  });

  it("loop guard: an automation's own record change doesn't trigger automations again; human edits are never overwritten", async () => {
    const ctx = await setup();
    const db = await getDb();
    const a = await newAutomation(ctx, {
      name: "Next step",
      trigger: { type: "record.updated", collectionId: ctx.cols.leads.id },
      actions: [{ type: "set_field", key: "next", value: "Call {{name}}" }],
    });
    const rec = await createRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.cols.leads, values: { name: "Rahul", interest: "Sofa", status: "New lead" }, origin: "manual", actor: ctx.user });
    await updateRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.cols.leads, recordId: rec.record.id, patch: { status: "Contacted" }, mode: "human", actor: ctx.user });
    await drainJobs();

    let [row] = await db.select().from(records).where(eq(records.id, rec.record.id));
    expect(row.values.next).toBe("Call Rahul");
    expect(row.fieldMeta.next).toMatchObject({ source: "automation", confidence: 1, method: null, messageId: null, evidence: null });
    expect(row.fieldMeta.next.edited).toBeFalsy();
    // The automation's update emitted record.updated (actor automation) — it ran, but didn't re-trigger.
    const updates = await domainEventPayloads(ctx.ws.workspaceId, "record.updated");
    expect(updates.map((u) => u.actor.type).sort()).toEqual(["automation", "user"]);
    expect(await runsOf(a.id)).toHaveLength(1);

    // A person sets the field → the next run reports a conflict instead of overwriting.
    await updateRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.cols.leads, recordId: rec.record.id, patch: { next: "Visit on Monday" }, mode: "human", actor: ctx.user });
    await drainJobs();
    [row] = await db.select().from(records).where(eq(records.id, rec.record.id));
    expect(row.values.next).toBe("Visit on Monday");
    const runs = await runsOf(a.id);
    expect(runs).toHaveLength(2);
    const latest = runs.find((r) => r.status === "skipped")!;
    expect((latest.output as { actions: { status: string; reason: string }[] }).actions[0]).toMatchObject({ status: "skipped", reason: expect.stringContaining("edited by a person") });
  });

  it("patches the processing event's result.automation with the final status", async () => {
    const ctx = await setup();
    const db = await getDb();
    const a = await newAutomation(ctx, {
      name: "Complaints",
      trigger: { type: "message.processed", categories: ["support"] },
      conditions: [{ field: "intent", op: "eq", value: "complaint" }],
      actions: [{ type: "notify", to: "all", title: "New complaint ({{priority}})" }],
    });
    const b = await newAutomation(ctx, { name: "Any message", trigger: { type: "message.processed" }, actions: [{ type: "add_tag", tag: "customer" }] });
    const c = await chat(ctx);
    const m = await message(ctx, c, { classification: { category: "support", priority: "high", intent: "complaint" } });
    const result = { event_id: m.eventId, status: "processed", automation: [{ automation_id: a.id, name: "Complaints", status: "queued", actions: ["notify"] }], requires_human_review: false } as unknown as ProcessingResult;
    await db.update(events).set({ result }).where(eq(events.id, m.eventId));

    const event: DomainEvent = { id: newId("de"), type: "message.processed", workspaceId: ctx.ws.workspaceId, at: new Date().toISOString(), actor: PIPELINE_ACTOR, data: { messageId: m.messageId, eventId: m.eventId } };
    await handleDomainEventJob(event as unknown as Record<string, unknown>);

    const [ev] = await db.select().from(events).where(eq(events.id, m.eventId));
    expect(ev.result!.automation).toEqual([
      { automation_id: a.id, name: "Complaints", status: "success", actions: ["notify"], error: null },
      { automation_id: b.id, name: "Any message", status: "success", actions: ["add_tag"], error: null },
    ]);
    expect(ev.result!.event_id).toBe(m.eventId);
    const notes = await notificationsOf(ctx.ws.workspaceId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ userId: null, title: "New complaint (high)", link: `/console/inbox/${c.conv.id}` });
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, c.contact.id));
    expect(contact.tags).toEqual(["customer"]);
  });

  it("webhook and reply actions are skipped unless the workspace allows external actions", async () => {
    const ctx = await setup({ settings: { allowExternalActions: false } });
    const db = await getDb();
    const ep = await newEndpoint(ctx, ["review.created"]); // not subscribed to record.* → no fan-out
    const a = await newAutomation(ctx, {
      name: "Sync new leads",
      trigger: { type: "record.created", collectionId: ctx.cols.leads.id },
      actions: [
        { type: "webhook", endpointId: ep.id },
        { type: "reply", text: "Thanks {{name}}, we'll call you soon." },
        { type: "add_tag", tag: "lead" },
        { type: "reminder", afterMinutes: 60, title: "Call {{name}}" },
        { type: "create_record", collectionId: ctx.cols.tasks.id, values: { task: "Call {{name}}", status: "To do" } },
      ],
    });
    const c1 = await chat(ctx, "Rahul");
    await createRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.cols.leads, values: { name: "Rahul", interest: "Sofa" }, contactId: c1.contact.id, conversationId: c1.conv.id, origin: "manual", actor: ctx.user });
    await drainJobs({ types: ["domain_event"] });

    let [run] = await runsOf(a.id);
    const out = (run.output as { actions: { type: string; status: string; reason?: string; detail?: Record<string, unknown> }[] }).actions;
    expect(out.map((o) => [o.type, o.status])).toEqual([
      ["webhook", "skipped"],
      ["reply", "skipped"],
      ["add_tag", "ran"],
      ["reminder", "ran"],
      ["create_record", "ran"],
    ]);
    expect(out[0].reason).toBe(EXTERNAL_DISABLED);
    expect(out[1].reason).toBe(EXTERNAL_DISABLED);
    expect(run.status).toBe("success");
    expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.workspaceId, ctx.ws.workspaceId))).toHaveLength(0);
    expect(await db.select().from(jobs).where(and(eq(jobs.workspaceId, ctx.ws.workspaceId), eq(jobs.type, "send_reply")))).toHaveLength(0);
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, c1.contact.id));
    expect(contact.tags).toEqual(["lead"]);
    const [reminder] = await db.select().from(jobs).where(and(eq(jobs.workspaceId, ctx.ws.workspaceId), eq(jobs.type, "reminder")));
    expect(reminder.payload).toMatchObject({ workspaceId: ctx.ws.workspaceId, title: "Call Rahul", userIds: "all" });
    expect(reminder.runAt.getTime()).toBeGreaterThan(Date.now() + 55 * 60_000);
    const [task] = await db.select().from(records).where(eq(records.id, out[4].detail!.recordId as string));
    expect(task).toMatchObject({ collectionId: ctx.cols.tasks.id, origin: "automation", contactId: c1.contact.id, values: { task: "Call Rahul", status: "To do" } });

    // Allowed → a signed delivery for the endpoint and a send_reply job are queued.
    await db
      .update(workspaces)
      .set({ settings: { ...defaultWorkspaceSettings, aiMode: "off", allowExternalActions: true } })
      .where(eq(workspaces.id, ctx.ws.workspaceId));
    const c2 = await chat(ctx, "Priya");
    await createRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.cols.leads, values: { name: "Priya", interest: "Table" }, contactId: c2.contact.id, conversationId: c2.conv.id, origin: "manual", actor: ctx.user });
    await drainJobs({ types: ["domain_event"] });
    const runs = await runsOf(a.id);
    expect(runs).toHaveLength(2);
    run = runs.find((r) => r.id !== run.id)!;
    expect((run.output as { actions: { status: string }[] }).actions.map((o) => o.status)).toEqual(["ran", "ran", "ran", "ran", "ran"]);
    const [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, ep.id));
    expect(delivery).toMatchObject({ eventType: "record.created", status: "pending" });
    expect(delivery.payload).toMatchObject({ id: delivery.id, type: "record.created", workspace_id: ctx.ws.workspaceId, data: { automation: { id: a.id, name: "Sync new leads" } } });
    const [reply] = await db.select().from(jobs).where(and(eq(jobs.workspaceId, ctx.ws.workspaceId), eq(jobs.type, "send_reply")));
    expect(reply.payload).toMatchObject({ workspaceId: ctx.ws.workspaceId, conversationId: c2.conv.id, text: "Thanks Priya, we'll call you soon.", actor: { type: "automation", id: a.id } });

    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    await drainJobs({ types: ["deliver_webhook"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [done] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery.id));
    expect(done.status).toBe("delivered");
  });
});

/* ---------------------------- Outbound webhooks --------------------------- */

describe("outbound webhooks", () => {
  it("fans events out to subscribed endpoints with a verifiable signature", async () => {
    const ctx = await setup();
    const db = await getDb();
    const ep = await newEndpoint(ctx, ["record.created", "record.updated"]);
    expect(ep.secret).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
    expect(ep.events).toEqual(["record.created", "record.updated"]);
    const list = await call(listEndpoints, { url: "/api/v1/webhooks", cookie: ctx.ws.cookie });
    expect(list.json.items).toHaveLength(1);
    expect(list.json.items[0].secret).toBeUndefined();
    const [stored] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, ep.id));
    expect(stored.secretEnc).not.toContain(ep.secret);

    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const rec = await createRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.cols.leads, values: { name: "Rahul", interest: "Sofa" }, origin: "manual", actor: ctx.user });
    await drainJobs();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://hooks.example.com/infera");
    const headers = new Headers(init!.headers);
    const body = String(init!.body);
    const [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, ep.id));
    expect(init!.method).toBe("POST");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("user-agent")).toBe("Infera-Webhooks/1.0");
    expect(headers.get("x-infera-event")).toBe("record.created");
    expect(headers.get("x-infera-delivery")).toBe(delivery.id);
    const sig = headers.get("x-infera-signature")!;
    const m = sig.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    expect(m).not.toBeNull();
    expect(Math.abs(Number(m![1]) - Date.now() / 1000)).toBeLessThan(60);
    expect(m![2]).toBe(createHmac("sha256", ep.secret).update(`${m![1]}.${body}`).digest("hex"));
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({ type: "record.created", workspace_id: ctx.ws.workspaceId, data: { recordId: rec.record.id, collectionId: ctx.cols.leads.id, values: { name: "Rahul" } } });
    expect(parsed.id).toMatch(/^de_/);
    expect(new Date(parsed.created_at).toString()).not.toBe("Invalid Date");

    expect(delivery).toMatchObject({ status: "delivered", attempts: 1, responseStatus: 200, error: null });
    expect(delivery.deliveredAt).toBeInstanceOf(Date);
    const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, ep.id));
    expect(endpoint).toMatchObject({ lastStatus: 200, failureCount: 0 });

    // Fan-out is idempotent per (endpoint, event).
    const [payload] = await domainEventPayloads(ctx.ws.workspaceId, "record.created");
    await handleDomainEventJob(payload as unknown as Record<string, unknown>);
    expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, ep.id))).toHaveLength(1);

    // Deliveries list (no payload) + tenancy.
    const d = await call(listDeliveries, { url: `/api/v1/webhooks/${ep.id}/deliveries`, cookie: ctx.ws.cookie, params: { id: ep.id } });
    expect(d.status).toBe(200);
    expect(d.json.items).toEqual([expect.objectContaining({ id: delivery.id, status: "delivered", responseStatus: 200, eventType: "record.created" })]);
    expect(d.json.items[0].payload).toBeUndefined();
    const other = await createTestWorkspace();
    expect((await call(listDeliveries, { url: `/api/v1/webhooks/${ep.id}/deliveries`, cookie: other.cookie, params: { id: ep.id } })).status).toBe(404);
  });

  it("records failed attempts for retry, gives up after 6, and auto-disables after 20 consecutive failures", async () => {
    const ctx = await setup();
    const db = await getDb();
    const ep = await newEndpoint(ctx, ["record.created"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    await createRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.cols.leads, values: { name: "Rahul", interest: "Sofa" }, origin: "manual", actor: ctx.user });
    await drainJobs({ types: ["domain_event"] });
    expect(await runDueJobs({ types: ["deliver_webhook"] })).toEqual({ ran: 1, failed: 1 });

    let [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, ep.id));
    expect(delivery).toMatchObject({ status: "pending", attempts: 1, responseStatus: 500, error: "HTTP 500." });
    const [job] = await db.select().from(jobs).where(and(eq(jobs.type, "deliver_webhook"), eq(jobs.workspaceId, ctx.ws.workspaceId)));
    expect(job).toMatchObject({ status: "queued", attempts: 1, maxAttempts: 6 });
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(job.lastError).toContain("HTTP 500");
    let [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, ep.id));
    expect(endpoint).toMatchObject({ failureCount: 1, lastStatus: 500, enabled: true });

    // Sixth attempt fails for good.
    await db.update(webhookDeliveries).set({ attempts: 5 }).where(eq(webhookDeliveries.id, delivery.id));
    await expect(handleDeliverWebhook({ deliveryId: delivery.id })).rejects.toBeInstanceOf(PermanentJobError);
    [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery.id));
    expect(delivery).toMatchObject({ status: "failed", attempts: 6 });

    // 20 consecutive failures → endpoint disabled + admins notified.
    await db.update(webhookEndpoints).set({ failureCount: 19 }).where(eq(webhookEndpoints.id, ep.id));
    const payload = { id: "evt_test", type: "record.created", created_at: new Date().toISOString(), workspace_id: ctx.ws.workspaceId, data: {} };
    const d2 = await queueDelivery(db, { workspaceId: ctx.ws.workspaceId, endpointId: ep.id, payload });
    await expect(handleDeliverWebhook({ deliveryId: d2 })).rejects.toThrow(/HTTP 500/);
    [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, ep.id));
    expect(endpoint).toMatchObject({ failureCount: 20, enabled: false });
    const notes = await notificationsOf(ctx.ws.workspaceId);
    expect(notes).toEqual([expect.objectContaining({ userId: ctx.ws.userId, type: "webhook_disabled", title: "Webhook endpoint disabled", link: "/console/settings/webhooks" })]);
    expect(notes[0].body).toContain("hooks.example.com");
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.workspaceId, ctx.ws.workspaceId), eq(auditLog.action, "webhook.auto_disable")));
    expect(audits).toHaveLength(1);
    // Pending deliveries for a disabled endpoint end without sending.
    const d3 = await queueDelivery(db, { workspaceId: ctx.ws.workspaceId, endpointId: ep.id, payload: { ...payload, id: "evt_test2" } });
    await expect(handleDeliverWebhook({ deliveryId: d3 })).resolves.toBeUndefined();
    expect((await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, d3)))[0]).toMatchObject({ status: "failed", error: "The webhook endpoint is disabled.", attempts: 0 });

    // Re-enabling resets the streak; network errors are reported without details of the payload.
    const patched = await call(patchEndpoint, { url: `/api/v1/webhooks/${ep.id}`, method: "PATCH", cookie: ctx.ws.cookie, params: { id: ep.id }, body: { enabled: true } });
    expect(patched.status).toBe(200);
    expect(patched.json).toMatchObject({ enabled: true, failureCount: 0 });
    expect(patched.json.secret).toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
      }),
    );
    const d4 = await queueDelivery(db, { workspaceId: ctx.ws.workspaceId, endpointId: ep.id, payload: { ...payload, id: "evt_test3" } });
    await expect(handleDeliverWebhook({ deliveryId: d4 })).rejects.toThrow(/ECONNREFUSED/);
    expect((await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, d4)))[0]).toMatchObject({ status: "pending", attempts: 1, responseStatus: null, error: "Connection failed (ECONNREFUSED)." });
    // Leave no deliverable jobs behind for later drains (they would hit the network).
    await db.delete(jobs).where(and(eq(jobs.workspaceId, ctx.ws.workspaceId), eq(jobs.type, "deliver_webhook")));
  });

  it("SSRF guard blocks private, loopback, link-local and metadata destinations in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PRIVATE_WEBHOOKS", "");
    for (const u of ["https://127.0.0.1/hook", "https://10.0.0.5/hook", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://0.0.0.0/", "https://localhost/x", "https://metadata.google.internal/", "http://hooks.example.com/x", "https://user:pw@hooks.example.com/x", "ftp://hooks.example.com/"]) {
      expect(checkWebhookUrl(u).ok, u).toBe(false);
    }
    expect(checkWebhookUrl("https://hooks.example.com/x").ok).toBe(true);
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.4", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1"]) expect(isBlockedIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) expect(isBlockedIp(ip), ip).toBe(false);

    // Host names are resolved at delivery time: any private address → blocked.
    const lookup = vi.spyOn(dns.promises, "lookup") as unknown as ReturnType<typeof vi.fn>;
    lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.7", family: 4 }]);
    await expect(assertPublicDestination("https://rebind.example.com/hook")).rejects.toBeInstanceOf(SsrfBlockedError);
    lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertPublicDestination("https://hooks.example.com/hook")).resolves.toBeInstanceOf(URL);

    // A delivery to a blocked address fails permanently without any request.
    const ctx = await setup();
    const db = await getDb();
    const [ep] = await db
      .insert(webhookEndpoints)
      .values({ id: newId("whk"), workspaceId: ctx.ws.workspaceId, url: "https://169.254.169.254/latest", secretEnc: encrypt("whsec_x"), events: ["record.created"] })
      .returning();
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const id = await queueDelivery(db, { workspaceId: ctx.ws.workspaceId, endpointId: ep.id, payload: { id: "e1", type: "record.created", created_at: new Date().toISOString(), workspace_id: ctx.ws.workspaceId, data: {} } });
    await expect(handleDeliverWebhook({ deliveryId: id })).rejects.toBeInstanceOf(PermanentJobError);
    expect(fetchMock).not.toHaveBeenCalled();
    const [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id));
    expect(d.status).toBe("failed");
    expect(d.error).toMatch(/private|loopback|link-local/);

    // Creating an endpoint validates the URL (https only, no private literals) in production.
    const bad = await call(createEndpoint, { url: "/api/v1/webhooks", cookie: ctx.ws.cookie, body: { url: "http://hooks.example.com/x", events: ["record.created"] } });
    expect(bad.status).toBe(422);
    expect((await call(createEndpoint, { url: "/api/v1/webhooks", cookie: ctx.ws.cookie, body: { url: "https://10.0.0.1/x", events: ["record.created"] } })).status).toBe(422);

    // Self-hosted escape hatch.
    vi.stubEnv("ALLOW_PRIVATE_WEBHOOKS", "1");
    expect(checkWebhookUrl("https://10.0.0.5/hook").ok).toBe(true);
  });

  it("endpoint CRUD: admin-only, validated, secret shown once, rotation, test ping, tenancy", async () => {
    const ctx = await setup();
    const db = await getDb();
    const member = await addMember(ctx.ws.workspaceId, "member");
    const other = await createTestWorkspace();
    expect((await call(createEndpoint, { url: "/api/v1/webhooks", cookie: member.cookie, body: { url: "https://a.example.com", events: ["record.created"] } })).status).toBe(403);
    expect((await call(listEndpoints, { url: "/api/v1/webhooks", apiKey: ctx.ws.apiKey })).status).toBe(403);
    expect((await call(createEndpoint, { url: "/api/v1/webhooks", cookie: ctx.ws.cookie, body: { url: "https://a.example.com", events: [] } })).status).toBe(422);
    expect((await call(createEndpoint, { url: "/api/v1/webhooks", cookie: ctx.ws.cookie, body: { url: "https://a.example.com", events: ["record.exploded"] } })).status).toBe(422);
    expect((await call(createEndpoint, { url: "/api/v1/webhooks", cookie: ctx.ws.cookie, body: { url: "not a url", events: ["record.created"] } })).status).toBe(422);

    const ep = await newEndpoint(ctx, ["record.created"]);
    const rotated = await call(patchEndpoint, { url: `/api/v1/webhooks/${ep.id}`, method: "PATCH", cookie: ctx.ws.cookie, params: { id: ep.id }, body: { rotateSecret: true, events: ["record.created", "review.created"] } });
    expect(rotated.status).toBe(200);
    expect(rotated.json.secret).toMatch(/^whsec_/);
    expect(rotated.json.secret).not.toBe(ep.secret);
    expect(rotated.json.events).toEqual(["record.created", "review.created"]);
    expect((await call(patchEndpoint, { url: `/api/v1/webhooks/${ep.id}`, method: "PATCH", cookie: other.cookie, params: { id: ep.id }, body: { enabled: false } })).status).toBe(404);

    // Test ping: signed with the rotated secret, returned as a delivery.
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const ping = await call(testEndpoint, { url: `/api/v1/webhooks/${ep.id}/test`, method: "POST", cookie: ctx.ws.cookie, params: { id: ep.id } });
    expect(ping.status).toBe(200);
    expect(ping.json).toMatchObject({ endpointId: ep.id, eventType: "ping", status: "delivered", attempts: 1, responseStatus: 200 });
    const init = fetchMock.mock.calls[0][1]!;
    const [, t, v1] = new Headers(init.headers).get("x-infera-signature")!.match(/^t=(\d+),v1=([0-9a-f]+)$/)!;
    expect(v1).toBe(createHmac("sha256", rotated.json.secret).update(`${t}.${init.body}`).digest("hex"));
    expect(JSON.parse(String(init.body))).toMatchObject({ id: ping.json.id, type: "ping", workspace_id: ctx.ws.workspaceId });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    const failedPing = await call(testEndpoint, { url: `/api/v1/webhooks/${ep.id}/test`, method: "POST", cookie: ctx.ws.cookie, params: { id: ep.id } });
    expect(failedPing.json).toMatchObject({ status: "failed", responseStatus: 404, error: "HTTP 404." });
    expect((await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, ep.id)))[0].failureCount).toBe(0);
    expect((await call(testEndpoint, { url: `/api/v1/webhooks/${ep.id}/test`, method: "POST", cookie: other.cookie, params: { id: ep.id } })).status).toBe(404);

    expect((await call(deleteEndpoint, { url: `/api/v1/webhooks/${ep.id}`, method: "DELETE", cookie: other.cookie, params: { id: ep.id } })).status).toBe(404);
    expect((await call(deleteEndpoint, { url: `/api/v1/webhooks/${ep.id}`, method: "DELETE", cookie: ctx.ws.cookie, params: { id: ep.id } })).status).toBe(204);
    expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, ep.id))).toHaveLength(0);
    const actions = (await db.select().from(auditLog).where(eq(auditLog.targetId, ep.id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["webhook.create", "webhook.update", "webhook.test", "webhook.delete"]));
    expect(JSON.stringify(await db.select().from(auditLog).where(eq(auditLog.targetId, ep.id)))).not.toContain(ep.secret);
  });
});

/* ------------------------------ Automation API ---------------------------- */

describe("automations API", () => {
  it("CRUD with roles, scopes, validation and tenancy", async () => {
    const ctx = await setup();
    const other = await setup();
    const viewer = await addMember(ctx.ws.workspaceId, "viewer");
    const member = await addMember(ctx.ws.workspaceId, "member");
    const body = {
      name: "Hot leads",
      trigger: { type: "message.processed", categories: ["sales_enquiry"] },
      conditions: [{ field: "priority", op: "in", value: ["high", "urgent"] }],
      actions: [{ type: "notify", to: [member.userId], title: "Hot lead" }],
    };
    expect((await call(createAutomation, { url: "/api/v1/automations", cookie: member.cookie, body })).status).toBe(403);
    expect((await call(createAutomation, { url: "/api/v1/automations", apiKey: ctx.ws.apiKey, body })).status).toBe(403);
    const a = await newAutomation(ctx, body);
    expect(a).toMatchObject({ name: "Hot leads", enabled: true, runCount: 0, lastRunAt: null, conditions: body.conditions });

    expect((await call(listAutomations, { url: "/api/v1/automations", cookie: viewer.cookie })).json.items).toHaveLength(1);
    expect((await call(listAutomations, { url: "/api/v1/automations", apiKey: ctx.ws.apiKey })).status).toBe(200);
    expect((await call(listAutomations, { url: "/api/v1/automations", cookie: other.ws.cookie })).json.items).toHaveLength(0);
    expect((await call(getAutomation, { url: `/api/v1/automations/${a.id}`, cookie: viewer.cookie, params: { id: a.id } })).status).toBe(200);
    expect((await call(getAutomation, { url: `/api/v1/automations/${a.id}`, cookie: other.ws.cookie, params: { id: a.id } })).status).toBe(404);

    const bad = async (patch: Record<string, unknown>) => (await call(createAutomation, { url: "/api/v1/automations", cookie: ctx.ws.cookie, body: { ...body, ...patch } })).status;
    const leadsTrigger = { type: "record.updated", collectionId: ctx.cols.leads.id };
    expect(await bad({ trigger: leadsTrigger, conditions: [], actions: [{ type: "set_field", key: "nope", value: "x" }] })).toBe(422);
    expect(await bad({ trigger: leadsTrigger, conditions: [], actions: [{ type: "set_field", key: "status", value: "Teleported" }] })).toBe(422);
    expect(await bad({ trigger: { type: "message.processed" }, conditions: [], actions: [{ type: "set_field", key: "status", value: "Won" }] })).toBe(422);
    expect(await bad({ trigger: { type: "record.status_changed", collectionId: ctx.cols.leads.id, toStatus: "Teleported" } })).toBe(422);
    expect(await bad({ trigger: { type: "record.created", collectionId: other.cols.leads.id } })).toBe(404);
    expect(await bad({ actions: [{ type: "create_record", collectionId: other.cols.tasks.id, values: { task: "x" } }] })).toBe(404);
    expect(await bad({ actions: [{ type: "create_record", collectionId: ctx.cols.tasks.id, values: { nope: "x" } }] })).toBe(422);
    expect(await bad({ actions: [{ type: "notify", to: [other.ws.userId], title: "x" }] })).toBe(404);
    const foreignEp = await newEndpoint(other, ["record.created"]);
    expect(await bad({ actions: [{ type: "webhook", endpointId: foreignEp.id }] })).toBe(404);
    expect(await bad({ actions: [{ type: "reminder", afterMinutes: 0, title: "x" }] })).toBe(422);
    expect(await bad({ actions: [{ type: "reminder", afterMinutes: 43_201, title: "x" }] })).toBe(422);
    expect(await bad({ actions: [{ type: "launch_rocket" }] })).toBe(422);
    expect(await bad({ actions: [] })).toBe(422);
    expect(await bad({ actions: Array.from({ length: 11 }, () => ({ type: "notify", to: "all", title: "x" })) })).toBe(422);
    expect(await bad({ conditions: Array.from({ length: 21 }, () => ({ field: "priority", op: "eq", value: "high" })) })).toBe(422);
    expect(await bad({ conditions: [{ field: "amount", op: "gt", value: "lots" }] })).toBe(422);
    expect(await bad({ trigger: { type: "schedule.daily" } })).toBe(422);
    expect(await bad({ name: "   " })).toBe(422);

    // PATCH: partial update, re-validated, audited; tenancy.
    const p = await call(patchAutomation, { url: `/api/v1/automations/${a.id}`, method: "PATCH", cookie: ctx.ws.cookie, params: { id: a.id }, body: { enabled: false, name: "Hot leads (paused)" } });
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ enabled: false, name: "Hot leads (paused)" });
    expect((await call(patchAutomation, { url: `/api/v1/automations/${a.id}`, method: "PATCH", cookie: ctx.ws.cookie, params: { id: a.id }, body: { actions: [{ type: "set_field", key: "x", value: 1 }] } })).status).toBe(422);
    expect((await call(patchAutomation, { url: `/api/v1/automations/${a.id}`, method: "PATCH", cookie: other.ws.cookie, params: { id: a.id }, body: { enabled: true } })).status).toBe(404);
    expect((await call(patchAutomation, { url: `/api/v1/automations/${a.id}`, method: "PATCH", cookie: member.cookie, params: { id: a.id }, body: { enabled: true } })).status).toBe(403);

    expect((await call(deleteAutomation, { url: `/api/v1/automations/${a.id}`, method: "DELETE", cookie: other.ws.cookie, params: { id: a.id } })).status).toBe(404);
    expect((await call(deleteAutomation, { url: `/api/v1/automations/${a.id}`, method: "DELETE", cookie: ctx.ws.cookie, params: { id: a.id } })).status).toBe(204);
    expect((await call(getAutomation, { url: `/api/v1/automations/${a.id}`, cookie: ctx.ws.cookie, params: { id: a.id } })).status).toBe(404);
    const db = await getDb();
    const audit = (await db.select().from(auditLog).where(eq(auditLog.targetId, a.id))).map((x) => x.action);
    expect(audit).toEqual(expect.arrayContaining(["automation.create", "automation.update", "automation.delete"]));
  });

  it("dry-run test endpoint explains conditions and actions without side effects", async () => {
    const ctx = await setup({ settings: { allowExternalActions: false } });
    const other = await setup();
    const db = await getDb();
    const ep = await newEndpoint(ctx, ["review.created"]);
    const a = await newAutomation(ctx, {
      name: "Big budget",
      trigger: { type: "record.updated", collectionId: ctx.cols.leads.id },
      conditions: [
        { field: "budget", op: "gte", value: 10000 },
        { field: "status", op: "neq", value: "Lost" },
      ],
      actions: [
        { type: "notify", to: "admins", title: "Big lead" },
        { type: "webhook", endpointId: ep.id },
        { type: "set_field", key: "next", value: "Send proposal" },
      ],
    });
    const c = await chat(ctx);
    const big = await createRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.cols.leads, values: { name: "A", interest: "Villa", budget: 50000, status: "Qualified" }, contactId: c.contact.id, origin: "manual", actor: ctx.user });
    const small = await createRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.cols.leads, values: { name: "B", interest: "Chair", budget: 500 }, origin: "manual", actor: ctx.user });
    const runTest = (recordId: string, cookie = ctx.ws.cookie) => call(testAutomation, { url: `/api/v1/automations/${a.id}/test`, cookie, params: { id: a.id }, body: { recordId } });

    const yes = await runTest(big.record.id);
    expect(yes.status).toBe(200);
    expect(yes.json).toMatchObject({ matched: true, triggerMatched: true, sample: { eventType: "record.updated", recordId: big.record.id } });
    expect(yes.json.conditionResults).toEqual([
      { field: "budget", op: "gte", value: 10000, actual: 50000, pass: true },
      { field: "status", op: "neq", value: "Lost", actual: "Qualified", pass: true },
    ]);
    expect(yes.json.actions).toEqual([
      { type: "notify", wouldRun: true },
      { type: "webhook", wouldRun: false, reason: EXTERNAL_DISABLED },
      { type: "set_field", wouldRun: true },
    ]);
    const no = await runTest(small.record.id);
    expect(no.json.matched).toBe(false);
    expect(no.json.conditionResults[0]).toMatchObject({ actual: 500, pass: false });
    expect(no.json.actions.every((x: { wouldRun: boolean }) => !x.wouldRun)).toBe(true);

    expect((await runTest(other.cols.leads.id)).status).toBe(404);
    expect((await call(testAutomation, { url: `/api/v1/automations/${a.id}/test`, cookie: other.ws.cookie, params: { id: a.id }, body: {} })).status).toBe(404);
    // Nothing was written.
    expect(await runsOf(a.id)).toHaveLength(0);
    expect(await notificationsOf(ctx.ws.workspaceId)).toHaveLength(0);
    const [row] = await db.select().from(records).where(eq(records.id, big.record.id));
    expect(row.values.next ?? null).toBeNull();
  });

  it("templates are ready-made, bound to the workspace's collections and valid", async () => {
    const ctx = await setup({ templates: ["leads", "payments"] });
    const res = await call(listTemplates, { url: "/api/v1/automations/templates", cookie: ctx.ws.cookie });
    expect(res.status).toBe(200);
    const items = res.json.items as { key: string; available: boolean; trigger: { collectionId?: string }; name: string; conditions: unknown[]; actions: unknown[]; description: string }[];
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.map((t) => t.key)).toEqual(expect.arrayContaining(["high_priority_lead", "pending_payment_follow_up", "new_complaint"]));
    expect(items.find((t) => t.key === "pending_payment_follow_up")!.trigger.collectionId).toBe(ctx.cols.payments.id);
    for (const t of items.filter((x) => x.available)) {
      const r = await call(createAutomation, { url: "/api/v1/automations", cookie: ctx.ws.cookie, body: { name: t.name, description: t.description, trigger: t.trigger, conditions: t.conditions, actions: t.actions } });
      expect(r.status, `${t.key}: ${JSON.stringify(r.json)}`).toBe(201);
    }
    const bare = await setup({ templates: ["tasks"] });
    const r2 = await call(listTemplates, { url: "/api/v1/automations/templates", apiKey: bare.ws.apiKey });
    expect(r2.json.items.find((t: { key: string }) => t.key === "deal_won")).toMatchObject({ available: false, note: expect.stringContaining("Leads") });
  });
});

/* --------------------------- Schedule & retention -------------------------- */

describe("schedule tick", () => {
  it("runs daily automations at their hour in the workspace timezone, once per day", async () => {
    const ctx = await setup({ settings: { timezone: "Asia/Kolkata" } });
    const db = await getDb();
    const now = new Date("2026-11-19T03:40:00Z"); // 09:10 in Kolkata
    expect(localClock(now, "Asia/Kolkata")).toEqual({ hour: 9, date: "2026-11-19" });
    expect(localClock(now, "Not/AZone")).toEqual({ hour: 3, date: "2026-11-19" });
    // `reply` needs a conversation — rejected for daily schedules at validation time.
    const rejected = await call(createAutomation, { url: "/api/v1/automations", cookie: ctx.ws.cookie, body: { name: "x", trigger: { type: "schedule.daily", hour: 9 }, actions: [{ type: "reply", text: "x" }] } });
    expect(rejected.status).toBe(422);
    const a = await newAutomation(ctx, {
      name: "Morning check",
      trigger: { type: "schedule.daily", hour: 9 },
      actions: [
        { type: "notify", to: "all", title: "Review queue check {{date}}" },
        { type: "create_record", collectionId: ctx.cols.tasks.id, values: { task: "Daily follow-ups {{date}}" } },
      ],
    });
    const later = await newAutomation(ctx, { name: "Evening", trigger: { type: "schedule.daily", hour: 18 }, actions: [{ type: "notify", to: "all", title: "Evening" }] });

    await handleScheduleTick(now);
    await handleScheduleTick(new Date(now.getTime() + 10 * 60_000)); // same hour again → no duplicate
    const runs = await runsOf(a.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "success", triggerType: "schedule.daily", domainEventId: `daily:${a.id}:2026-11-19` });
    expect(await runsOf(later.id)).toHaveLength(0);
    const notes = await notificationsOf(ctx.ws.workspaceId);
    expect(notes).toEqual([expect.objectContaining({ title: "Review queue check 2026-11-19", userId: null, link: `/console/automations/${a.id}` })]);
    const tasks = await db.select().from(records).where(eq(records.collectionId, ctx.cols.tasks.id));
    expect(tasks.map((t) => t.values.task)).toEqual(["Daily follow-ups 2026-11-19"]);

    // Next day → runs again.
    await handleScheduleTick(new Date(now.getTime() + 24 * 3_600_000));
    expect(await runsOf(a.id)).toHaveLength(2);
  });
});

describe("retention sweep", () => {
  it("deletes messages older than retentionDays (files + events cascade), keeps records, evidence and newer messages", async () => {
    const ctx = await setup({ settings: { retentionDays: 30 } });
    const keepAll = await setup({ settings: { retentionDays: null } });
    const db = await getDb();
    const c = await chat(ctx);
    const old = await message(ctx, c, { text: "old order", sentAt: new Date(Date.now() - 40 * 86_400_000) });
    const fresh = await message(ctx, c, { text: "new order", sentAt: new Date(Date.now() - 86_400_000) });
    await db.insert(files).values({ id: newId("fil"), workspaceId: ctx.ws.workspaceId, messageId: old.messageId, name: "a.jpg", mime: "image/jpeg", size: 3, sha256: "x", data: Buffer.from("abc") });
    const rec = await createRecord(db, {
      workspaceId: ctx.ws.workspaceId,
      collection: ctx.cols.leads,
      values: { name: "Rahul", interest: "Sofa" },
      origin: "pipeline",
      actor: PIPELINE_ACTOR,
      sources: [{ messageId: old.messageId, eventId: old.eventId, fieldKey: "interest", evidence: "a sofa", confidence: 0.9 }],
    });
    const c2 = await chat(keepAll);
    const otherOld = await message(keepAll, c2, { sentAt: new Date(Date.now() - 400 * 86_400_000) });

    await handleRetentionSweep();

    const ids = (await db.select({ id: messages.id }).from(messages)).map((m) => m.id);
    expect(ids).not.toContain(old.messageId);
    expect(ids).toContain(fresh.messageId);
    expect(ids).toContain(otherOld.messageId);
    expect(opened(await db.select().from(files).where(eq(files.messageId, old.messageId)))).toHaveLength(0);
    expect(await db.select().from(events).where(eq(events.id, old.eventId))).toHaveLength(0);
    expect(await db.select().from(records).where(eq(records.id, rec.record.id))).toHaveLength(1);
    const [src] = await db.select().from(recordSources).where(eq(recordSources.recordId, rec.record.id));
    expect(src).toMatchObject({ messageId: null, evidence: "a sofa" });
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.workspaceId, ctx.ws.workspaceId), eq(auditLog.action, "retention.sweep")));
    expect(audit.after).toEqual({ count: 1 });
    expect(await db.select().from(auditLog).where(and(eq(auditLog.workspaceId, keepAll.ws.workspaceId), eq(auditLog.action, "retention.sweep")))).toHaveLength(0);
  });
});

/* ------------------------------ Notifications ----------------------------- */

describe("notifications", () => {
  it("notify() addresses all / admins / members only; the API shows the user's own and shared rows", async () => {
    const ctx = await setup();
    const other = await setup();
    const db = await getDb();
    const admin = await addMember(ctx.ws.workspaceId, "admin");
    const member = await addMember(ctx.ws.workspaceId, "member");
    expect(await notify(db, { workspaceId: ctx.ws.workspaceId, userIds: "all", type: "info", title: "Everyone", link: "javascript:alert(1)" })).toBe(1);
    expect(await notify(db, { workspaceId: ctx.ws.workspaceId, userIds: "admins", type: "info", title: "Admins" })).toBe(2);
    expect(await notify(db, { workspaceId: ctx.ws.workspaceId, userIds: [member.userId, other.ws.userId], type: "info", title: "Member", link: "/console/review" })).toBe(1);
    expect(safeLink("//evil.example")).toBeNull();
    const rows = await notificationsOf(ctx.ws.workspaceId);
    expect(rows.find((r) => r.title === "Everyone")).toMatchObject({ userId: null, link: null });
    expect(rows.filter((r) => r.title === "Admins").map((r) => r.userId).sort()).toEqual([ctx.ws.userId, admin.userId].sort());
    expect(rows.filter((r) => r.title === "Member").map((r) => r.userId)).toEqual([member.userId]);

    const mine = await call(listNotifications, { url: "/api/v1/notifications", cookie: member.cookie });
    expect(mine.status).toBe(200);
    expect(mine.json.items.map((n: { title: string }) => n.title).sort()).toEqual(["Everyone", "Member"]);
    expect(mine.json.unread).toBe(2);
    const own = mine.json.items.find((n: { title: string }) => n.title === "Member");
    expect(own).toMatchObject({ link: "/console/review", readAt: null });

    expect((await call(readNotifications, { url: "/api/v1/notifications/read", cookie: member.cookie, body: {} })).status).toBe(422);
    // Can't mark someone else's notification.
    const adminRow = rows.find((r) => r.userId === admin.userId)!;
    expect((await call(readNotifications, { url: "/api/v1/notifications/read", cookie: member.cookie, body: { ids: [adminRow.id] } })).json).toEqual({ updated: 0 });
    expect((await call(readNotifications, { url: "/api/v1/notifications/read", cookie: member.cookie, body: { ids: [own.id] } })).json).toEqual({ updated: 1 });
    const unread = await call(listNotifications, { url: "/api/v1/notifications?unread=1", cookie: member.cookie });
    expect(unread.json.items.map((n: { title: string }) => n.title)).toEqual(["Everyone"]);
    expect(unread.json.unread).toBe(1);
    expect((await call(readNotifications, { url: "/api/v1/notifications/read", cookie: member.cookie, body: { all: true } })).json).toEqual({ updated: 1 });
    expect((await call(listNotifications, { url: "/api/v1/notifications?unread=1", cookie: member.cookie })).json.items).toHaveLength(0);

    // Pagination, tenancy, session only.
    const page = await call(listNotifications, { url: "/api/v1/notifications?limit=1", cookie: ctx.ws.cookie });
    expect(page.json.items).toHaveLength(1);
    expect(page.json.nextCursor).toEqual(expect.any(String));
    const page2 = await call(listNotifications, { url: `/api/v1/notifications?limit=1&cursor=${page.json.nextCursor}`, cookie: ctx.ws.cookie });
    expect(page2.json.items[0].id).not.toBe(page.json.items[0].id);
    expect((await call(listNotifications, { url: "/api/v1/notifications", cookie: other.ws.cookie })).json.items).toHaveLength(0);
    expect((await call(listNotifications, { url: "/api/v1/notifications", apiKey: ctx.ws.apiKey })).status).toBe(403);
  });
});

/* ---------------------------------- Cron ---------------------------------- */

describe("cron", () => {
  it("requires the bearer secret; 503 when unset in production", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call(cronGet, { url: "/api/cron" })).status).toBe(401);
    vi.stubEnv("NODE_ENV", "production");
    expect((await call(cronGet, { url: "/api/cron" })).status).toBe(503);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    expect((await call(cronGet, { url: "/api/cron" })).status).toBe(401);
    expect((await call(cronGet, { url: "/api/cron", headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    vi.stubGlobal("fetch", okFetch());
    const ok = await call(cronPost, { url: "/api/cron", method: "POST", headers: { authorization: "Bearer cron-secret-value" } });
    expect(ok.status).toBe(200);
    expect(ok.json.ran).toBeGreaterThanOrEqual(2); // schedule tick + retention sweep at least
  });
});
