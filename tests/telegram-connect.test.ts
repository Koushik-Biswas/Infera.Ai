/**
 * Telegram account connect: server-only credentials, no per-channel api_id/api_hash, the
 * integrations flag, connection commands (phone_login / code sealed at rest) and the
 * connector's login flow (QR → two-step password, phone → code, FLOOD_WAIT, API_ID_INVALID)
 * with teleproto fully mocked — no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/server/db";
import { channels, connectorSessions } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { encryptJson, newToken } from "@/lib/server/crypto";
import { openText, sealText } from "@/lib/server/data/sealed";
import { decryptSecrets } from "@/lib/server/channels/registry";
import type { ConnectorContext, SessionPatch } from "@/lib/server/sync/types";
import { CODE_EXPIRED, TELEGRAM_CREDENTIALS_MISSING, TELEGRAM_CREDENTIALS_REJECTED, WRONG_PASSWORD, describeLoginError, formatWait, maskPhone } from "@/lib/server/sync/telegram-login";
import { POST as createChannel } from "@/app/api/v1/channels/route";
import { PATCH as patchChannel, GET as getChannel } from "@/app/api/v1/channels/[id]/route";
import { POST as connPOST } from "@/app/api/v1/channels/[id]/connection/route";
import { GET as integrationsGET } from "@/app/api/v1/integrations/route";
import { call, createTestWorkspace } from "./helpers";

// The connection API refuses commands when live sync is off (as it is under Vitest); enable it for these tests.
vi.mock("@/lib/server/sync/session", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/sync/session")>()), syncEnabled: () => true }));

/* ------------------------------ Fake teleproto ------------------------------ */

type QrParams = { abortSignal?: AbortSignal; qrCode: (c: { token: Buffer; expires: number }) => Promise<void>; password: (hint?: string) => Promise<string>; onError: (e: Error) => Promise<boolean> };
type PhoneParams = { phoneNumber: () => Promise<string>; phoneCode: (viaApp?: boolean, info?: { type?: string }) => Promise<string>; password: (hint?: string) => Promise<string>; onError: (e: Error) => Promise<boolean> };

const tg = vi.hoisted(() => ({
  created: [] as { apiId: number; apiHash: string }[],
  authorized: false,
  qrCalls: 0,
  phoneCalls: 0,
  qr: null as null | ((p: unknown) => Promise<unknown>),
  phone: null as null | ((p: unknown) => Promise<unknown>),
}));

vi.mock("teleproto", () => {
  class StringSession {
    constructor(public value = "") {}
    save() {
      return "session-string";
    }
  }
  class TelegramClient {
    session: StringSession;
    constructor(session: StringSession, apiId: number, apiHash: string) {
      this.session = session;
      tg.created.push({ apiId, apiHash });
    }
    async connect() {}
    async checkAuthorization() {
      return tg.authorized;
    }
    async signInUserWithQrCode(_creds: unknown, params: unknown) {
      tg.qrCalls++;
      return tg.qr!(params);
    }
    async signInUser(_creds: unknown, params: unknown) {
      tg.phoneCalls++;
      return tg.phone!(params);
    }
    async getMe() {
      return { id: 777, phone: "919876543210", firstName: "Asha" };
    }
    addEventHandler() {}
    async destroy() {}
    async logOut() {}
  }
  class NewMessage {}
  class Logger {}
  return {
    TelegramClient,
    sessions: { StringSession },
    events: { NewMessage },
    utils: { getDisplayName: (e: { firstName?: string }) => e.firstName ?? "", getPeerId: () => "1" },
    Api: {},
    Logger,
  };
});

const HASH = "0123456789abcdef0123456789abcdef";
const setEnv = () => {
  vi.stubEnv("TELEGRAM_API_ID", "12345");
  vi.stubEnv("TELEGRAM_API_HASH", HASH);
};
const clearEnv = () => {
  vi.stubEnv("TELEGRAM_API_ID", "");
  vi.stubEnv("TELEGRAM_API_HASH", "");
};

beforeEach(() => {
  tg.created.length = 0;
  tg.authorized = false;
  tg.qrCalls = 0;
  tg.phoneCalls = 0;
  tg.qr = null;
  tg.phone = null;
});
afterEach(() => vi.unstubAllEnvs());

async function until<T>(fn: () => T | null | undefined | false, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const rpcError = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(`400: ${code}`), { errorMessage: code, ...extra });
const abortError = () => Object.assign(new Error("QR login aborted"), { name: "AbortError" });

/** A connector context that records state updates and failures. */
function fakeContext(config: Record<string, unknown> = {}, secrets: Record<string, string> = {}) {
  const updates: SessionPatch[] = [];
  const failures: unknown[] = [];
  const abort = new AbortController();
  const ctx = {
    db: null as never,
    channel: { id: newId("chn"), workspaceId: "ws_test", type: "telegram_user", name: "TG", config: { historyDays: 0, ...config } } as never,
    workspaceId: "ws_test",
    secrets,
    signal: abort.signal,
    log: () => {},
    update: async (p: SessionPatch) => void updates.push(p),
    getAuth: async () => null,
    setAuth: async () => {},
    getCursor: async () => ({}),
    setCursor: async () => {},
    kv: {} as never,
    ingest: async () => ({}) as never,
    ingestMany: async () => ({ imported: 0, duplicates: 0 }),
    reloadChannel: async () => null,
    fail: (e: unknown) => void failures.push(e),
  } satisfies ConnectorContext;
  const last = <K extends keyof SessionPatch>(key: K) => [...updates].reverse().find((u) => key in u)?.[key];
  return { ctx, updates, failures, last };
}

async function startConnector(config: Record<string, unknown> = {}, secrets: Record<string, string> = {}) {
  const { createConnector } = await import("@/lib/server/sync/connectors/telegram-user");
  const f = fakeContext(config, secrets);
  const runtime = await createConnector(f.ctx);
  return { ...f, runtime };
}

/** QR flow that publishes one code, then waits until aborted (or `scan` resolves it). */
function qrThatWaits(onParams?: (p: QrParams) => void) {
  return (raw: unknown) => {
    const p = raw as QrParams;
    onParams?.(p);
    return new Promise((resolve, reject) => {
      void p.qrCode({ token: Buffer.from("tok"), expires: Math.floor(Date.now() / 1000) + 30 });
      p.abortSignal?.addEventListener("abort", () => reject(abortError()), { once: true });
    });
  };
}

/* --------------------------------- Server ---------------------------------- */

describe("Telegram credentials are server-only", () => {
  it("rejects per-channel api_id / api_hash with 400", async () => {
    setEnv();
    const ws = await createTestWorkspace();
    for (const body of [
      { type: "telegram_user", name: "TG", config: { apiId: "12345" } },
      { type: "telegram_user", name: "TG", secrets: { apiHash: HASH } },
      { type: "telegram_user", name: "TG", config: { apiId: "12345" }, secrets: { apiHash: HASH } },
    ]) {
      const res = await call(createChannel, { url: "/x", cookie: ws.cookie, body });
      expect(res.status).toBe(400);
      expect(res.json.error.message).toMatch(/Per-channel Telegram credentials are not supported/);
    }
    const ok = await call(createChannel, { url: "/x", cookie: ws.cookie, body: { type: "telegram_user", name: "TG" } });
    expect(ok.status).toBe(201);
    expect((await call(patchChannel, { url: "/x", method: "PATCH", cookie: ws.cookie, params: { id: ok.json.id }, body: { config: { apiId: "1" } } })).status).toBe(400);
    expect((await call(patchChannel, { url: "/x", method: "PATCH", cookie: ws.cookie, params: { id: ok.json.id }, body: { secrets: { apiHash: HASH } } })).status).toBe(400);
  });

  it("refuses to create a Telegram account channel when the server isn't configured", async () => {
    clearEnv();
    const ws = await createTestWorkspace();
    const res = await call(createChannel, { url: "/x", cookie: ws.cookie, body: { type: "telegram_user", name: "TG" } });
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("telegram_not_configured");
    expect(res.json.error.message).toMatch(/TELEGRAM_API_ID and TELEGRAM_API_HASH/);
  });

  it("keeps old channels that stored their own credentials working, without showing them", async () => {
    setEnv();
    const ws = await createTestWorkspace();
    const db = await getDb();
    const [legacy] = await db
      .insert(channels)
      .values({ id: newId("chn"), workspaceId: ws.workspaceId, type: "telegram_user", name: "Old TG", webhookToken: newToken(18), config: { apiId: "99999", historyDays: 7 }, secretsEnc: encryptJson({ apiHash: "f".repeat(32) }) })
      .returning();
    const dto = await call(getChannel, { url: "/x", cookie: ws.cookie, params: { id: legacy.id } });
    expect(dto.json.config).toEqual({ historyDays: 7 });
    expect(dto.json.secretsSet).toEqual([]);
    // Renaming still works; the stored (unused) values are left untouched.
    const renamed = await call(patchChannel, { url: "/x", method: "PATCH", cookie: ws.cookie, params: { id: legacy.id }, body: { name: "Sales TG" } });
    expect(renamed.status).toBe(200);
    expect(renamed.json.name).toBe("Sales TG");
    expect(renamed.json.config.apiId).toBeUndefined();
    const [row] = await db.select().from(channels).where(eq(channels.id, legacy.id));
    expect(row.config.apiId).toBe("99999");
    expect(decryptSecrets(row).apiHash).toBe("f".repeat(32));
  });

  it("reports the telegram integration flag from env only", async () => {
    const ws = await createTestWorkspace();
    clearEnv();
    expect((await call(integrationsGET, { url: "/x", cookie: ws.cookie })).json.telegram).toBe(false);
    vi.stubEnv("TELEGRAM_API_ID", "12345");
    vi.stubEnv("TELEGRAM_API_HASH", "not-a-hash");
    expect((await call(integrationsGET, { url: "/x", cookie: ws.cookie })).json.telegram).toBe(false);
    setEnv();
    expect((await call(integrationsGET, { url: "/x", cookie: ws.cookie })).json.telegram).toBe(true);
  });
});

describe("Telegram connection commands", () => {
  async function telegramChannel(workspaceId: string, type: "telegram_user" | "email_imap" = "telegram_user") {
    const db = await getDb();
    const [ch] = await db.insert(channels).values({ id: newId("chn"), workspaceId, type, name: "TG", webhookToken: newToken(18), config: {} }).returning();
    return ch;
  }
  const commandRow = async (channelId: string) => (await (await getDb()).select().from(connectorSessions).where(eq(connectorSessions.channelId, channelId)))[0];

  it("queues phone_login / code / password sealed, never in plain text", async () => {
    setEnv();
    const ws = await createTestWorkspace();
    const ch = await telegramChannel(ws.workspaceId);
    const phone = await call(connPOST, { url: "/x", cookie: ws.cookie, params: { id: ch.id }, body: { action: "phone_login", phone: "+91 98765 43210" } });
    expect(phone.status).toBe(200);
    let row = await commandRow(ch.id);
    expect(row.command).toBe("phone_login");
    expect(row.commandArg).not.toContain("9876543210");
    expect(openText(row.commandArg)).toBe("+919876543210");

    expect((await call(connPOST, { url: "/x", cookie: ws.cookie, params: { id: ch.id }, body: { action: "code", code: "12 345" } })).status).toBe(200);
    row = await commandRow(ch.id);
    expect(row.command).toBe("code");
    expect(row.commandArg).not.toContain("12345");
    expect(openText(row.commandArg)).toBe("12345");

    expect((await call(connPOST, { url: "/x", cookie: ws.cookie, params: { id: ch.id }, body: { action: "password", password: "hunter2" } })).status).toBe(200);
    row = await commandRow(ch.id);
    expect(row.commandArg).not.toContain("hunter2");
    expect(openText(row.commandArg)).toBe("hunter2");
  });

  it("validates input, limits the steps to Telegram channels and other workspaces get 404", async () => {
    setEnv();
    const ws = await createTestWorkspace();
    const other = await createTestWorkspace();
    const ch = await telegramChannel(ws.workspaceId);
    expect((await call(connPOST, { url: "/x", cookie: ws.cookie, params: { id: ch.id }, body: { action: "phone_login" } })).status).toBe(422);
    expect((await call(connPOST, { url: "/x", cookie: ws.cookie, params: { id: ch.id }, body: { action: "phone_login", phone: "12" } })).status).toBe(422);
    expect((await call(connPOST, { url: "/x", cookie: ws.cookie, params: { id: ch.id }, body: { action: "code", code: "!" } })).status).toBe(422);
    const mail = await telegramChannel(ws.workspaceId, "email_imap");
    expect((await call(connPOST, { url: "/x", cookie: ws.cookie, params: { id: mail.id }, body: { action: "code", code: "12345" } })).status).toBe(422);
    expect((await call(connPOST, { url: "/x", cookie: other.cookie, params: { id: ch.id }, body: { action: "connect" } })).status).toBe(404);
  });

  it("asks an admin to configure the server when credentials are missing", async () => {
    clearEnv();
    const ws = await createTestWorkspace();
    const ch = await telegramChannel(ws.workspaceId);
    const res = await call(connPOST, { url: "/x", cookie: ws.cookie, params: { id: ch.id }, body: { action: "connect" } });
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("telegram_not_configured");
    // Disconnecting still works.
    expect((await call(connPOST, { url: "/x", cookie: ws.cookie, params: { id: ch.id }, body: { action: "disconnect" } })).status).toBe(200);
  });
});

/* -------------------------------- Connector -------------------------------- */

describe("telegram_user connector", () => {
  it("uses only the server's credentials, ignoring old per-channel ones", async () => {
    setEnv();
    tg.qr = qrThatWaits();
    const c = await startConnector({ apiId: "99999" }, { apiHash: "f".repeat(32) });
    expect(tg.created).toEqual([{ apiId: 12345, apiHash: HASH }]);
    await c.runtime.stop();
  });

  it("explains missing server credentials", async () => {
    clearEnv();
    const { createConnector } = await import("@/lib/server/sync/connectors/telegram-user");
    await expect(createConnector(fakeContext().ctx)).rejects.toThrow(TELEGRAM_CREDENTIALS_MISSING);
    expect(tg.created).toEqual([]);
  });

  it("QR login → wrong then right two-step password → connected", async () => {
    setEnv();
    let params: QrParams | null = null;
    tg.qr = async (raw) => {
      const p = raw as QrParams;
      params = p;
      await p.qrCode({ token: Buffer.from("abc"), expires: Math.floor(Date.now() / 1000) + 30 });
      // Scanned; the account has two-step verification.
      for (;;) {
        const pw = await p.password("pet name");
        if (pw === "right") return { id: 777 };
        if (await p.onError(rpcError("PASSWORD_HASH_INVALID"))) throw new Error("AUTH_USER_CANCEL");
      }
    };
    const c = await startConnector();
    await until(() => c.last("qr"));
    expect(c.last("qr")).toBe(`tg://login?token=${Buffer.from("abc").toString("base64url")}`);
    expect(params).not.toBeNull();

    const prompt1 = await until(() => c.last("prompt"));
    expect(prompt1).toMatchObject({ kind: "password", hint: "pet name", error: null });
    await c.runtime.command!("password", sealText("wrong"));
    const prompt2 = await until(() => {
      const p = c.last("prompt");
      return p && p.at !== prompt1.at ? p : null;
    });
    expect(prompt2).toMatchObject({ kind: "password", error: WRONG_PASSWORD });
    await c.runtime.command!("password", sealText("right"));
    await until(() => c.updates.some((u) => u.state === "connected"));
    expect(c.failures).toEqual([]);
    await c.runtime.stop();
  });

  it("switches to the phone number, asks for the code, and re-asks on an expired code", async () => {
    setEnv();
    tg.qr = qrThatWaits();
    let codes = 0;
    tg.phone = async (raw) => {
      const p = raw as PhoneParams;
      expect(await p.phoneNumber()).toBe("+919876543210");
      for (;;) {
        const code = await p.phoneCode(true, { type: "app" });
        codes++;
        if (code === "22222") return { id: 777 };
        if (await p.onError(rpcError("PHONE_CODE_EXPIRED"))) throw new Error("AUTH_USER_CANCEL");
      }
    };
    const c = await startConnector();
    await until(() => c.last("qr"));
    await c.runtime.command!("phone_login", sealText("+919876543210"));
    const first = await until(() => c.last("prompt"));
    expect(tg.phoneCalls).toBe(1);
    expect(first).toMatchObject({ kind: "code", via: "app", phoneMasked: maskPhone("+919876543210"), error: null });
    expect(JSON.stringify(c.updates)).not.toContain("9876543210");
    await c.runtime.command!("code", sealText("11111"));
    const second = await until(() => {
      const p = c.last("prompt");
      return p && p.at !== first.at ? p : null;
    });
    expect(second).toMatchObject({ kind: "code", error: CODE_EXPIRED });
    await c.runtime.command!("code", sealText("22 222"));
    await until(() => c.updates.some((u) => u.state === "connected"));
    expect(codes).toBe(2);
    await c.runtime.stop();
  });

  it("an invalid phone number falls back to a fresh QR code with the reason", async () => {
    setEnv();
    tg.qr = qrThatWaits();
    tg.phone = async (raw) => {
      const p = raw as PhoneParams;
      await p.phoneNumber();
      if (await p.onError(rpcError("PHONE_NUMBER_INVALID"))) throw new Error("AUTH_USER_CANCEL");
      return { id: 1 };
    };
    const c = await startConnector();
    await until(() => tg.qrCalls === 1);
    await c.runtime.command!("phone_login", sealText("+10000000000"));
    await until(() => tg.qrCalls === 2, 8000);
    const notice = await until(() => c.updates.find((u) => typeof u.lastError === "string" && u.qr));
    expect(notice.lastError).toMatch(/phone number isn't valid/);
    await c.runtime.stop();
  });

  it("FLOOD_WAIT shows how long to wait; 'New QR code' retries right away", async () => {
    setEnv();
    tg.qr = async () => {
      if (tg.qrCalls === 1) throw rpcError("FLOOD_WAIT_150", { seconds: 150 });
      return new Promise(() => {});
    };
    const c = await startConnector();
    const waiting = await until(() => c.updates.find((u) => typeof u.lastError === "string" && u.lastError.includes("wait")));
    expect(waiting).toMatchObject({ state: "pairing", qr: null });
    expect(waiting.lastError).toContain("3 minutes");
    await c.runtime.command!("connect", null);
    await until(() => tg.qrCalls === 2);
    expect(c.failures).toEqual([]);
    await c.runtime.stop();
  });

  it("API_ID_INVALID tells the admin to fix the server credentials", async () => {
    setEnv();
    tg.qr = async () => {
      throw rpcError("API_ID_INVALID");
    };
    const c = await startConnector();
    const failure = await until(() => c.failures[0]);
    expect(String((failure as Error).message)).toBe(TELEGRAM_CREDENTIALS_REJECTED);
    await c.runtime.stop();
  });
});

describe("login error messages", () => {
  it("are readable and never echo the raw request", () => {
    expect(describeLoginError(rpcError("FLOOD_WAIT_45", { seconds: 45 }))).toMatchObject({ waitSeconds: 45 });
    expect(describeLoginError(rpcError("API_ID_INVALID"))).toMatchObject({ credentials: true });
    expect(describeLoginError(rpcError("PASSWORD_HASH_INVALID"))?.message).toBe(WRONG_PASSWORD);
    expect(describeLoginError(new Error("ECONNRESET"))).toBeNull();
    expect(formatWait(45)).toBe("45 seconds");
    expect(formatWait(3600 + 20 * 60)).toBe("1 hour 20 minutes");
    expect(maskPhone("+919876543210")).toBe("+91 •••••• 3210");
  });
});
