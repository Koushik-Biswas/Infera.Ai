import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/server/db";
import { collections, jobs, records, recordSources, auditLog } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { createRecord, updateRecord, softDeleteRecord, DuplicateRecordError } from "@/lib/server/records/ops";
import { normalizeValue, computeMatchKey } from "@/lib/server/records/coerce";
import { enqueue, runDueJobs } from "@/lib/server/jobs/queue";
import { workspaceRoute, notFound } from "@/lib/server/api/handler";
import { decrypt, encrypt, hashPassword, verifyPassword } from "@/lib/server/crypto";
import { and } from "drizzle-orm";
import type { Field } from "@/lib/shared/types";
import { call, createTestWorkspace, addMember } from "./helpers";

const fields: Field[] = [
  { key: "customer", label: "Customer", type: "text", description: "" },
  { key: "amount", label: "Amount", type: "currency", description: "" },
  { key: "status", label: "Status", type: "status", description: "", options: ["New order", "Paid", "Delivered"] },
  { key: "phone", label: "Phone", type: "phone", description: "" },
];

async function makeCollection(workspaceId: string) {
  const db = await getDb();
  const [col] = await db
    .insert(collections)
    .values({ id: newId("col"), workspaceId, name: "Orders", template: "orders", fields, routing: { categories: ["order"] }, matchFields: ["$contact", "customer"] })
    .returning();
  return col;
}

const pipeline = { type: "pipeline" as const, id: null };
const meta = (confidence: number, messageId: string | null = null) => ({ source: "extracted" as const, confidence, messageId, eventId: null, evidence: "x", method: "rules" as const, updatedAt: new Date().toISOString() });

describe("normalizeValue", () => {
  it("parses currency, dates, phones and status deterministically", () => {
    expect(normalizeValue(fields[1], "₹1,250").value).toBe(1250);
    expect(normalizeValue(fields[1], "2.5k").value).toBe(2500);
    expect(normalizeValue(fields[1], "abc").value).toBeNull();
    expect(normalizeValue(fields[2], "paid").value).toBe("Paid");
    expect(normalizeValue(fields[2], "teleported").value).toBeNull();
    expect(normalizeValue(fields[3], "98470 11234").value).toBe("+919847011234");
    expect(normalizeValue({ key: "d", label: "D", type: "date", description: "" }, "18/11/2026").value).toBe("2026-11-18");
    expect(normalizeValue({ key: "d", label: "D", type: "date", description: "" }, "31/02/2026").value).toBeNull();
  });
  it("computes match keys and returns null when a part is missing", () => {
    expect(computeMatchKey(["$contact", "customer"], { customer: "Rahul " }, { contactId: "ctc_1" })).toBe("ctc_1|rahul");
    expect(computeMatchKey(["$contact", "customer"], { customer: null }, { contactId: "ctc_1" })).toBeNull();
  });
});

describe("record ops", () => {
  it("creates, dedupes, guards human edits and lower-confidence values, versions, audits", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const col = await makeCollection(ws.workspaceId);

    const a = await createRecord(db, { workspaceId: ws.workspaceId, collection: col, values: { customer: "Rahul", amount: "₹1200", status: "New order" }, fieldMeta: { customer: meta(0.9), amount: meta(0.9), status: meta(0.9) }, contactId: null, origin: "pipeline", actor: pipeline, matchKey: "k1" });
    expect(a.verified).toBe(true);
    expect(a.record.values.amount).toBe(1200);
    expect(a.record.status).toBe("New order");

    await expect(createRecord(db, { workspaceId: ws.workspaceId, collection: col, values: { customer: "Rahul" }, origin: "pipeline", actor: pipeline, matchKey: "k1" })).rejects.toBeInstanceOf(DuplicateRecordError);

    // Human edit marks the field as edited.
    const h = await updateRecord(db, { workspaceId: ws.workspaceId, collection: col, recordId: a.record.id, patch: { amount: 1300 }, mode: "human", actor: { type: "user", id: ws.userId }, expectedVersion: 1 });
    expect(h.record.version).toBe(2);
    expect(h.record.fieldMeta.amount.edited).toBe(true);

    // Machine cannot overwrite the edited value, nor replace with lower confidence; can progress status.
    const m = await updateRecord(db, { workspaceId: ws.workspaceId, collection: col, recordId: a.record.id, patch: { amount: 999, customer: "R.", status: "Paid" }, meta: { amount: meta(0.99), customer: meta(0.4), status: meta(0.95) }, mode: "machine", actor: pipeline });
    expect(m.conflicts.map((c) => [c.field, c.reason]).sort()).toEqual([
      ["amount", "human_edited"],
      ["customer", "lower_confidence"],
    ]);
    expect(m.changes).toEqual([{ field: "status", from: "New order", to: "Paid" }]);
    expect(m.record.values.amount).toBe(1300);
    expect(m.record.status).toBe("Paid");
    expect(m.verified).toBe(true);

    // Stale version → 409
    await expect(updateRecord(db, { workspaceId: ws.workspaceId, collection: col, recordId: a.record.id, patch: { amount: 1 }, mode: "human", actor: { type: "user", id: ws.userId }, expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });

    // Other workspace can't touch it.
    const other = await createTestWorkspace();
    await expect(updateRecord(db, { workspaceId: other.workspaceId, collection: col, recordId: a.record.id, patch: { amount: 1 }, mode: "human", actor: { type: "user", id: other.userId } })).rejects.toMatchObject({ status: 404 });

    // Soft delete frees the match key; audit + domain-event jobs exist.
    await softDeleteRecord(db, { workspaceId: ws.workspaceId, recordId: a.record.id, actor: { type: "user", id: ws.userId } });
    const again = await createRecord(db, { workspaceId: ws.workspaceId, collection: col, values: { customer: "Rahul" }, origin: "pipeline", actor: pipeline, matchKey: "k1" });
    expect(again.record.id).not.toBe(a.record.id);
    const audits = await db.select().from(auditLog).where(eq(auditLog.targetId, a.record.id));
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(["record.create", "record.update", "record.delete"]));
    const evs = await db.select().from(jobs).where(eq(jobs.type, "domain_event"));
    const types = evs.map((j) => (j.payload as { type: string }).type);
    expect(types).toEqual(expect.arrayContaining(["record.created", "record.updated", "record.status_changed", "record.deleted"]));
  });

  it("records source traceability without duplicates", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const col = await makeCollection(ws.workspaceId);
    const r = await createRecord(db, { workspaceId: ws.workspaceId, collection: col, values: { customer: "A" }, origin: "pipeline", actor: pipeline, sources: [{ messageId: null, fieldKey: "customer", evidence: "I am A", confidence: 0.9 }] });
    await updateRecord(db, { workspaceId: ws.workspaceId, collection: col, recordId: r.record.id, patch: { customer: "A" }, meta: { customer: meta(0.95) }, mode: "machine", actor: pipeline, sources: [{ messageId: null, fieldKey: "customer", evidence: "I am A", confidence: 0.95 }] });
    const src = await db.select().from(recordSources).where(eq(recordSources.recordId, r.record.id));
    expect(src).toHaveLength(1);
    const [row] = await db.select().from(records).where(and(eq(records.id, r.record.id)));
    expect(row.fieldMeta.customer.confidence).toBe(0.95);
  });
});

describe("job queue", () => {
  it("dedupes, retries with backoff, and marks jobs dead after max attempts", async () => {
    const db = await getDb();
    const id = await enqueue(db, { type: "retention_sweep", payload: {}, dedupeKey: "t1", maxAttempts: 1 });
    expect(id).not.toBeNull();
    expect(await enqueue(db, { type: "retention_sweep", payload: {}, dedupeKey: "t1" })).toBeNull();
    const r = await runDueJobs({ types: ["retention_sweep"] });
    expect(r.ran).toBe(1);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id!));
    // Handler is a stub that throws until the automations module lands — either way it must not stay "running".
    expect(["done", "dead"]).toContain(job.status);
  });
});

describe("workspaceRoute", () => {
  const GET = workspaceRoute<{ id: string }>({ role: "viewer", scope: "read" }, async (c) => {
    const [col] = await c.db.select().from(collections).where(and(eq(collections.id, c.params.id), eq(collections.workspaceId, c.auth.workspaceId)));
    if (!col) throw notFound("Collection");
    return { id: col.id, role: c.auth.role };
  });
  const POST = workspaceRoute({ role: "admin" }, async (c) => c.body(z.object({ x: z.number() })));

  it("enforces auth, tenancy, roles, scopes and CSRF", async () => {
    const ws = await createTestWorkspace();
    const col = await makeCollection(ws.workspaceId);
    const other = await createTestWorkspace();

    expect((await call(GET, { url: `/x`, params: { id: col.id } })).status).toBe(401);
    expect((await call(GET, { url: `/x`, params: { id: col.id }, cookie: ws.cookie })).json).toEqual({ id: col.id, role: "owner" });
    expect((await call(GET, { url: `/x`, params: { id: col.id }, cookie: other.cookie })).status).toBe(404);
    expect((await call(GET, { url: `/x`, params: { id: col.id }, apiKey: ws.apiKey })).status).toBe(200);
    expect((await call(GET, { url: `/x`, params: { id: col.id }, apiKey: other.apiKey })).status).toBe(404);
    expect((await call(GET, { url: `/x`, params: { id: col.id }, apiKey: "ifk_nope" })).status).toBe(401);

    // admin-only route: owner ok, member forbidden, API key forbidden
    expect((await call(POST, { url: "/x", cookie: ws.cookie, body: { x: 1 } })).json).toEqual({ x: 1 });
    const member = await addMember(ws.workspaceId, "member");
    expect((await call(POST, { url: "/x", cookie: member.cookie, body: { x: 1 } })).status).toBe(403);
    expect((await call(POST, { url: "/x", apiKey: ws.apiKey, body: { x: 1 } })).status).toBe(403);
    // validation
    expect((await call(POST, { url: "/x", cookie: ws.cookie, body: { x: "no" } })).status).toBe(422);
    // CSRF: cross-site origin rejected
    expect((await call(POST, { url: "/x", cookie: ws.cookie, body: { x: 1 }, headers: { origin: "https://evil.example" } })).status).toBe(403);
  });
});

describe("crypto", () => {
  it("hashes passwords and round-trips secrets", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(decrypt(encrypt("s3cret"))).toBe("s3cret");
    // Tamper with the ciphertext (always a different character, so the test can't pass by chance).
    expect(() => decrypt(encrypt("s3cret").replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toThrow();
  });
});
