import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/server/db";
import { channels, conversations, files, messages } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { newToken } from "@/lib/server/crypto";
import { ingestInboundMessage } from "@/lib/server/channels/ingest";
import { drainJobs } from "@/lib/server/jobs/queue";
import { isSealed, openText, sealLegacyContent } from "@/lib/server/data/sealed";
import { GET as listConversations } from "@/app/api/v1/conversations/route";
import { GET as getConversation, PATCH as patchConversation } from "@/app/api/v1/conversations/[id]/route";
import { GET as listMessages } from "@/app/api/v1/conversations/[id]/messages/route";
import { GET as getFile } from "@/app/api/v1/files/[id]/route";
import { GET as listCollections, POST as createCollection } from "@/app/api/v1/collections/route";
import { GET as getCollection, PATCH as patchCollection } from "@/app/api/v1/collections/[id]/route";
import { GET as listRecords, POST as createRecordRoute } from "@/app/api/v1/collections/[id]/records/route";
import { GET as exportCollection } from "@/app/api/v1/collections/[id]/export/route";
import { GET as getRecord, PATCH as patchRecord } from "@/app/api/v1/records/[id]/route";
import { POST as planRoute } from "@/app/api/v1/collection-plans/route";
import { GET as templatesRoute } from "@/app/api/v1/collection-templates/route";
import { GET as searchRoute } from "@/app/api/v1/search/route";
import { POST as askRoute } from "@/app/api/v1/assistant/ask/route";
import { GET as threadsRoute } from "@/app/api/v1/assistant/threads/route";
import { GET as analyticsRoute } from "@/app/api/v1/analytics/route";
import { call, createTestWorkspace } from "./helpers";

async function setup(config: Record<string, unknown> = {}) {
  const ws = await createTestWorkspace();
  const db = await getDb();
  const [ch] = await db.insert(channels).values({ id: newId("chn"), workspaceId: ws.workspaceId, type: "whatsapp_web", name: "WA", webhookToken: newToken(18), config }).returning();
  const say = (externalId: string, conv: string, text: string, extra: Partial<Parameters<typeof ingestInboundMessage>[1]> = {}) =>
    ingestInboundMessage(db, {
      workspaceId: ws.workspaceId,
      channelId: ch.id,
      externalId,
      conversation: { externalId: `${conv}@s.whatsapp.net`, title: conv === "919800000001" ? "Asha" : "Ravi" },
      sender: { externalId: `${conv}@s.whatsapp.net`, phone: `+${conv}`, name: conv === "919800000001" ? "Asha" : "Ravi" },
      text,
      sentAt: new Date(),
      ...extra,
    });
  return { ws, db, ch, say };
}

describe("encryption at rest", () => {
  it("seals message text, previews and files, and the API decrypts them", async () => {
    const { ws, db, say } = await setup();
    const r = await say("m1", "919800000001", "Need 3 red basketballs, budget 4500", {
      attachments: [{ name: "invoice.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 hello") }],
    });
    const [raw] = await db.select().from(messages).where(eq(messages.id, r.messageId));
    expect(isSealed(raw.text)).toBe(true);
    expect(raw.text).not.toContain("basketball");
    expect(raw.searchTokens?.length).toBeGreaterThan(5);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, r.conversationId));
    expect(isSealed(conv.lastMessagePreview)).toBe(true);
    const [file] = await db.select().from(files).where(eq(files.messageId, r.messageId));
    expect(Buffer.from(file.data).toString()).not.toContain("hello");

    const list = await call(listConversations, { url: "/api/v1/conversations", cookie: ws.cookie });
    expect(list.status).toBe(200);
    expect(list.json.items[0]).toMatchObject({ title: "Asha", lastMessagePreview: "Need 3 red basketballs, budget 4500", unreadCount: 1, agentsEnabled: true });
    const msgs = await call(listMessages, { url: "/x", cookie: ws.cookie, params: { id: r.conversationId } });
    expect(msgs.json.items[0]).toMatchObject({ text: "Need 3 red basketballs, budget 4500", direction: "inbound" });
    const fileId = msgs.json.items[0].attachments[0].fileId;
    const dl = await getFile(new Request(`http://localhost:3000/api/v1/files/${fileId}`, { headers: { cookie: ws.cookie, host: "localhost:3000" } }), { params: Promise.resolve({ id: fileId }) });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await dl.arrayBuffer()).toString()).toBe("%PDF-1.4 hello");

    // Another workspace can't read it.
    const other = await createTestWorkspace();
    expect((await call(listMessages, { url: "/x", cookie: other.cookie, params: { id: r.conversationId } })).status).toBe(404);
  });

  it("seals rows written before encryption existed", async () => {
    const { db, say } = await setup();
    const r = await say("legacy1", "919800000001", "old plaintext message");
    await db.update(messages).set({ text: "old plaintext message", searchTokens: null }).where(eq(messages.id, r.messageId));
    await db.update(conversations).set({ lastMessagePreview: "old plaintext message" }).where(eq(conversations.id, r.conversationId));
    const done = await sealLegacyContent(db);
    expect(done.messages).toBeGreaterThanOrEqual(1);
    const [m] = await db.select().from(messages).where(eq(messages.id, r.messageId));
    expect(isSealed(m.text)).toBe(true);
    expect(openText(m.text)).toBe("old plaintext message");
    const [cv] = await db.select().from(conversations).where(eq(conversations.id, r.conversationId));
    expect(isSealed(cv.lastMessagePreview)).toBe(true);
  });
});

describe("search over sealed messages", () => {
  it("finds messages by word prefix, records by value, and respects workspaces", async () => {
    const { ws, say } = await setup();
    await say("s1", "919800000001", "Do you have the red basketball in size 7?");
    await say("s2", "919800000002", "Payment of 2,500 done via UPI");
    const hit = await call(searchRoute, { url: "/api/v1/search?q=bask", cookie: ws.cookie });
    expect(hit.json.items.filter((h: { type: string }) => h.type === "message")).toHaveLength(1);
    expect(hit.json.items[0]).toMatchObject({ type: "message", snippet: "Do you have the red basketball in size 7?" });
    expect((await call(searchRoute, { url: "/api/v1/search?q=red%20basketball", cookie: ws.cookie })).json.items[0].type).toBe("message");
    expect((await call(searchRoute, { url: "/api/v1/search?q=2500&type=messages", cookie: ws.cookie })).json.items).toHaveLength(1);
    expect((await call(searchRoute, { url: "/api/v1/search?q=volleyball&type=messages", cookie: ws.cookie })).json.items).toHaveLength(0);
    const other = await createTestWorkspace();
    expect((await call(searchRoute, { url: "/api/v1/search?q=basketball", cookie: other.cookie })).json.items).toHaveLength(0);
  });
});

describe("collections: prompt → plan → accept → auto-filled records", () => {
  it("plans from a sentence, creates the collection with backfill, and extracts records from chats", async () => {
    const { ws, say } = await setup();
    await say("o1", "919800000001", "I want to order 2 cotton shirts, size M. How much?");

    const tpl = await call(templatesRoute, { url: "/x", cookie: ws.cookie });
    expect(tpl.json.items.map((t: { template: string }) => t.template)).toContain("leads");

    const planned = await call(planRoute, { url: "/x", cookie: ws.cookie, body: { prompt: "Find all orders from my chats for the last month" } });
    expect(planned.status).toBe(200);
    expect(planned.json).toMatchObject({ engine: "rules", plan: { template: "orders" }, rangeLabel: "in the last 30 days" });
    expect(Date.parse(planned.json.since)).toBeLessThan(Date.now());

    const made = await call(createCollection, { url: "/x", cookie: ws.cookie, body: { ...planned.json.plan, backfillSince: planned.json.since } });
    expect(made.status).toBe(201);
    expect(made.json.backfill.queued).toBeGreaterThanOrEqual(1);
    await drainJobs({ budgetMs: 20_000 });

    const recs = await call(listRecords, { url: "/x", cookie: ws.cookie, params: { id: made.json.id } });
    expect(recs.status).toBe(200);
    expect(recs.json.items.length).toBeGreaterThanOrEqual(1);
    expect(recs.json.items[0].sourceMessageIds.length).toBeGreaterThanOrEqual(1);

    // New live messages flow into it automatically.
    await say("o2", "919800000002", "Please send 5 kurtas, order for Friday delivery");
    await drainJobs({ budgetMs: 20_000 });
    const after = await call(listRecords, { url: "/x", cookie: ws.cookie, params: { id: made.json.id } });
    expect(after.json.items.length).toBeGreaterThanOrEqual(2);

    // Record detail shows the decrypted source message.
    const detail = await call(getRecord, { url: "/x", cookie: ws.cookie, params: { id: after.json.items[0].id } });
    expect(detail.json.sources[0].message.text).toMatch(/kurtas|shirts/);

    // Hand edits stick.
    const statusField = made.json.fields.find((f: { type: string }) => f.type === "status");
    const edited = await call(patchRecord, { url: "/x", cookie: ws.cookie, params: { id: detail.json.id }, method: "PATCH", body: { values: { [statusField.key]: statusField.options[1] }, expectedVersion: detail.json.version } });
    expect(edited.status).toBe(200);
    expect(edited.json.values[statusField.key]).toBe(statusField.options[1]);

    const listed = await call(listCollections, { url: "/x", cookie: ws.cookie });
    expect(listed.json.items.find((c: { id: string }) => c.id === made.json.id).recordCount).toBeGreaterThanOrEqual(2);

    const csv = await call(exportCollection, { url: "/x?format=csv", cookie: ws.cookie, params: { id: made.json.id } });
    expect(csv.status).toBe(200);
    expect(String(csv.json)).toContain(made.json.fields[0].label);
  });

  it("validates fields, supports manual records and edits", async () => {
    const { ws } = await setup();
    const bad = await call(createCollection, {
      url: "/x",
      cookie: ws.cookie,
      body: { name: "X", fields: [{ key: "a", label: "A", type: "text" }, { key: "a", label: "A2", type: "text" }] },
    });
    expect(bad.status).toBe(422);
    const col = await call(createCollection, {
      url: "/x",
      cookie: ws.cookie,
      body: { name: "Property enquiries", fields: [{ key: "name", label: "Name", type: "text" }, { key: "budget", label: "Budget", type: "currency" }], routing: { categories: ["sales_enquiry"], keywords: ["bhk"] } },
    });
    expect(col.status).toBe(201);
    const rec = await call(createRecordRoute, { url: "/x", cookie: ws.cookie, params: { id: col.json.id }, body: { values: { name: "Meena", budget: "45,00,000" } } });
    expect(rec.status).toBe(201);
    expect(rec.json.values).toMatchObject({ name: "Meena", budget: 4500000 });
    const sorted = await call(listRecords, { url: "/x?sort=-budget&q=meena", cookie: ws.cookie, params: { id: col.json.id } });
    expect(sorted.json.items).toHaveLength(1);
    const renamed = await call(patchCollection, { url: "/x", cookie: ws.cookie, params: { id: col.json.id }, method: "PATCH", body: { name: "Flats" } });
    expect(renamed.json).toMatchObject({ name: "Flats", recordCount: 1 });
    expect((await call(getCollection, { url: "/x", cookie: (await createTestWorkspace()).cookie, params: { id: col.json.id } })).status).toBe(404);
  });
});

describe("agents on selected chats", () => {
  it("stores but never extracts from chats with agents off", async () => {
    const { ws, db, say } = await setup({ chatSelection: "selected" });
    const col = await call(createCollection, { url: "/x", cookie: ws.cookie, body: { template: "orders" } });
    const off = await say("a1", "919800000001", "I want to order 10 boxes of tea");
    await drainJobs({ budgetMs: 10_000 });
    const [m] = await db.select().from(messages).where(eq(messages.id, off.messageId));
    expect(m.status).toBe("received");
    expect((await call(listRecords, { url: "/x", cookie: ws.cookie, params: { id: col.json.id } })).json.items).toHaveLength(0);

    // Turn agents on for this chat: new messages are extracted.
    const on = await call(patchConversation, { url: "/x", cookie: ws.cookie, params: { id: off.conversationId }, method: "PATCH", body: { agentsEnabled: true, read: true } });
    expect(on.json).toMatchObject({ agentsEnabled: true, unreadCount: 0 });
    await say("a2", "919800000001", "I want to order 4 packets of green tea. How much?");
    await drainJobs({ budgetMs: 20_000 });
    expect((await call(listRecords, { url: "/x", cookie: ws.cookie, params: { id: col.json.id } })).json.items.length).toBeGreaterThanOrEqual(1);
    const detail = await call(getConversation, { url: "/x", cookie: ws.cookie, params: { id: off.conversationId } });
    expect(detail.json.contact).toMatchObject({ phone: "+919800000001" });
  });
});

describe("assistant and analytics", () => {
  it("answers from chats with citations (rules engine without AI) and keeps threads", async () => {
    const { ws, say } = await setup();
    await say("q1", "919800000001", "Has the red basketball shipped yet?");
    await say("q2", "919800000002", "Thanks, payment sent");
    const a = await call(askRoute, { url: "/x", cookie: ws.cookie, body: { question: "Who asked about the basketball?" } });
    expect(a.status).toBe(200);
    expect(a.json.engine).toBe("rules");
    expect(a.json.citations[0]).toMatchObject({ senderName: "Asha", text: "Has the red basketball shipped yet?" });
    expect(a.json.threadId).toMatch(/^thr_/);
    const again = await call(askRoute, { url: "/x", cookie: ws.cookie, body: { question: "summarise today", threadId: a.json.threadId } });
    expect(again.json.threadId).toBe(a.json.threadId);
    expect(again.json.citations.length).toBeGreaterThanOrEqual(2);
    const threads = await call(threadsRoute, { url: "/x", cookie: ws.cookie });
    expect(threads.json.items[0]).toMatchObject({ id: a.json.threadId, title: "Who asked about the basketball?" });
  });

  it("summarises every collection (records, currency total, status split) in analytics", async () => {
    const { ws } = await setup();
    const fields = [
      { key: "name", label: "Name", type: "text" },
      { key: "amount", label: "Amount", type: "currency" },
      { key: "status", label: "Status", type: "status", options: ["Pending", "Paid"] },
    ];
    const a = await call(createCollection, { url: "/x", cookie: ws.cookie, body: { name: "Payments A", fields } });
    const b = await call(createCollection, { url: "/x", cookie: ws.cookie, body: { name: "Notes", fields: [{ key: "note", label: "Note", type: "text" }] } });
    for (const v of [{ name: "x", amount: 1200, status: "Paid" }, { name: "y", amount: 300.5, status: "Pending" }, { name: "z", amount: "abc", status: "Paid" }]) {
      await call(createRecordRoute, { url: "/x", cookie: ws.cookie, params: { id: a.json.id }, body: { values: v } });
    }
    await call(createRecordRoute, { url: "/x", cookie: ws.cookie, params: { id: b.json.id }, body: { values: { note: "hi" } } });
    const r = await call(analyticsRoute, { url: "/api/v1/analytics?days=7", cookie: ws.cookie });
    const ca = r.json.collections.find((c: { id: string }) => c.id === a.json.id);
    const cb = r.json.collections.find((c: { id: string }) => c.id === b.json.id);
    expect(ca).toMatchObject({ records: 3, valueSum: 1500.5 });
    expect(Object.fromEntries(ca.byStatus.map((s: { status: string; count: number }) => [s.status, s.count]))).toEqual({ Paid: 2, Pending: 1 });
    expect(cb).toMatchObject({ records: 1, valueSum: null, byStatus: [] });
  });

  it("returns workspace analytics", async () => {
    const { ws, say } = await setup();
    await say("n1", "919800000001", "hello there");
    const r = await call(analyticsRoute, { url: "/api/v1/analytics?days=7", cookie: ws.cookie });
    expect(r.status).toBe(200);
    expect(r.json.totals.messages).toBe(1);
    expect(r.json.byDay).toHaveLength(7);
    expect(r.json.byDay.at(-1).messages).toBe(1);
  });
});
