import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/server/db";
import { channels, messages } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { newToken } from "@/lib/server/crypto";
import { emailToInbound, type ParsedEmail } from "@/lib/server/channels/adapters/email";
import { parseUnipileEvent, unipileBase } from "@/lib/server/channels/unipile";
import { ingestInboundMessage } from "@/lib/server/channels/ingest";
import { registerLiveSender } from "@/lib/server/sync/live";
import { signState, verifyState } from "@/lib/server/sync/google-oauth";
import { telegramCredentials } from "@/lib/server/sync/connectors/telegram-user";
import { mailServers } from "@/lib/server/sync/connectors/email-imap";
import { POST as createChannel } from "@/app/api/v1/channels/route";
import { POST as unipileHook } from "@/app/api/webhooks/unipile/[token]/route";
import { POST as reply } from "@/app/api/v1/conversations/[id]/reply/route";
import { call, createTestWorkspace, opened } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const TG_HASH = "0123456789abcdef0123456789abcdef";

const email = (over: Partial<ParsedEmail>): ParsedEmail => ({ from: { name: null, email: "a@b.co" }, to: "me@shop.in", subject: "", text: "", html: null, messageId: null, date: new Date("2026-11-19T10:00:00Z"), headers: {}, attachments: [], ...over });

describe("LinkedIn notifications in email", () => {
  it("files LinkedIn message emails as LinkedIn conversations", () => {
    const p = emailToInbound(
      email({ from: { name: "LinkedIn", email: "messages-noreply@linkedin.com" }, subject: "Rahul Sharma sent you a new message", text: "Rahul Sharma\nHi, are you hiring for the sales role?\nView message\nUnsubscribe", messageId: "<abc@linkedin.com>" }),
    );
    expect(p).toMatchObject({ source: "linkedin", conversation: { externalId: "linkedin:rahul sharma", title: "Rahul Sharma" }, sender: { name: "Rahul Sharma" }, text: "Hi, are you hiring for the sales role?", externalId: "li:abc@linkedin.com" });
    // Other LinkedIn mail (digests, jobs) stays a normal email.
    expect(emailToInbound(email({ from: { name: "LinkedIn", email: "jobs-noreply@linkedin.com" }, subject: "New jobs for you" })).source).toBeUndefined();
  });
});

describe("LinkedIn via Unipile", () => {
  it("validates the DSN and parses message_received events", () => {
    expect(unipileBase("api8.unipile.com:13851")).toBe("https://api8.unipile.com:13851");
    expect(unipileBase("https://evil.example.com")).toBeNull();
    const ev = {
      event: "message_received",
      account_id: "acc1",
      account_info: { type: "LINKEDIN", user_id: "ME123" },
      chat_id: "chat9",
      message_id: "msg77",
      message: "Hi! Is the design role still open?",
      timestamp: "2026-11-19T10:00:00.000Z",
      sender: { attendee_id: "att1", attendee_name: "Priya N", attendee_provider_id: "PRIYA1", attendee_profile_url: "https://linkedin.com/in/priya" },
      attendees: [{ attendee_name: "Priya N", attendee_provider_id: "PRIYA1" }, { attendee_name: "Me", attendee_provider_id: "ME123" }],
    };
    expect(parseUnipileEvent(ev, "acc1")).toMatchObject({ externalId: "msg77", direction: "inbound", source: "linkedin", conversation: { externalId: "chat9", title: "Priya N", isGroup: false }, sender: { name: "Priya N" } });
    expect(parseUnipileEvent({ ...ev, sender: { attendee_provider_id: "ME123", attendee_name: "Me" } }, "acc1")?.direction).toBe("outbound");
    expect(parseUnipileEvent(ev, "other-account")).toBeNull();
    expect(parseUnipileEvent({ ...ev, event: "message_read" }, "acc1")).toBeNull();
  });

  it("creates the channel, verifies the webhook secret, ingests and replies through Unipile", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    expect((await call(createChannel, { url: "/x", cookie: ws.cookie, body: { type: "linkedin", name: "LI", config: { dsn: "evil.example.com" }, secrets: { apiKey: "k" } } })).status).toBe(422);
    const ch = await call(createChannel, { url: "/x", cookie: ws.cookie, body: { type: "linkedin", name: "LinkedIn", config: { dsn: "api8.unipile.com:13851" }, secrets: { apiKey: "unipile-key" } } });
    expect(ch.status).toBe(201);
    const secret = ch.json.generatedSecrets.webhookSecret;
    const token = String(ch.json.webhookUrl).split("/").pop()!;
    await db.update(channels).set({ config: { ...ch.json.config, accountId: "acc1" } }).where(eq(channels.id, ch.json.id));
    const ev = JSON.stringify({ event: "message_received", account_id: "acc1", account_info: { user_id: "ME" }, chat_id: "chat1", message_id: "m1", message: "Interested in a demo", timestamp: new Date().toISOString(), sender: { attendee_name: "Arjun", attendee_provider_id: "AR1" }, attendees: [] });
    const hook = (secretHeader: string) => call(unipileHook, { url: `/api/webhooks/unipile/${token}`, params: { token }, rawBody: ev, headers: { "content-type": "application/json", "x-infera-token": secretHeader } });
    expect((await hook("wrong")).status).toBe(401);
    expect((await hook(secret)).json).toMatchObject({ ok: true, ingested: 1 });
    const [m] = opened(await db.select().from(messages).where(eq(messages.externalId, "m1")));
    expect(m).toMatchObject({ text: "Interested in a demo", senderName: "Arjun" });

    const fetchMock = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response(JSON.stringify({ object: "MessageSent", message_id: "sent1" }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await call(reply, { url: "/x", cookie: ws.cookie, params: { id: m.conversationId }, body: { text: "Sure — Tuesday 4pm?" } });
    expect(r.status).toBe(201);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api8.unipile.com:13851/api/v1/chats/chat1/messages");
    const sentBody = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(sentBody.get("text")).toBe("Sure — Tuesday 4pm?");
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>)["X-API-KEY"]).toBe("unipile-key");
  });
});

describe("mailbox and Telegram account channels", () => {
  it("validates setup and resolves Gmail / Outlook servers", async () => {
    const ws = await createTestWorkspace();
    expect((await call(createChannel, { url: "/x", cookie: ws.cookie, body: { type: "email_imap", name: "Mail", config: { provider: "custom" } } })).status).toBe(422);
    expect((await call(createChannel, { url: "/x", cookie: ws.cookie, body: { type: "email_imap", name: "Mail", config: { provider: "gmail" }, secrets: { password: "app-pass" } } })).status).toBe(422);
    const ok = await call(createChannel, { url: "/x", cookie: ws.cookie, body: { type: "email_imap", name: "Gmail", config: { provider: "gmail", address: "Shop@Gmail.com" }, secrets: { password: "abcd efgh ijkl mnop" } } });
    expect(ok.status).toBe(201);
    expect(ok.json.config.address).toBe("shop@gmail.com");
    expect(mailServers({ provider: "gmail" })).toEqual({ imap: { host: "imap.gmail.com", port: 993 }, smtp: { host: "smtp.gmail.com", port: 465 } });
    expect(mailServers({ provider: "custom", imapHost: "mail.x.in", smtpHost: "smtp.x.in", smtpPort: 587 }).smtp).toEqual({ host: "smtp.x.in", port: 587 });
    // Telegram accounts use only the server's TELEGRAM_API_ID / TELEGRAM_API_HASH.
    vi.stubEnv("TELEGRAM_API_ID", "12345");
    vi.stubEnv("TELEGRAM_API_HASH", TG_HASH);
    expect((await call(createChannel, { url: "/x", cookie: ws.cookie, body: { type: "telegram_user", name: "TG", config: { apiId: "12345" } } })).status).toBe(400);
    expect((await call(createChannel, { url: "/x", cookie: ws.cookie, body: { type: "telegram_user", name: "TG" } })).status).toBe(201);
  });

  it("threads email replies and refuses LinkedIn-notification threads", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const [ch] = await db.insert(channels).values({ id: newId("chn"), workspaceId: ws.workspaceId, type: "email_imap", name: "Gmail", webhookToken: newToken(18), config: { provider: "gmail", address: "me@shop.in" } }).returning();
    const sent: { to: string; text: string; opts?: { subject?: string; inReplyTo?: string } }[] = [];
    const unregister = registerLiveSender(ch.id, { sendText: async (to, text, opts) => (sent.push({ to, text, opts }), { providerMessageId: "out-1@shop.in" }) });
    const r = await ingestInboundMessage(db, { ...emailToInbound(email({ from: { name: "Asha", email: "asha@x.com" }, subject: "Quote for 50 chairs", text: "Please send a quote", messageId: "<q1@x.com>" })), workspaceId: ws.workspaceId, channelId: ch.id });
    const res = await call(reply, { url: "/x", cookie: ws.cookie, params: { id: r.conversationId }, body: { text: "₹1,200 each, delivery Friday." } });
    expect(res.status).toBe(201);
    expect(sent[0]).toMatchObject({ to: "asha@x.com", text: "₹1,200 each, delivery Friday.", opts: { subject: "Re: Quote for 50 chairs", inReplyTo: "<q1@x.com>" } });
    const li = await ingestInboundMessage(db, { ...emailToInbound(email({ from: { name: "LinkedIn", email: "messages-noreply@linkedin.com" }, subject: "Priya sent you a new message", text: "Hello!" })), workspaceId: ws.workspaceId, channelId: ch.id });
    expect((await call(reply, { url: "/x", cookie: ws.cookie, params: { id: li.conversationId }, body: { text: "hi" } })).status).toBe(422);
    unregister();
    expect((await call(reply, { url: "/x", cookie: ws.cookie, params: { id: r.conversationId }, body: { text: "again" } })).status).toBe(503);
  });

  it("sends Telegram account replies through the live session", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const [ch] = await db.insert(channels).values({ id: newId("chn"), workspaceId: ws.workspaceId, type: "telegram_user", name: "TG", webhookToken: newToken(18), config: {} }).returning();
    const sent: string[] = [];
    const unregister = registerLiveSender(ch.id, { sendText: async (to, text) => (sent.push(`${to}:${text}`), { providerMessageId: `${to}:900` }) });
    const r = await ingestInboundMessage(db, { workspaceId: ws.workspaceId, channelId: ch.id, externalId: "4242:1", conversation: { externalId: "4242", title: "Anita" }, sender: { externalId: "4242", name: "Anita" }, text: "Price for 3 chairs?", sentAt: new Date() });
    const res = await call(reply, { url: "/x", cookie: ws.cookie, params: { id: r.conversationId }, body: { text: "₹900" } });
    expect(res.json.message).toMatchObject({ externalId: "4242:900", text: "₹900" });
    expect(sent).toEqual(["4242:₹900"]);
    unregister();
  });

  it("signs Google OAuth state and reads Telegram credentials", () => {
    const s = signState({ channelId: "chn_1", userId: "usr_1" });
    expect(verifyState(s)).toEqual({ channelId: "chn_1", userId: "usr_1" });
    expect(verifyState(s.slice(0, -2) + "xx")).toBeNull();
    expect(verifyState(null)).toBeNull();
    vi.stubEnv("TELEGRAM_API_ID", "");
    vi.stubEnv("TELEGRAM_API_HASH", "");
    expect(telegramCredentials()).toBeNull();
    vi.stubEnv("TELEGRAM_API_ID", "12345");
    vi.stubEnv("TELEGRAM_API_HASH", TG_HASH);
    expect(telegramCredentials()).toEqual({ apiId: 12345, apiHash: TG_HASH });
  });
});
