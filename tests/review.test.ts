import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/server/db";
import { apiKeys, auditLog, channels, collections, contacts, conversations, events, jobs, messages, notifications, records, recordSources, reviewItems, type CollectionRow } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { newToken, sha256Hex } from "@/lib/server/crypto";
import { templatePlan } from "@/lib/server/templates";
import { createRecord, updateRecord } from "@/lib/server/records/ops";
import { drainJobs } from "@/lib/server/jobs/queue";
import { PIPELINE_ACTOR } from "@/lib/server/audit";
import { GET as listReview } from "@/app/api/v1/review/route";
import { GET as countReview } from "@/app/api/v1/review/count/route";
import { GET as getReview } from "@/app/api/v1/review/[id]/route";
import { POST as approve } from "@/app/api/v1/review/[id]/approve/route";
import { POST as reject } from "@/app/api/v1/review/[id]/reject/route";
import { POST as createAutomation } from "@/app/api/v1/automations/route";
import type { DomainEvent, FieldMeta, ProcessingResult, ProposedOperation, RecordOperation } from "@/lib/shared/types";
import { addMember, call, createTestWorkspace, type TestWorkspace, opened } from "./helpers";

type Ctx = { ws: TestWorkspace; leads: CollectionRow; payments: CollectionRow; channelId: string; contactId: string; conversationId: string };

async function setup(): Promise<Ctx> {
  const ws = await createTestWorkspace();
  const db = await getDb();
  const col = async (t: "leads" | "payments") => {
    const p = templatePlan(t);
    const [row] = await db
      .insert(collections)
      .values({ id: newId("col"), workspaceId: ws.workspaceId, name: p.name, description: p.description, icon: p.icon, template: p.template, fields: p.fields, routing: p.routing, matchFields: p.matchFields })
      .returning();
    return row;
  };
  const leads = await col("leads");
  const payments = await col("payments");
  const [ch] = await db.insert(channels).values({ id: newId("chn"), workspaceId: ws.workspaceId, type: "whatsapp_cloud", name: "WhatsApp", webhookToken: newToken(16) }).returning();
  const [contact] = await db.insert(contacts).values({ id: newId("ctc"), workspaceId: ws.workspaceId, displayName: "Rahul", phone: `+91990${Date.now().toString().slice(-7)}` }).returning();
  const [conv] = await db.insert(conversations).values({ id: newId("cnv"), workspaceId: ws.workspaceId, channelId: ch.id, externalId: newToken(6), title: "Rahul", contactId: contact.id }).returning();
  return { ws, leads, payments, channelId: ch.id, contactId: contact.id, conversationId: conv.id };
}

const meta = (messageId: string, eventId: string, evidence: string, confidence = 0.7): FieldMeta => ({ source: "extracted", confidence, messageId, eventId, evidence, method: "rules", updatedAt: new Date().toISOString() });

/** A processed message whose event waits for review: one review item per proposal. */
async function seedReview(ctx: Ctx, proposals: { collection: CollectionRow; action: "CREATE_RECORD" | "UPDATE_RECORD"; recordId?: string | null; values: Record<string, string | number>; kind?: "missing_required" | "low_confidence" | "conflict" }[]) {
  const db = await getDb();
  const messageId = newId("msg");
  const eventId = newId("evt");
  await db.insert(messages).values({
    id: messageId,
    workspaceId: ctx.ws.workspaceId,
    channelId: ctx.channelId,
    conversationId: ctx.conversationId,
    contactId: ctx.contactId,
    externalId: `wamid.${newToken(8)}`,
    senderName: "Rahul",
    text: "Hi, I want a sofa. Paid 1200 via GPay",
    sentAt: new Date(),
    status: "needs_review",
    eventId,
  });
  const itemIds: string[] = [];
  const ops: RecordOperation[] = [];
  const rows = proposals.map((p) => {
    const id = newId("rvw");
    itemIds.push(id);
    const proposed: ProposedOperation = {
      action: p.action,
      collectionId: p.collection.id,
      recordId: p.recordId ?? null,
      values: p.values,
      fieldMeta: Object.fromEntries(Object.keys(p.values).map((k) => [k, meta(messageId, eventId, String(p.values[k]))])),
      matchKey: null,
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      messageId,
      eventId,
    };
    ops.push({ action: "PENDING_REVIEW", collection: p.collection.name, collection_id: p.collection.id, record_id: p.recordId ?? null, status: "needs_review", changes: [], conflicts: [], verified: false, review_item_id: id });
    return { id, workspaceId: ctx.ws.workspaceId, kind: p.kind ?? ("low_confidence" as const), reason: "Please check these values.", status: "open" as const, eventId, messageId, collectionId: p.collection.id, recordId: p.recordId ?? null, proposed, current: null, conflicts: [] };
  });
  const result = {
    event_id: eventId,
    status: "needs_review",
    source: "whatsapp",
    record_operation: ops[0],
    record_operations: ops,
    automation: [],
    requires_human_review: true,
    review_item_ids: itemIds,
  } as unknown as ProcessingResult;
  await db.insert(events).values({ id: eventId, workspaceId: ctx.ws.workspaceId, messageId, source: "whatsapp", status: "needs_review", result, processedAt: new Date() });
  for (const r of rows) await db.insert(reviewItems).values(r);
  return { messageId, eventId, itemIds };
}

const url = (id: string, action?: string) => `/api/v1/review/${id}${action ? `/${action}` : ""}`;

beforeAll(async () => {
  await getDb();
}, 180_000);

describe("review approve", () => {
  it("applies the proposal through applyProposedOperation with the reviewer's corrections, then settles the event", async () => {
    const ctx = await setup();
    const db = await getDb();
    const { eventId, messageId, itemIds } = await seedReview(ctx, [
      { collection: ctx.leads, action: "CREATE_RECORD", values: { name: "Rahul", interest: "Sofa" } },
      { collection: ctx.payments, action: "CREATE_RECORD", values: { payer: "Rahul", method: "GPay" }, kind: "missing_required" },
    ]);

    const res = await call(approve, { url: url(itemIds[0], "approve"), cookie: ctx.ws.cookie, params: { id: itemIds[0] }, body: { values: { budget: 25000 }, note: "Checked with the customer" } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.item).toMatchObject({ id: itemIds[0], status: "approved", resolvedBy: ctx.ws.userId, resolutionNote: "Checked with the customer" });
    expect(res.json.item.resolvedAt).toEqual(expect.any(String));
    expect(res.json.operation).toMatchObject({ action: "CREATE_RECORD", collection_id: ctx.leads.id, status: "completed", verified: true, review_item_id: itemIds[0] });
    const recordId = res.json.operation.record_id as string;
    expect(res.json.item.recordId).toBe(recordId);

    const [rec] = await db.select().from(records).where(eq(records.id, recordId));
    expect(rec).toMatchObject({ workspaceId: ctx.ws.workspaceId, contactId: ctx.contactId, values: { name: "Rahul", interest: "Sofa", budget: 25000 } });
    expect(rec.fieldMeta.name).toMatchObject({ source: "extracted", confidence: 1, messageId }); // approved machine value
    expect(rec.fieldMeta.budget).toMatchObject({ method: "human", edited: true }); // reviewer's correction
    expect((await db.select().from(recordSources).where(eq(recordSources.recordId, recordId))).some((s) => s.messageId === messageId)).toBe(true);

    // One item still open → the event still needs review.
    let [ev] = await db.select().from(events).where(eq(events.id, eventId));
    expect(ev.status).toBe("needs_review");
    expect(ev.result!.requires_human_review).toBe(true);
    expect(ev.result!.record_operations[0]).toMatchObject({ action: "CREATE_RECORD", status: "completed", record_id: recordId, review_item_id: itemIds[0] });

    // Second approval: required "amount" is missing → 422, nothing changes, item stays open.
    const missing = await call(approve, { url: url(itemIds[1], "approve"), cookie: ctx.ws.cookie, params: { id: itemIds[1] }, body: {} });
    expect(missing.status).toBe(422);
    expect((await db.select().from(reviewItems).where(eq(reviewItems.id, itemIds[1])))[0].status).toBe("open");
    const ok = await call(approve, { url: url(itemIds[1], "approve"), cookie: ctx.ws.cookie, params: { id: itemIds[1] }, body: { values: { amount: "1,200" } } });
    expect(ok.status).toBe(200);
    expect(ok.json.operation).toMatchObject({ action: "CREATE_RECORD", collection_id: ctx.payments.id, status: "completed" });

    // All resolved → event + message processed.
    [ev] = await db.select().from(events).where(eq(events.id, eventId));
    expect(ev.status).toBe("processed");
    expect(ev.result).toMatchObject({ status: "processed", requires_human_review: false });
    expect(ev.result!.record_operation).toMatchObject({ status: "completed", record_id: recordId });
    expect((opened(await db.select().from(messages).where(eq(messages.id, messageId))))[0].status).toBe("processed");

    // Audit + review.resolved domain events.
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.workspaceId, ctx.ws.workspaceId), eq(auditLog.action, "review.approve")));
    expect(audits.map((a) => a.targetId).sort()).toEqual([...itemIds].sort());
    expect(audits.find((a) => a.targetId === itemIds[0])!.meta).toMatchObject({ overriddenFields: ["budget"], eventId });
    const resolved = (await db.select().from(jobs).where(and(eq(jobs.type, "domain_event"), eq(jobs.workspaceId, ctx.ws.workspaceId))))
      .map((j) => j.payload as unknown as DomainEvent)
      .filter((e) => e.type === "review.resolved");
    expect(resolved.map((e) => e.data.reviewItemId).sort()).toEqual([...itemIds].sort());
    expect(resolved.find((e) => e.data.reviewItemId === itemIds[0])!.data).toMatchObject({ recordId, eventId, collectionId: ctx.leads.id });

    // Already resolved → 409 already_resolved.
    const again = await call(approve, { url: url(itemIds[0], "approve"), cookie: ctx.ws.cookie, params: { id: itemIds[0] }, body: {} });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("already_resolved");
    expect((await call(reject, { url: url(itemIds[0], "reject"), cookie: ctx.ws.cookie, params: { id: itemIds[0] }, body: {} })).json.error.code).toBe("already_resolved");
  });

  it("approves an update to an existing record, overriding a human edit only because a person approved it", async () => {
    const ctx = await setup();
    const db = await getDb();
    const user = { type: "user" as const, id: ctx.ws.userId };
    const rec = await createRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.leads, values: { name: "Rahul", interest: "Red shirts" }, contactId: ctx.contactId, origin: "pipeline", actor: PIPELINE_ACTOR });
    await updateRecord(db, { workspaceId: ctx.ws.workspaceId, collection: ctx.leads, recordId: rec.record.id, patch: { interest: "Blue shirts" }, mode: "human", actor: user });
    const { itemIds, eventId } = await seedReview(ctx, [{ collection: ctx.leads, action: "UPDATE_RECORD", recordId: rec.record.id, values: { interest: "3 blue shirts" }, kind: "conflict" }]);

    // API key with the write scope may resolve reviews.
    const res = await call(approve, { url: url(itemIds[0], "approve"), apiKey: ctx.ws.apiKey, params: { id: itemIds[0] }, body: {} });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.operation).toMatchObject({ action: "UPDATE_RECORD", record_id: rec.record.id, status: "completed", verified: true, changes: [{ field: "interest", from: "Blue shirts", to: "3 blue shirts" }] });
    expect(res.json.item.resolvedBy).toMatch(/^key_/);
    const [row] = await db.select().from(records).where(eq(records.id, rec.record.id));
    expect(row.values.interest).toBe("3 blue shirts");
    const [ev] = await db.select().from(events).where(eq(events.id, eventId));
    expect(ev.status).toBe("processed");
  });

  it("runs review.resolved automations", async () => {
    const ctx = await setup();
    const db = await getDb();
    const a = await call(createAutomation, {
      url: "/api/v1/automations",
      cookie: ctx.ws.cookie,
      body: { name: "Reviewed", trigger: { type: "review.resolved", collectionId: ctx.leads.id }, actions: [{ type: "notify", to: "admins", title: "A lead review was resolved" }] },
    });
    expect(a.status).toBe(201);
    const { itemIds } = await seedReview(ctx, [{ collection: ctx.leads, action: "CREATE_RECORD", values: { name: "Asha", interest: "Lamp" } }]);
    expect((await call(reject, { url: url(itemIds[0], "reject"), cookie: ctx.ws.cookie, params: { id: itemIds[0] }, body: { note: "Spam" } })).status).toBe(200);
    await drainJobs({ types: ["domain_event"] });
    const notes = await db.select().from(notifications).where(eq(notifications.workspaceId, ctx.ws.workspaceId));
    expect(notes.map((n) => n.title)).toEqual(["A lead review was resolved"]);
  });
});

describe("review reject, lists and tenancy", () => {
  it("rejects without touching records, lists by status with pagination, counts, enforces roles and tenancy", async () => {
    const ctx = await setup();
    const other = await setup();
    const db = await getDb();
    const viewer = await addMember(ctx.ws.workspaceId, "viewer");
    const member = await addMember(ctx.ws.workspaceId, "member");
    const a = await seedReview(ctx, [{ collection: ctx.leads, action: "CREATE_RECORD", values: { name: "A", interest: "Sofa" } }]);
    const b = await seedReview(ctx, [{ collection: ctx.leads, action: "CREATE_RECORD", values: { name: "B", interest: "Bed" } }]);
    const c = await seedReview(ctx, [{ collection: ctx.payments, action: "CREATE_RECORD", values: { payer: "C", amount: 100 } }]);
    const foreign = await seedReview(other, [{ collection: other.leads, action: "CREATE_RECORD", values: { name: "X", interest: "Y" } }]);

    expect((await call(countReview, { url: "/api/v1/review/count", cookie: viewer.cookie })).json).toEqual({ open: 3 });
    // Newest first, cursor pagination.
    const p1 = await call(listReview, { url: "/api/v1/review?limit=2", cookie: viewer.cookie });
    expect(p1.status).toBe(200);
    expect(p1.json.items.map((i: { id: string }) => i.id)).toEqual([c.itemIds[0], b.itemIds[0]]);
    expect(p1.json.items[0]).toMatchObject({ status: "open", kind: "low_confidence", proposed: { action: "CREATE_RECORD", values: { payer: "C" } }, eventId: c.eventId });
    const p2 = await call(listReview, { url: `/api/v1/review?limit=2&cursor=${p1.json.nextCursor}`, cookie: viewer.cookie });
    expect(p2.json.items.map((i: { id: string }) => i.id)).toEqual([a.itemIds[0]]);
    expect(p2.json.nextCursor).toBeNull();
    const byCollection = await call(listReview, { url: `/api/v1/review?collectionId=${ctx.payments.id}`, apiKey: ctx.ws.apiKey });
    expect(byCollection.json.items.map((i: { id: string }) => i.id)).toEqual([c.itemIds[0]]);
    expect((await call(listReview, { url: "/api/v1/review?status=bogus", cookie: viewer.cookie })).status).toBe(400);
    expect((await call(listReview, { url: "/api/v1/review?cursor=garbage", cookie: viewer.cookie })).status).toBe(400);

    // Roles and scopes.
    expect((await call(reject, { url: url(a.itemIds[0], "reject"), cookie: viewer.cookie, params: { id: a.itemIds[0] }, body: {} })).status).toBe(403);
    const readKey = `ifk_test_${newToken(24)}`;
    await db.insert(apiKeys).values({ id: newId("key"), workspaceId: ctx.ws.workspaceId, name: "read only", prefix: readKey.slice(0, 12), keyHash: sha256Hex(readKey), scopes: ["read"] });
    expect((await call(approve, { url: url(a.itemIds[0], "approve"), apiKey: readKey, params: { id: a.itemIds[0] }, body: {} })).status).toBe(403);
    expect((await call(listReview, { url: "/api/v1/review", apiKey: readKey })).status).toBe(200);
    // Tenancy: other workspace can't read or resolve; foreign items are invisible here.
    expect((await call(getReview, { url: url(a.itemIds[0]), cookie: other.ws.cookie, params: { id: a.itemIds[0] } })).status).toBe(404);
    expect((await call(approve, { url: url(a.itemIds[0], "approve"), cookie: other.ws.cookie, params: { id: a.itemIds[0] }, body: {} })).status).toBe(404);
    expect((await call(reject, { url: url(a.itemIds[0], "reject"), apiKey: other.ws.apiKey, params: { id: a.itemIds[0] }, body: {} })).status).toBe(404);
    expect((await call(getReview, { url: url(foreign.itemIds[0]), cookie: ctx.ws.cookie, params: { id: foreign.itemIds[0] } })).status).toBe(404);
    expect((await call(getReview, { url: url(a.itemIds[0]), apiKey: ctx.ws.apiKey, params: { id: a.itemIds[0] } })).json).toMatchObject({ id: a.itemIds[0], status: "open" });

    // Reject: no record written, event settled, audited.
    const before = (await db.select().from(records).where(eq(records.workspaceId, ctx.ws.workspaceId))).length;
    const r = await call(reject, { url: url(a.itemIds[0], "reject"), cookie: member.cookie, params: { id: a.itemIds[0] }, body: { note: "Not a real lead" } });
    expect(r.status).toBe(200);
    expect(r.json.item).toMatchObject({ status: "rejected", resolvedBy: member.userId, resolutionNote: "Not a real lead" });
    expect((await db.select().from(records).where(eq(records.workspaceId, ctx.ws.workspaceId))).length).toBe(before);
    const [ev] = await db.select().from(events).where(eq(events.id, a.eventId));
    expect(ev.status).toBe("processed");
    expect(ev.result).toMatchObject({ status: "processed", requires_human_review: false });
    expect(ev.result!.record_operations[0]).toMatchObject({ action: "PENDING_REVIEW", status: "skipped" });
    expect(await db.select().from(auditLog).where(and(eq(auditLog.targetId, a.itemIds[0]), eq(auditLog.action, "review.reject")))).toHaveLength(1);

    expect((await call(countReview, { url: "/api/v1/review/count", cookie: viewer.cookie })).json).toEqual({ open: 2 });
    const rejected = await call(listReview, { url: "/api/v1/review?status=rejected", cookie: viewer.cookie });
    expect(rejected.json.items.map((i: { id: string }) => i.id)).toEqual([a.itemIds[0]]);
    expect((await call(countReview, { url: "/api/v1/review/count", cookie: other.ws.cookie })).json).toEqual({ open: 1 });
  });
});
