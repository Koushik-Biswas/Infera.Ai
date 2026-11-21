import { beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/lib/server/db";
import {
  auditLog,
  channels,
  collections,
  contacts,
  conversations,
  events,
  jobs,
  messages,
  records,
  recordSources,
  reviewItems,
  workspaces,
  type CollectionRow,
} from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { newToken } from "@/lib/server/crypto";
import { templatePlan } from "@/lib/server/templates";
import { softDeleteRecord, updateRecord } from "@/lib/server/records/ops";
import { drainJobs, enqueue } from "@/lib/server/jobs/queue";
import { processEvent, dryRunProcess } from "@/lib/server/pipeline/run";
import { applyProposedOperation } from "@/lib/server/pipeline/apply";
import { classifyRules } from "@/lib/server/pipeline/classify";
import { selfIntroduction, amountIn } from "@/lib/server/pipeline/extract";
import { GET as getEvent } from "@/app/api/v1/events/[id]/route";
import { POST as reprocess } from "@/app/api/v1/events/[id]/reprocess/route";
import { POST as playground } from "@/app/api/v1/playground/route";
import { POST as backfill } from "@/app/api/v1/collections/[id]/backfill/route";
import { defaultWorkspaceSettings, type TemplateId, type WorkspaceSettings } from "@/lib/shared/types";
import { addMember, call, createTestWorkspace, type TestWorkspace, opened } from "./helpers";

type Ctx = { ws: TestWorkspace; cols: Record<string, CollectionRow>; channelId: string };

async function setup(opts: { templates?: Exclude<TemplateId, "custom">[]; settings?: Partial<WorkspaceSettings> } = {}): Promise<Ctx> {
  const ws = await createTestWorkspace();
  const db = await getDb();
  await db
    .update(workspaces)
    .set({ settings: { ...defaultWorkspaceSettings, aiMode: "off", ...opts.settings } })
    .where(eq(workspaces.id, ws.workspaceId));
  const cols: Record<string, CollectionRow> = {};
  for (const t of opts.templates ?? ["leads", "orders", "payments", "support", "tasks"]) {
    const p = templatePlan(t);
    const [row] = await db
      .insert(collections)
      .values({ id: newId("col"), workspaceId: ws.workspaceId, name: p.name, description: p.description, icon: p.icon, template: p.template, fields: p.fields, routing: p.routing, matchFields: p.matchFields })
      .returning();
    cols[t] = row;
  }
  const [ch] = await db
    .insert(channels)
    .values({ id: newId("chn"), workspaceId: ws.workspaceId, type: "whatsapp_cloud", name: "WhatsApp", webhookToken: newToken(16) })
    .returning();
  return { ws, cols, channelId: ch.id };
}

let phoneSeq = 1000;
async function newChat(ctx: Ctx, name = "Rahul") {
  const db = await getDb();
  const phone = `+9198765${String(phoneSeq++).padStart(5, "0")}`;
  const [contact] = await db.insert(contacts).values({ id: newId("ctc"), workspaceId: ctx.ws.workspaceId, displayName: name, phone }).returning();
  const [conv] = await db
    .insert(conversations)
    .values({ id: newId("cnv"), workspaceId: ctx.ws.workspaceId, channelId: ctx.channelId, externalId: phone.slice(1), title: name, contactId: contact.id })
    .returning();
  return { contact, conv, name };
}

let msgSeq = 0;
async function say(ctx: Ctx, chat: Awaited<ReturnType<typeof newChat>>, text: string, opts: { direction?: "inbound" | "outbound"; at?: Date; kind?: "text" | "image" | "deleted" } = {}) {
  const db = await getDb();
  const messageId = newId("msg");
  const eventId = newId("evt");
  const dir = opts.direction ?? "inbound";
  await db.insert(messages).values({
    id: messageId,
    workspaceId: ctx.ws.workspaceId,
    channelId: ctx.channelId,
    conversationId: chat.conv.id,
    contactId: chat.contact.id,
    externalId: `wamid.${++msgSeq}`,
    direction: dir,
    senderName: dir === "inbound" ? chat.name : "Acme Store",
    senderHandle: dir === "inbound" ? chat.contact.phone!.slice(1) : null,
    kind: opts.kind ?? "text",
    text,
    sentAt: opts.at ?? new Date(Date.now() - 1000 * (100 - msgSeq)),
    status: "queued",
    eventId,
  });
  await db.insert(events).values({ id: eventId, workspaceId: ctx.ws.workspaceId, messageId, source: "whatsapp", status: "queued" });
  return { messageId, eventId };
}

async function recordsOf(collectionId: string) {
  const db = await getDb();
  return db.select().from(records).where(eq(records.collectionId, collectionId));
}

async function countRows() {
  const db = await getDb();
  const n = async (t: typeof records | typeof events | typeof reviewItems | typeof messages | typeof recordSources | typeof auditLog | typeof jobs) => (await db.select({ n: count() }).from(t))[0].n;
  return { records: await n(records), events: await n(events), reviews: await n(reviewItems), messages: await n(messages), sources: await n(recordSources), audit: await n(auditLog), jobs: await n(jobs) };
}

async function domainEventTypes(workspaceId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select().from(jobs).where(and(eq(jobs.type, "domain_event"), eq(jobs.workspaceId, workspaceId)));
  return rows.map((j) => (j.payload as { type: string }).type);
}

/* ------------------------------------------------------------------ */

// PGlite start-up + migrations happen once per file; keep them out of the first test's timeout.
beforeAll(async () => {
  await getDb();
}, 180_000);

describe("rules classifier", () => {
  const c = (text: string, direction: "inbound" | "outbound" = "inbound") => classifyRules({ text, kind: "text", direction, attachments: [] });

  it("handles English and Hinglish business phrasing", () => {
    expect(c("Hi, my name is Rahul. I want to buy 2 blue shirts, what's the price?")).toMatchObject({ category: "sales_enquiry", intent: "purchase_interest", priority: "high" });
    expect(c("ye kurta kitna ka hai?")).toMatchObject({ category: "sales_enquiry", intent: "price_request" });
    expect(c("price?")).toMatchObject({ category: "sales_enquiry" });
    expect(c("red saree available hai?")).toMatchObject({ category: "sales_enquiry", intent: "availability_check" });
    expect(c("2 kurta bhej do, Andheri")).toMatchObject({ category: "order", intent: "place_order" });
    expect(c("payment kar diya UPI se")).toMatchObject({ category: "payment", intent: "payment_confirmation" });
    expect(c("I paid 1200 via GPay just now")).toMatchObject({ category: "payment", intent: "payment_confirmation" });
    expect(c("will pay tomorrow")).toMatchObject({ category: "payment", intent: "payment_promise" });
    expect(c("order delivered nahi hua abhi tak")).toMatchObject({ category: "support", intent: "complaint", priority: "high" });
    expect(c("URGENT: the parcel came damaged, I want a refund. Worst service!!")).toMatchObject({ category: "support", priority: "urgent" });
    expect(c("Can we schedule a site visit tomorrow?")).toMatchObject({ category: "appointment" });
    expect(c("Please send the invoice by Friday")).toMatchObject({ category: "follow_up", intent: "task_request" });
    expect(c("Your order has been shipped, tracking id AWB123", "outbound")).toMatchObject({ category: "order", intent: "order_status" });
  });

  it("skippable chit-chat and spam are confident", () => {
    expect(c("ok thanks 👍")).toMatchObject({ category: "general", intent: "acknowledgement", priority: "low" });
    expect(c("👍").confidence).toBeGreaterThanOrEqual(0.85);
    expect(c("Hello sir, good morning")).toMatchObject({ intent: "greeting" });
    const spam = c("Congratulations! You have won a lottery of Rs 25,00,000. Click here to claim your prize http://bit.ly/x");
    expect(spam.category).toBe("spam");
    expect(spam.confidence).toBeGreaterThanOrEqual(0.85);
    expect(c("Get an instant loan at low interest, click here").category).toBe("spam");
  });

  it("extracts names and amounts with verbatim evidence", () => {
    expect(selfIntroduction("Hi, my name is Rahul. I want shirts")).toEqual({ name: "Rahul", evidence: "my name is Rahul", confidence: 0.95 });
    expect(selfIntroduction("mera naam amit hai")?.name).toBe("Amit");
    expect(selfIntroduction("I am interested in sofas")).toBeNull();
    expect(amountIn("I paid 1200 via GPay")).toMatchObject({ value: 1200, evidence: "paid 1200" });
    expect(amountIn("Total ₹1,500 only")).toMatchObject({ value: 1500 });
    expect(amountIn("my budget is 50k")).toMatchObject({ value: 50000 });
    expect(amountIn("I want 2 shirts")).toBeNull();
  });
});

describe("processEvent", () => {
  it("spec example: sales enquiry → verified Lead with evidence, audit, domain events", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx, "Rahul Sharma");
    const { eventId, messageId } = await say(ctx, chat, "Hi, my name is Rahul. I want to buy 2 blue shirts, what's the price?");

    const r = await processEvent(eventId);
    expect(r).toMatchObject({
      event_id: eventId,
      status: "processed",
      source: "whatsapp",
      message_classification: { category: "sales_enquiry", intent: "purchase_interest", method: "rules" },
      requires_human_review: false,
      automation: [],
      processing_metadata: { model: null, ai_used: false },
    });
    expect(["medium", "high"]).toContain(r.message_classification.priority);
    expect(r.processing_metadata.processed_at).toEqual(expect.any(String));
    const name = r.extracted_entities.find((e) => (e.field === "name" || e.field === "customer_name") && e.value === "Rahul");
    expect(name).toBeDefined();
    expect(name!.evidence).toMatch(/^my name is Rahul$/i);
    expect(name!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.extracted_entities.find((e) => e.field === "customer_name")).toMatchObject({ value: "Rahul", evidence: "my name is Rahul", method: "rules", collection_id: null });
    expect(r.record_operation).toMatchObject({ action: "CREATE_RECORD", collection: "Leads and deals", collection_id: ctx.cols.leads.id, status: "completed", verified: true });
    expect(r.record_operation!.record_id).toMatch(/^rec_/);
    expect(r.source_references[0]).toMatchObject({ message_id: messageId, conversation_id: chat.conv.id, channel_id: ctx.channelId });
    expect(r.processing_metadata.steps.map((s) => s.name)).toEqual(expect.arrayContaining(["load", "validate", "classify", "ai", "extract", "execute", "verify"]));

    const [lead] = await recordsOf(ctx.cols.leads.id);
    expect(lead.id).toBe(r.record_operation!.record_id);
    expect(lead.values).toMatchObject({ name: "Rahul", interest: "2 blue shirts", status: "New lead", phone: chat.contact.phone });
    expect(lead.contactId).toBe(chat.contact.id);
    expect(lead.fieldMeta.name).toMatchObject({ source: "extracted", method: "rules", evidence: "my name is Rahul", messageId, eventId });
    expect(lead.fieldMeta.phone).toMatchObject({ evidence: null, confidence: 0.95 });

    const db = await getDb();
    const sources = await db.select().from(recordSources).where(eq(recordSources.recordId, lead.id));
    expect(sources.find((s) => s.fieldKey === "name")).toMatchObject({ messageId, eventId, evidence: "my name is Rahul" });
    expect(sources.find((s) => s.fieldKey === null)).toMatchObject({ messageId, eventId });

    const audits = await db.select().from(auditLog).where(eq(auditLog.workspaceId, ctx.ws.workspaceId));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["record.create", "event.process"]));
    const evAudit = audits.find((a) => a.action === "event.process")!;
    expect(evAudit.meta).toMatchObject({ messageId, sources: [{ messageId, eventId }] });
    expect(JSON.stringify(evAudit.meta)).not.toContain("Rahul");

    expect(await domainEventTypes(ctx.ws.workspaceId)).toEqual(expect.arrayContaining(["record.created", "message.processed"]));

    const [ev] = await db.select().from(events).where(eq(events.id, eventId));
    expect(ev).toMatchObject({ status: "processed", attempts: 1, error: null });
    expect(ev.result).toEqual(r);
    expect(ev.processedAt).toBeInstanceOf(Date);
    const [m] = opened(await db.select().from(messages).where(eq(messages.id, messageId)));
    expect(m.status).toBe("processed");
    expect(m.classification).toMatchObject({ category: "sales_enquiry" });
  });

  it("returns the stored result for processed events and re-runs idempotently when forced", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx);
    const { eventId } = await say(ctx, chat, "Hi, my name is Rahul. I want to buy 2 blue shirts, what's the price?");
    const first = await processEvent(eventId);
    const before = await countRows();

    const again = await processEvent(eventId);
    expect(again).toEqual(first);
    expect(await countRows()).toEqual(before);
    const db = await getDb();
    expect((await db.select().from(events).where(eq(events.id, eventId)))[0].attempts).toBe(1);

    const forced = await processEvent(eventId, { force: true });
    expect(forced.status).toBe("processed");
    expect(forced.record_operation).toMatchObject({ action: "NO_OP", record_id: first.record_operation!.record_id, verified: true });
    const leads = await recordsOf(ctx.cols.leads.id);
    expect(leads).toHaveLength(1);
    expect(leads[0].version).toBe(1);
    const types = await domainEventTypes(ctx.ws.workspaceId);
    expect(types.filter((t) => t === "message.processed")).toHaveLength(1);
    expect(types.filter((t) => t === "record.created")).toHaveLength(1);
  });

  it("payment follow-up creates a Payment and moves the contact's open Order to Paid", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx);
    await processEvent((await say(ctx, chat, "Hi, my name is Rahul. I want to buy 2 blue shirts, what's the price?")).eventId);
    const order = await processEvent((await say(ctx, chat, "Please confirm my order: 2 blue shirts, deliver to Andheri West")).eventId);
    expect(order.message_classification).toMatchObject({ category: "order", intent: "place_order" });
    expect(order.record_operation).toMatchObject({ action: "CREATE_RECORD", collection_id: ctx.cols.orders.id, status: "completed" });
    const [o] = await recordsOf(ctx.cols.orders.id);
    expect(o.values).toMatchObject({ purchase: "Blue shirts", qty: 2, status: "Confirmed", address: "Andheri West", customer: "Rahul" });

    const pay = await processEvent((await say(ctx, chat, "I paid 1200 via GPay just now")).eventId);
    expect(pay.message_classification).toMatchObject({ category: "payment", intent: "payment_confirmation" });
    expect(pay.status).toBe("processed");
    const payOp = pay.record_operations.find((x) => x.collection_id === ctx.cols.payments.id)!;
    expect(payOp).toMatchObject({ action: "CREATE_RECORD", status: "completed", verified: true });
    const orderOp = pay.record_operations.find((x) => x.collection_id === ctx.cols.orders.id)!;
    expect(orderOp).toMatchObject({ action: "UPDATE_RECORD", record_id: o.id, status: "completed", verified: true });
    expect(orderOp.changes).toContainEqual({ field: "status", from: "Confirmed", to: "Paid" });
    expect(pay.extracted_entities).toContainEqual(expect.objectContaining({ field: "amount", value: 1200, evidence: "paid 1200", collection_id: ctx.cols.payments.id }));

    const [p] = await recordsOf(ctx.cols.payments.id);
    expect(p.values).toMatchObject({ amount: 1200, status: "Paid", method: "GPay", payer: "Rahul" });
    const [o2] = await recordsOf(ctx.cols.orders.id);
    expect(o2.status).toBe("Paid");
    expect(o2.values.amount ?? null).toBeNull(); // a payment doesn't rewrite the order's value
    expect(await domainEventTypes(ctx.ws.workspaceId)).toEqual(expect.arrayContaining(["record.status_changed"]));
    // Only one lead for the contact (the payment didn't touch it).
    expect(await recordsOf(ctx.cols.leads.id)).toHaveLength(1);
  });

  it("business replies move records forward but never create them", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx);
    const none = await processEvent((await say(ctx, chat, "Your order has been shipped, tracking id AWB12345", { direction: "outbound" })).eventId);
    expect(none.record_operations.every((o) => o.action === "NO_OP")).toBe(true);
    expect(await recordsOf(ctx.cols.orders.id)).toHaveLength(0);

    await processEvent((await say(ctx, chat, "Please confirm my order: 3 cotton kurtas")).eventId);
    const shipped = await processEvent((await say(ctx, chat, "Your order has been shipped, tracking id AWB12345", { direction: "outbound" })).eventId);
    expect(shipped.record_operation).toMatchObject({ action: "UPDATE_RECORD", collection_id: ctx.cols.orders.id });
    const [o] = await recordsOf(ctx.cols.orders.id);
    expect(o.values).toMatchObject({ status: "Shipped", customer: "Rahul" });
    // A late "confirm" doesn't move the order back.
    const late = await processEvent((await say(ctx, chat, "ok confirmed, go ahead")).eventId);
    expect(late.warnings.map((w) => w.code)).toContain("status_not_regressed");
    expect((await recordsOf(ctx.cols.orders.id))[0].status).toBe("Shipped");
  });

  it("skips chit-chat and spam without creating anything", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx);
    const { eventId, messageId } = await say(ctx, chat, "ok thanks 👍");
    const r = await processEvent(eventId);
    expect(r).toMatchObject({ status: "skipped", record_operation: null, record_operations: [], message_classification: { intent: "acknowledgement", priority: "low" } });
    const spam = await processEvent((await say(ctx, chat, "Congratulations! You have won a lottery of Rs 25,00,000. Click here to claim your prize http://bit.ly/x")).eventId);
    expect(spam).toMatchObject({ status: "skipped", message_classification: { category: "spam" }, record_operations: [] });
    const db = await getDb();
    expect(await db.select().from(records).where(eq(records.workspaceId, ctx.ws.workspaceId))).toHaveLength(0);
    expect((opened(await db.select().from(messages).where(eq(messages.id, messageId))))[0].status).toBe("skipped");
    expect(await domainEventTypes(ctx.ws.workspaceId)).not.toContain("message.processed");

    const deleted = await processEvent((await say(ctx, chat, "", { kind: "deleted" })).eventId);
    expect(deleted.status).toBe("skipped");
  });

  it("a human-edited value is never overwritten: conflict → review item", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx);
    const first = await processEvent((await say(ctx, chat, "Hi, my name is Rahul. I want to buy 2 blue shirts, what's the price?")).eventId);
    const db = await getDb();
    await updateRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.cols.leads, recordId: first.record_operation!.record_id!, patch: { interest: "Red shirts" }, mode: "human", actor: { type: "user", id: ctx.ws.userId } });

    const r = await processEvent((await say(ctx, chat, "Actually I want to buy 3 blue shirts")).eventId);
    expect(r.status).toBe("needs_review");
    expect(r.requires_human_review).toBe(true);
    expect(r.record_operation).toMatchObject({ action: "PENDING_REVIEW", status: "needs_review", record_id: first.record_operation!.record_id });
    expect(r.record_operation!.conflicts).toEqual([{ field: "interest", existing: "Red shirts", proposed: "3 blue shirts", reason: "human_edited" }]);
    const items = await db.select().from(reviewItems).where(eq(reviewItems.workspaceId, ctx.ws.workspaceId));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "conflict", status: "open", recordId: first.record_operation!.record_id, collectionId: ctx.cols.leads.id });
    expect(items[0].proposed).toMatchObject({ action: "UPDATE_RECORD", values: { interest: "3 blue shirts" } });
    expect(r.review_item_ids).toEqual([items[0].id]);
    expect((await recordsOf(ctx.cols.leads.id))[0].values.interest).toBe("Red shirts");
    expect(await domainEventTypes(ctx.ws.workspaceId)).toContain("review.created");

    // Re-processing refreshes the same review item instead of duplicating it.
    await processEvent(r.event_id, { force: true });
    expect(await db.select().from(reviewItems).where(eq(reviewItems.workspaceId, ctx.ws.workspaceId))).toHaveLength(1);

    // Approving the conflict applies the machine value over the edit.
    const op = await applyProposedOperation(db, { workspaceId: ctx.ws.workspaceId, proposed: items[0].proposed!, actor: { type: "user", id: ctx.ws.userId }, reviewItemId: items[0].id });
    expect(op).toMatchObject({ action: "UPDATE_RECORD", status: "completed", verified: true, review_item_id: items[0].id });
    expect((await recordsOf(ctx.cols.leads.id))[0].values.interest).toBe("3 blue shirts");
  });

  it("re-processing an older message never overwrites facts from newer messages", async () => {
    const ctx = await setup({ templates: ["leads"] });
    const chat = await newChat(ctx);
    const first = await say(ctx, chat, "I want to buy 2 blue shirts", { at: new Date(Date.now() - 120_000) });
    await processEvent(first.eventId);
    const second = await processEvent((await say(ctx, chat, "Sorry, I want to buy 3 red shirts instead", { at: new Date(Date.now() - 60_000) })).eventId);
    expect(second.record_operation).toMatchObject({ action: "UPDATE_RECORD" });
    expect((await recordsOf(ctx.cols.leads.id))[0].values.interest).toBe("3 red shirts");

    const again = await processEvent(first.eventId, { force: true });
    expect(again.record_operation).toMatchObject({ action: "NO_OP" });
    const [lead] = await recordsOf(ctx.cols.leads.id);
    expect(lead.values.interest).toBe("3 red shirts");
  });

  it("does not resurrect a record a person deleted", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx);
    const { eventId } = await say(ctx, chat, "Hi, my name is Rahul. I want to buy 2 blue shirts, what's the price?");
    const first = await processEvent(eventId);
    const db = await getDb();
    await softDeleteRecord(db, { workspaceId: ctx.ws.workspaceId, recordId: first.record_operation!.record_id!, actor: { type: "user", id: ctx.ws.userId } });

    const again = await processEvent(eventId, { force: true });
    expect(again.record_operation).toMatchObject({ action: "NO_OP", record_id: first.record_operation!.record_id });
    expect(again.warnings.map((w) => w.code)).toContain("record_deleted_by_user");
    const live = (await recordsOf(ctx.cols.leads.id)).filter((x) => !x.deletedAt);
    expect(live).toHaveLength(0);
  });

  it("missing required field → needs_review (missing_required); approval with the reviewer's value creates the record", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx, "Priya");
    const { eventId, messageId } = await say(ctx, chat, "I have sent the payment through PhonePe");
    const r = await processEvent(eventId);
    expect(r.message_classification.category).toBe("payment");
    expect(r.status).toBe("needs_review");
    expect(r.requires_human_review).toBe(true);
    expect(r.record_operation).toMatchObject({ action: "PENDING_REVIEW", collection_id: ctx.cols.payments.id, status: "needs_review", record_id: null, verified: false });
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: "missing_required", field: "amount" }));
    const db = await getDb();
    const [item] = await db.select().from(reviewItems).where(eq(reviewItems.workspaceId, ctx.ws.workspaceId));
    expect(item).toMatchObject({ kind: "missing_required", status: "open", messageId, eventId, collectionId: ctx.cols.payments.id, recordId: null });
    expect(item.proposed).toMatchObject({ action: "CREATE_RECORD", recordId: null, values: { method: "PhonePe", status: "Paid", payer: "Priya" }, contactId: chat.contact.id });
    expect((opened(await db.select().from(messages).where(eq(messages.id, messageId))))[0].status).toBe("needs_review");
    expect((await db.select().from(events).where(eq(events.id, eventId)))[0].status).toBe("needs_review");
    expect(await recordsOf(ctx.cols.payments.id)).toHaveLength(0);

    // Approving without the amount is refused; with it, the record is created and verified.
    await expect(applyProposedOperation(db, { workspaceId: ctx.ws.workspaceId, proposed: item.proposed!, actor: { type: "user", id: ctx.ws.userId }, reviewItemId: item.id })).rejects.toMatchObject({ status: 422 });
    const other = await createTestWorkspace();
    await expect(applyProposedOperation(db, { workspaceId: other.workspaceId, proposed: item.proposed!, actor: { type: "user", id: other.userId }, overrides: { amount: 750 }, reviewItemId: item.id })).rejects.toMatchObject({ status: 404 });
    const op = await applyProposedOperation(db, { workspaceId: ctx.ws.workspaceId, proposed: item.proposed!, actor: { type: "user", id: ctx.ws.userId }, overrides: { amount: 750 }, reviewItemId: item.id });
    expect(op).toMatchObject({ action: "CREATE_RECORD", collection_id: ctx.cols.payments.id, status: "completed", verified: true, review_item_id: item.id });
    const [p] = await recordsOf(ctx.cols.payments.id);
    expect(p.values).toMatchObject({ amount: 750, method: "PhonePe", status: "Paid" });
    expect(p.fieldMeta.amount).toMatchObject({ source: "manual", edited: true });
    expect(p.fieldMeta.method).toMatchObject({ source: "extracted", confidence: 1, messageId });
    expect(p.contactId).toBe(chat.contact.id);
    const src = await db.select().from(recordSources).where(eq(recordSources.recordId, p.id));
    expect(src.map((s) => s.messageId)).toContain(messageId);
  });

  it("values between the thresholds hold the operation for review (low_confidence)", async () => {
    const ctx = await setup({ templates: ["leads"], settings: { autoApplyThreshold: 0.9, reviewThreshold: 0.5 } });
    const chat = await newChat(ctx);
    const r = await processEvent((await say(ctx, chat, "Hi, my name is Rahul. I want to buy 2 blue shirts, what's the price?")).eventId);
    expect(r.status).toBe("needs_review");
    expect(r.record_operation).toMatchObject({ action: "PENDING_REVIEW", status: "needs_review" });
    const db = await getDb();
    const [item] = await db.select().from(reviewItems).where(eq(reviewItems.workspaceId, ctx.ws.workspaceId));
    expect(item.kind).toBe("low_confidence");
    expect(item.proposed?.values).toMatchObject({ interest: "2 blue shirts", name: "Rahul" });
    expect(await recordsOf(ctx.cols.leads.id)).toHaveLength(0);
  });

  it("uses the conversation for a payment without an amount, citing the earlier message", async () => {
    const ctx = await setup({ templates: ["payments"] });
    const chat = await newChat(ctx);
    const total = await say(ctx, chat, "Your total is ₹1,500 for the 2 shirts", { direction: "outbound" });
    await processEvent(total.eventId);
    const r = await processEvent((await say(ctx, chat, "Done, paid on UPI")).eventId);
    expect(r.record_operation).toMatchObject({ action: "CREATE_RECORD", status: "completed" });
    expect(r.extracted_entities).toContainEqual(expect.objectContaining({ field: "amount", value: 1500, evidence: "total is ₹1,500", method: "rules" }));
    expect(r.source_references.map((s) => s.message_id)).toContain(total.messageId);
    const [p] = await recordsOf(ctx.cols.payments.id);
    expect(p.values).toMatchObject({ amount: 1500, status: "Paid", method: "UPI" });
    expect(p.fieldMeta.amount.messageId).toBe(total.messageId);
  });

  it("runs from the job queue and records failures without PII", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx);
    const { eventId } = await say(ctx, chat, "I want to order 5 steel bottles, deliver to Pune 411001");
    const db = await getDb();
    await enqueue(db, { type: "process_message", payload: { eventId }, workspaceId: ctx.ws.workspaceId, priority: 10 });
    await drainJobs({ types: ["process_message"] });
    const [ev] = await db.select().from(events).where(eq(events.id, eventId));
    expect(ev.status).toBe("processed");
    const [o] = await recordsOf(ctx.cols.orders.id);
    expect(o.values).toMatchObject({ purchase: "Steel bottles", qty: 5 });

    // An event whose message vanished ends the job quietly.
    await enqueue(db, { type: "process_message", payload: { eventId: "evt_doesnotexist0000000" }, priority: 10 });
    await drainJobs({ types: ["process_message"] });
    const dead = await db.select().from(jobs).where(eq(jobs.status, "dead"));
    expect(dead).toHaveLength(0);
  });
});

describe("pipeline routes", () => {
  it("GET /api/v1/events/:id is tenant-scoped", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx);
    const { eventId, messageId } = await say(ctx, chat, "Hi, my name is Rahul. I want to buy 2 blue shirts, what's the price?");
    await processEvent(eventId);
    const ok = await call(getEvent, { url: `/api/v1/events/${eventId}`, params: { id: eventId }, cookie: ctx.ws.cookie });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ id: eventId, messageId, source: "whatsapp", status: "processed", attempts: 1, result: { event_id: eventId, status: "processed" } });
    expect((await call(getEvent, { url: `/api/v1/events/${eventId}`, params: { id: eventId }, apiKey: ctx.ws.apiKey })).status).toBe(200);

    const other = await createTestWorkspace();
    expect((await call(getEvent, { url: `/api/v1/events/${eventId}`, params: { id: eventId }, cookie: other.cookie })).status).toBe(404);
    expect((await call(getEvent, { url: `/api/v1/events/${eventId}`, params: { id: eventId }, apiKey: other.apiKey })).status).toBe(404);
    expect((await call(getEvent, { url: `/api/v1/events/${eventId}`, params: { id: eventId } })).status).toBe(401);
  });

  it("POST /api/v1/events/:id/reprocess queues or runs inline (member+, tenant-scoped)", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx);
    const { eventId } = await say(ctx, chat, "I want to buy a wooden study table");
    await processEvent(eventId);

    const viewer = await addMember(ctx.ws.workspaceId, "viewer");
    expect((await call(reprocess, { url: `/x`, params: { id: eventId }, cookie: viewer.cookie, method: "POST" })).status).toBe(403);
    const other = await createTestWorkspace();
    expect((await call(reprocess, { url: `/x`, params: { id: eventId }, cookie: other.cookie, method: "POST" })).status).toBe(404);

    const sync = await call(reprocess, { url: `/x?sync=1`, params: { id: eventId }, cookie: ctx.ws.cookie, method: "POST" });
    expect(sync.status).toBe(200);
    expect(sync.json).toMatchObject({ id: eventId, status: "processed", attempts: 2, result: { record_operation: { action: "NO_OP" } } });

    const queued = await call(reprocess, { url: `/x`, params: { id: eventId }, apiKey: ctx.ws.apiKey, method: "POST" });
    expect(queued.status).toBe(202);
    expect(queued.json).toEqual({ eventId, status: "queued" });
    await drainJobs({ types: ["process_message"] });
    const db = await getDb();
    const [ev] = await db.select().from(events).where(eq(events.id, eventId));
    expect(ev).toMatchObject({ status: "processed", attempts: 3 });
    expect(await recordsOf(ctx.cols.leads.id)).toHaveLength(1);
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.workspaceId, ctx.ws.workspaceId), eq(auditLog.action, "event.reprocess")));
    expect(audits).toHaveLength(2);
  });

  it("POST /api/v1/playground is a dry run that writes nothing", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx);
    await processEvent((await say(ctx, chat, "Please confirm my order: 2 blue shirts")).eventId);
    const before = await countRows();

    const res = await call(playground, { url: "/api/v1/playground", cookie: ctx.ws.cookie, body: { text: "Hi, my name is Rahul. I want to buy 2 blue shirts, what's the price?", senderName: "Rahul" } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ event_id: "", status: "processed", message_classification: { category: "sales_enquiry" }, record_operation: { action: "CREATE_RECORD", status: "pending", record_id: null, verified: false } });
    expect(res.json.extracted_entities).toContainEqual(expect.objectContaining({ field: "name", value: "Rahul", evidence: "my name is Rahul" }));

    // Known sender phone → shows the update it would make to the existing open order.
    const pay = await call(playground, { url: "/api/v1/playground", apiKey: ctx.ws.apiKey, body: { text: "I paid 1200 via GPay", senderPhone: chat.contact.phone } });
    expect(pay.status).toBe(200);
    const orderOp = pay.json.record_operations.find((o: { collection_id: string }) => o.collection_id === ctx.cols.orders.id);
    expect(orderOp).toMatchObject({ action: "UPDATE_RECORD", status: "pending", changes: [{ field: "status", from: "Confirmed", to: "Paid" }] });

    const forced = await call(playground, { url: "/api/v1/playground", cookie: ctx.ws.cookie, body: { text: "please call me tomorrow about the sofa", collectionIds: [ctx.cols.tasks.id] } });
    expect(forced.json.record_operations).toHaveLength(1);
    expect(forced.json.record_operations[0]).toMatchObject({ collection_id: ctx.cols.tasks.id, action: "CREATE_RECORD" });

    expect(await countRows()).toEqual(before);

    const other = await setup();
    expect((await call(playground, { url: "/api/v1/playground", cookie: ctx.ws.cookie, body: { text: "hello", collectionIds: [other.cols.leads.id] } })).status).toBe(404);
    expect((await call(playground, { url: "/api/v1/playground", cookie: ctx.ws.cookie, body: { text: "" } })).status).toBe(422);
    const viewer = await addMember(ctx.ws.workspaceId, "viewer");
    expect((await call(playground, { url: "/api/v1/playground", cookie: viewer.cookie, body: { text: "hi" } })).status).toBe(403);
    const db = await getDb();
    expect((await dryRunProcess(db, ctx.ws.workspaceId, { text: "ok thanks" })).status).toBe("skipped");
  });

  it("POST /api/v1/collections/:id/backfill re-queues past messages", async () => {
    const ctx = await setup();
    const chat = await newChat(ctx);
    const old = await say(ctx, chat, "Is the red saree available? Interested in 2 pieces", { at: new Date(Date.now() - 3 * 86_400_000) });
    await say(ctx, chat, "very old message about buying chairs", { at: new Date(Date.now() - 90 * 86_400_000) });
    const db = await getDb();
    // Imported without processing: no event yet.
    await db.update(messages).set({ eventId: null }).where(eq(messages.id, old.messageId));
    await db.delete(events).where(eq(events.id, old.eventId));

    const res = await call(backfill, { url: `/x`, params: { id: ctx.cols.leads.id }, cookie: ctx.ws.cookie, body: {} });
    expect(res.status).toBe(202);
    expect(res.json).toEqual({ queued: 1, capped: false });
    await drainJobs({ types: ["process_message"] });
    const leads = await recordsOf(ctx.cols.leads.id);
    expect(leads).toHaveLength(1);
    expect(leads[0].values.interest).toMatch(/saree/i);

    const wide = await call(backfill, { url: `/x`, params: { id: ctx.cols.leads.id }, apiKey: ctx.ws.apiKey, body: { since: new Date(Date.now() - 100 * 86_400_000).toISOString() } });
    expect(wide.json).toEqual({ queued: 2, capped: false });
    await drainJobs({ types: ["process_message"] });
    expect(await recordsOf(ctx.cols.leads.id)).toHaveLength(1); // same contact → same lead, idempotent

    const other = await createTestWorkspace();
    expect((await call(backfill, { url: `/x`, params: { id: ctx.cols.leads.id }, cookie: other.cookie, body: {} })).status).toBe(404);
    expect((await call(backfill, { url: `/x`, params: { id: ctx.cols.leads.id }, cookie: ctx.ws.cookie, body: { since: "2026-01-02", until: "2026-01-01" } })).status).toBe(422);
  });
});
