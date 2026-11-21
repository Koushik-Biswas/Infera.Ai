import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getDbState } from "@/lib/server/db";
import { channels, connectorSessions, messages } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { newToken } from "@/lib/server/crypto";
import { emitDomainEvent } from "@/lib/server/events/bus";
import { subscribeRealtime } from "@/lib/server/realtime";
import { enqueue, JOBS_CHANNEL } from "@/lib/server/jobs/queue";
import { getConnection, sendConnectionCommand, kvStore } from "@/lib/server/sync/session";
import type { ConnectorContext, ConnectorFactory } from "@/lib/server/sync/types";
import type { RealtimeEvent } from "@/lib/shared/types";
import { GET as streamGET } from "@/app/api/v1/stream/route";
import { GET as connGET, POST as connPOST } from "@/app/api/v1/channels/[id]/connection/route";
import { call, createTestWorkspace, BASE, opened } from "./helpers";

/* A fake persistent connector, controlled by the test. */
const fake = {
  starts: 0,
  stops: 0,
  commands: [] as string[],
  failNext: false,
  ctx: null as ConnectorContext | null,
};
const factory: ConnectorFactory = async (ctx) => {
  fake.starts++;
  fake.ctx = ctx;
  if (fake.failNext) {
    fake.failNext = false;
    throw new Error("boom");
  }
  await ctx.update({ state: "connected", account: { email: "shop@example.com" } });
  return {
    stop: async () => {
      fake.stops++;
    },
    command: async (cmd, arg) => {
      fake.commands.push(arg ? `${cmd}:${arg}` : cmd);
    },
  };
};
vi.mock("@/lib/server/sync/registry", () => ({
  connectorLoaders: { email_imap: async () => factory, whatsapp_web: async () => factory, telegram_user: async () => factory },
}));

async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function makeChannel(workspaceId: string, type: "email_imap" | "whatsapp_web" | "api" = "email_imap", config: Record<string, unknown> = {}) {
  const db = await getDb();
  const [ch] = await db.insert(channels).values({ id: newId("chn"), workspaceId, type, name: `Test ${type}`, webhookToken: newToken(18), config }).returning();
  return ch;
}

describe("realtime", () => {
  it("delivers NOTIFY-backed events on commit, only to the right workspace", async () => {
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    const db = await getDb();
    const got: RealtimeEvent[] = [];
    const off = await subscribeRealtime(a.workspaceId, (e) => got.push(e));
    await db.transaction(async (tx) => {
      await emitDomainEvent(tx, { type: "record.created", workspaceId: a.workspaceId, actor: { type: "system", id: null }, data: { recordId: "rec_x" } });
      await emitDomainEvent(tx, { type: "record.created", workspaceId: b.workspaceId, actor: { type: "system", id: null }, data: { recordId: "rec_y" } });
      await new Promise((r) => setTimeout(r, 100));
      expect(got).toHaveLength(0); // not before commit
    });
    await until(async () => got.length >= 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: "record.created", workspaceId: a.workspaceId, data: { recordId: "rec_x" } });
    off();
  });

  it("wakes job workers through pg_notify on enqueue", async () => {
    const db = await getDb();
    const woke: string[] = [];
    const unlisten = await (await getDbState()).listen(JOBS_CHANNEL, (p) => woke.push(p));
    await enqueue(db, { type: "retention_sweep", payload: {} });
    await until(async () => woke.includes("retention_sweep"));
    await unlisten();
  });

  it("streams workspace events over SSE", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const controller = new AbortController();
    const req = new Request(new URL("/api/v1/stream", BASE), { headers: { cookie: ws.cookie, host: "localhost:3000" }, signal: controller.signal });
    const res = await streamGET(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) =>
      until(async () => {
        const { value } = await Promise.race([reader.read(), new Promise<{ value: undefined }>((r) => setTimeout(() => r({ value: undefined }), 200))]);
        if (value) text += decoder.decode(value);
        return text.includes(needle);
      });
    await readUntil("event: ready");
    await emitDomainEvent(db, { type: "message.received", workspaceId: ws.workspaceId, actor: { type: "system", id: null }, data: { messageId: "msg_1" } });
    await readUntil("event: message.received");
    expect(text).toContain('"messageId":"msg_1"');
    controller.abort();
    await reader.cancel().catch(() => {});
    // Unauthenticated → 401
    const anon = await streamGET(new Request(new URL("/api/v1/stream", BASE)), { params: Promise.resolve({}) });
    expect(anon.status).toBe(401);
  });
});

describe("connection API", () => {
  it("reports status, enforces tenancy, and refuses commands when sync is off", async () => {
    const ws = await createTestWorkspace();
    const other = await createTestWorkspace();
    const ch = await makeChannel(ws.workspaceId);
    const r = await call(connGET, { url: "/x", params: { id: ch.id }, cookie: ws.cookie });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ channelId: ch.id, type: "email_imap", state: "disconnected", realtime: "persistent", syncAvailable: false });
    expect((await call(connGET, { url: "/x", params: { id: ch.id }, cookie: other.cookie })).status).toBe(404);
    // Tests run without the worker, so live sync is unavailable here → 503.
    const post = await call(connPOST, { url: "/x", params: { id: ch.id }, cookie: ws.cookie, body: { action: "connect" } });
    expect(post.status).toBe(503);
    expect(post.json.error.code).toBe("sync_unavailable");
    const api = await makeChannel(ws.workspaceId, "api");
    expect((await call(connGET, { url: "/x", params: { id: api.id }, cookie: ws.cookie })).json).toMatchObject({ realtime: "webhook", state: "connected" });
  });
});

describe("sync manager", () => {
  let stop: (() => Promise<void>) | null = null;
  afterAll(async () => {
    await stop?.();
  });

  it("runs connectors under a lease and executes console commands", async () => {
    const { startSyncManager, stopSyncManager } = await import("@/lib/server/sync/manager");
    stop = stopSyncManager;
    const ws = await createTestWorkspace();
    const db = await getDb();
    const ch = await makeChannel(ws.workspaceId);
    const session = async () => (await db.select().from(connectorSessions).where(eq(connectorSessions.channelId, ch.id)))[0];
    const mgr = startSyncManager();

    // Not started until the user connects.
    await new Promise((r) => setTimeout(r, 700));
    expect(fake.starts).toBe(0);

    await sendConnectionCommand(db, ch, "connect");
    await until(async () => (await session())?.state === "connected");
    expect(fake.starts).toBe(1);
    expect((await session()).leaseOwner).toBe(mgr.workerId);
    expect((await getConnection(db, ws.workspaceId, ch.id))!.account).toEqual({ email: "shop@example.com" });

    // Ingest through the context: stored as a message of this channel.
    const r = await fake.ctx!.ingest({
      externalId: "imap-1",
      conversation: { externalId: "thread-1", title: "Order" },
      sender: { email: "buyer@example.com", name: "Buyer" },
      text: "Hi, I want 2 blue shirts",
      sentAt: new Date(),
    });
    expect(r.duplicate).toBe(false);
    const [m] = opened(await db.select().from(messages).where(eq(messages.id, r.messageId)));
    expect(m.channelId).toBe(ch.id);
    expect((await fake.ctx!.ingest({ externalId: "imap-1", conversation: { externalId: "thread-1" }, sender: {}, text: "x", sentAt: new Date() })).duplicate).toBe(true);

    // Encrypted auth + kv + cursor
    await fake.ctx!.setAuth({ token: "secret" });
    expect(await fake.ctx!.getAuth()).toEqual({ token: "secret" });
    expect((await session()).authEnc).not.toContain("secret");
    await fake.ctx!.kv.set("k1", { a: 1 });
    expect(await kvStore(db, ch.id).get("k1")).toEqual({ a: 1 });
    await fake.ctx!.setCursor({ uid: 10 });
    await fake.ctx!.setCursor({ mailbox: "INBOX" });
    expect(await fake.ctx!.getCursor()).toEqual({ uid: 10, mailbox: "INBOX" });

    // resync is forwarded to the runtime
    await sendConnectionCommand(db, ch, "resync");
    await until(async () => fake.commands.includes("resync"));

    // disconnect stops it and releases the lease
    await sendConnectionCommand(db, ch, "disconnect");
    await until(async () => (await session()).state === "disconnected" && fake.stops === 1);
    expect((await session()).leaseOwner).toBeNull();

    // logout clears credentials
    await sendConnectionCommand(db, ch, "connect");
    await until(async () => (await session()).state === "connected" && fake.starts === 2);
    await sendConnectionCommand(db, ch, "logout");
    await until(async () => (await session()).state === "logged_out");
    expect(fake.commands).toContain("logout");
    expect((await session()).authEnc).toBeNull();
    expect(await kvStore(db, ch.id).get("k1")).toBeNull();

    // A failing start → error state (and no tight restart loop)
    fake.failNext = true;
    await sendConnectionCommand(db, ch, "connect");
    await until(async () => (await session()).state === "error");
    expect((await session()).lastError).toContain("boom");
    expect((await session()).leaseOwner).toBeNull();
    const startsAfterFail = fake.starts;
    await new Promise((r) => setTimeout(r, 600));
    expect(fake.starts).toBe(startsAfterFail);
  });
});
