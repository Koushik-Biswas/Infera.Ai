import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { getDb } from "@/lib/server/db";
import { auditLog, channels, contacts, conversations, events, files, jobs, messages } from "@/lib/server/db/schema";
import { hmacBase64, hmacHex } from "@/lib/server/crypto";
import { PermanentJobError } from "@/lib/server/jobs/queue";
import type { ProcessingResult } from "@/lib/shared/types";
import { parseWhatsAppPayload, verifyWhatsAppSignature, whatsappVerifyChallenge } from "@/lib/server/channels/adapters/whatsapp";
import { parseTelegramUpdate, telegramBotId, verifyTelegramSecret } from "@/lib/server/channels/adapters/telegram";
import { emailToInbound, normalizeSubject, parseEmailForm, parseEmailJson, stripQuotedReply } from "@/lib/server/channels/adapters/email";
import { parseSlackPayload, slackToPlain, verifySlackSignature } from "@/lib/server/channels/adapters/slack";
import { parseTwilioForm, twilioSignature, verifyTwilioSignature } from "@/lib/server/channels/adapters/twilio";
import { ChannelNotFoundError, ingestInboundMessage } from "@/lib/server/channels/ingest";
import { ensureApiChannel } from "@/lib/server/channels/registry";
import { fetchProviderMedia } from "@/lib/server/channels/media";
import { handleSendReply } from "@/lib/server/channels/jobs";
import { zonedTimeToUtc } from "@/lib/server/channels/whatsapp-import";
import { GET as listChannels, POST as createChannel } from "@/app/api/v1/channels/route";
import { DELETE as deleteChannel, GET as getChannel, PATCH as patchChannel } from "@/app/api/v1/channels/[id]/route";
import { POST as testChannel } from "@/app/api/v1/channels/[id]/test/route";
import { GET as listEvents, POST as postEvent } from "@/app/api/v1/events/route";
import { POST as importWhatsApp } from "@/app/api/v1/imports/whatsapp/route";
import { POST as reply } from "@/app/api/v1/conversations/[id]/reply/route";
import { addMember, BASE, call, createTestWorkspace, opened } from "./helpers";

const { processEventMock } = vi.hoisted(() => ({ processEventMock: vi.fn() }));
vi.mock("@/lib/server/pipeline/run", () => ({ processEvent: processEventMock, dryRunProcess: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const BOT_TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/* =============================== Adapters =============================== */

describe("WhatsApp adapter", () => {
  const payload = (messages: unknown[], extra: Record<string, unknown> = {}) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550001111", phone_number_id: "109876543210" },
              contacts: [{ profile: { name: "Rahul Sharma" }, wa_id: "919847011234" }],
              messages,
              ...extra,
            },
          },
        ],
      },
    ],
  });

  it("parses text, image with caption, location and interactive replies; drops reactions and statuses", () => {
    const batches = parseWhatsAppPayload(
      payload([
        { from: "919847011234", id: "wamid.A1", timestamp: "1763452800", type: "text", text: { body: "I need 50 boxes by Friday" } },
        { from: "919847011234", id: "wamid.A2", timestamp: "1763452860", type: "image", image: { caption: "this design", mime_type: "image/jpeg", sha256: "x", id: "MEDIA_1" } },
        { from: "919847011234", id: "wamid.A3", timestamp: "1763452900", type: "location", location: { latitude: 12.97, longitude: 77.59, name: "MG Road shop" } },
        { from: "919847011234", id: "wamid.A4", timestamp: "1763452950", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "b1", title: "Confirm order" } } },
        { from: "919847011234", id: "wamid.A5", timestamp: "1763452960", type: "reaction", reaction: { message_id: "wamid.A1", emoji: "👍" } },
      ]),
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].phoneNumberId).toBe("109876543210");
    const [text, image, location, button] = batches[0].messages;
    expect(batches[0].messages).toHaveLength(4);
    expect(text).toMatchObject({ externalId: "wamid.A1", text: "I need 50 boxes by Friday", kind: "text", conversation: { externalId: "919847011234", title: "Rahul Sharma", isGroup: false }, sender: { name: "Rahul Sharma", phone: "+919847011234" } });
    expect(text.sentAt.toISOString()).toBe(new Date(1763452800 * 1000).toISOString());
    expect(image).toMatchObject({ kind: "image", text: "this design", attachments: [{ mime: "image/jpeg", providerId: "MEDIA_1", name: "image-MEDIA_1.jpg" }] });
    expect(location).toMatchObject({ kind: "location", text: "📍 12.97,77.59 MG Road shop" });
    expect(button.text).toBe("Confirm order");
  });

  it("ignores status-only payloads and other objects", () => {
    const statusOnly = payload([], { statuses: [{ id: "wamid.X", status: "delivered", recipient_id: "919847011234" }] });
    delete (statusOnly.entry[0].changes[0].value as Record<string, unknown>).messages;
    expect(parseWhatsAppPayload(statusOnly).flatMap((b) => b.messages)).toEqual([]);
    expect(parseWhatsAppPayload({ object: "page", entry: [] })).toEqual([]);
    expect(parseWhatsAppPayload("garbage")).toEqual([]);
  });

  it("verifies X-Hub-Signature-256 and the subscription challenge", () => {
    const body = JSON.stringify(payload([]));
    const sig = `sha256=${hmacHex("sha256", "app-secret", body)}`;
    expect(verifyWhatsAppSignature(body, sig, "app-secret")).toBe(true);
    expect(verifyWhatsAppSignature(Buffer.from(body), sig, "app-secret")).toBe(true);
    expect(verifyWhatsAppSignature(body + " ", sig, "app-secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, sig, "other-secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, null, "app-secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, "sha256=zz", "app-secret")).toBe(false);
    const q = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "vt-1", "hub.challenge": "12345" });
    expect(whatsappVerifyChallenge(q, "vt-1")).toBe("12345");
    expect(whatsappVerifyChallenge(q, "vt-2")).toBeNull();
    expect(whatsappVerifyChallenge(q, "")).toBeNull();
  });
});

describe("Telegram adapter", () => {
  it("parses private text and group photos (largest size)", () => {
    const t = parseTelegramUpdate({ update_id: 1, message: { message_id: 10, from: { id: 42, is_bot: false, first_name: "Anita", last_name: "K" }, chat: { id: 42, type: "private", first_name: "Anita", last_name: "K" }, date: 1763452800, text: "Price for 3 chairs?" } });
    expect(t).toMatchObject({ externalId: "42:10", text: "Price for 3 chairs?", conversation: { externalId: "42", isGroup: false, title: "Anita K" }, sender: { externalId: "42", name: "Anita K" } });
    const p = parseTelegramUpdate({
      update_id: 2,
      message: {
        message_id: 11,
        from: { id: 7, is_bot: false, first_name: "Vik" },
        chat: { id: -100123, type: "supergroup", title: "Orders group" },
        date: 1763452900,
        caption: "paid ₹500",
        photo: [
          { file_id: "small", file_unique_id: "u1", width: 90, height: 90, file_size: 1200 },
          { file_id: "big", file_unique_id: "u2", width: 1280, height: 960, file_size: 90000 },
        ],
      },
    });
    expect(p).toMatchObject({ externalId: "-100123:11", kind: "image", text: "paid ₹500", conversation: { externalId: "-100123", isGroup: true, title: "Orders group" }, attachments: [{ providerId: "big", mime: "image/jpeg" }] });
    expect(parseTelegramUpdate({ update_id: 3, message: { message_id: 1, from: { id: 1, is_bot: true }, chat: { id: 1, type: "private" }, date: 1, text: "bot" } })).toBeNull();
    expect(parseTelegramUpdate({ update_id: 4, callback_query: {} })).toBeNull();
    // Edits are kept as new facts with their own id.
    const e = parseTelegramUpdate({ update_id: 5, edited_message: { message_id: 10, from: { id: 42 }, chat: { id: 42, type: "private" }, date: 1763452800, edit_date: 1763452999, text: "Price for 4 chairs?" } });
    expect(e?.externalId).toBe("42:10:e1763452999");
  });

  it("checks the secret token and bot id", () => {
    expect(verifyTelegramSecret("abc", "abc")).toBe(true);
    expect(verifyTelegramSecret("abd", "abc")).toBe(false);
    expect(verifyTelegramSecret(null, "abc")).toBe(false);
    expect(telegramBotId(BOT_TOKEN)).toBe("123456789");
    expect(telegramBotId("nope")).toBeNull();
  });
});

describe("Email adapter", () => {
  it("parses Postmark JSON, strips quoted replies and threads by normalised subject", () => {
    const parsed = parseEmailJson({
      From: "Rahul Sharma <Rahul@Example.com>",
      FromFull: { Email: "Rahul@Example.com", Name: "Rahul Sharma" },
      To: "orders@shop.test",
      Subject: "Re: Fwd: Order #4411",
      TextBody: "Please send 10 more units.\n\nOn Tue, 17 Nov 2026 at 10:00, Shop <orders@shop.test> wrote:\n> Your order is confirmed",
      MessageID: "pm-123",
      Date: "Wed, 18 Nov 2026 09:30:00 +0530",
      Headers: [{ Name: "Message-ID", Value: "<abc@mail.example.com>" }],
      Attachments: [{ Name: "po.pdf", Content: Buffer.from("%PDF-1.4").toString("base64"), ContentType: "application/pdf", ContentLength: 8 }],
    });
    expect(parsed).not.toBeNull();
    const m = emailToInbound(parsed!);
    expect(m.text).toBe("Re: Fwd: Order #4411\n\nPlease send 10 more units.");
    expect(m.externalId).toBe("pm-123");
    expect(m.conversation.externalId).toBe("rahul@example.com|order #4411");
    expect(m.sender).toMatchObject({ email: "rahul@example.com", name: "Rahul Sharma" });
    expect(m.attachments?.[0]).toMatchObject({ name: "po.pdf", mime: "application/pdf" });
    expect(m.attachments?.[0].data?.toString()).toBe("%PDF-1.4");
    expect(m.sentAt.toISOString()).toBe("2026-11-18T04:00:00.000Z");
    expect(m.skipProcessing).toBe(false);
  });

  it("parses Mailgun-style forms, generic JSON, and skips auto-replies", () => {
    const f = parseEmailForm({ from: "a@b.co", subject: "Quote", "body-plain": "Need a quote\n-- \nA, CEO", "Message-Id": "<m1@b.co>" }, [{ name: "x.txt", mime: "text/plain", data: Buffer.from("hi") }]);
    const m = emailToInbound(f!);
    expect(m.text).toBe("Quote\n\nNeed a quote");
    expect(m.externalId).toBe("m1@b.co");
    const g = emailToInbound(parseEmailJson({ from: "c@d.co", subject: "Out of office", text: "Away", headers: [{ name: "Auto-Submitted", value: "auto-replied" }] })!);
    expect(g.skipProcessing).toBe(true);
    expect(g.externalId).toMatch(/^sha:/);
    expect(parseEmailJson({ subject: "no sender" })).toBeNull();
    expect(normalizeSubject("RE: re: Fwd:  Hello   there")).toBe("Hello there");
    expect(stripQuotedReply("Yes\nSent from my iPhone")).toBe("Yes");
  });
});

describe("Slack adapter", () => {
  it("parses messages and url_verification; ignores bots and edits", () => {
    expect(parseSlackPayload({ type: "url_verification", challenge: "chal-1", token: "x" })).toEqual({ type: "url_verification", challenge: "chal-1" });
    const p = parseSlackPayload({ type: "event_callback", team_id: "T123", event_id: "Ev1", event: { type: "message", channel: "C99", user: "U1", text: "Invoice <https://x.test/i/1|#1> paid &amp; closed", ts: "1763452800.000100", channel_type: "channel" } });
    expect(p.type).toBe("message");
    if (p.type !== "message") return;
    expect(p.teamId).toBe("T123");
    expect(p.message).toMatchObject({ externalId: "C99:1763452800.000100", text: "Invoice #1 (https://x.test/i/1) paid & closed", conversation: { externalId: "C99", isGroup: true }, sender: { externalId: "U1" } });
    expect(parseSlackPayload({ type: "event_callback", event: { type: "message", bot_id: "B1", channel: "C1", user: "U1", text: "hi", ts: "1.1" } }).type).toBe("ignore");
    expect(parseSlackPayload({ type: "event_callback", event: { type: "message", subtype: "message_changed", channel: "C1", ts: "1.1" } }).type).toBe("ignore");
    expect(slackToPlain("hi <@U123> in <#C1|general>")).toBe("hi @U123 in #general");
  });

  it("verifies v0 signatures with replay protection", () => {
    const body = '{"type":"url_verification","challenge":"c"}';
    const now = Math.floor(Date.now() / 1000);
    const sig = `v0=${hmacHex("sha256", "signing", `v0:${now}:${body}`)}`;
    expect(verifySlackSignature(body, String(now), sig, "signing")).toBe(true);
    expect(verifySlackSignature(body, String(now), sig, "other")).toBe(false);
    expect(verifySlackSignature(body + "x", String(now), sig, "signing")).toBe(false);
    const old = now - 600;
    const oldSig = `v0=${hmacHex("sha256", "signing", `v0:${old}:${body}`)}`;
    expect(verifySlackSignature(body, String(old), oldSig, "signing")).toBe(false);
  });
});

describe("Twilio adapter", () => {
  it("parses SMS / WhatsApp-via-Twilio forms and verifies signatures", () => {
    const params = { MessageSid: "SM1", From: "whatsapp:+14155550123", To: "whatsapp:+14155559999", Body: "Is the blue one in stock?", NumMedia: "1", MediaUrl0: "https://api.twilio.com/m/1", MediaContentType0: "image/png", ProfileName: "Joe" };
    const m = parseTwilioForm(params);
    expect(m).toMatchObject({ externalId: "SM1", conversation: { externalId: "whatsapp:+14155550123" }, sender: { phone: "+14155550123", name: "Joe" }, attachments: [{ mime: "image/png", url: "https://api.twilio.com/m/1" }] });
    expect(parseTwilioForm({ From: "+1" })).toBeNull();
    const url = "https://app.test/api/webhooks/sms/tok";
    const entries = Object.entries(params);
    const sig = twilioSignature(url, entries, "auth-token");
    // Reference computation: url + sorted key/value pairs, HMAC-SHA1, base64.
    const manual = hmacBase64("sha1", "auth-token", url + [...entries].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => k + v).join(""));
    expect(sig).toBe(manual);
    expect(verifyTwilioSignature(["https://other/", url], entries, sig, "auth-token")).toBe(true);
    expect(verifyTwilioSignature([url], entries, sig, "wrong")).toBe(false);
    expect(verifyTwilioSignature([url], [...entries, ["Extra", "1"]], sig, "auth-token")).toBe(false);
  });
});

/* ================================ Ingest ================================ */

describe("ingestInboundMessage", () => {
  it("stores contact, conversation, message, event, job and domain event — and dedupes", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const ch = await ensureApiChannel(db, ws.workspaceId);
    const input = {
      workspaceId: ws.workspaceId,
      channelId: ch.id,
      externalId: "m-1",
      conversation: { externalId: "c-1", title: "Rahul" },
      sender: { externalId: "u-1", name: "Rahul", phone: "+91 98470 11234" },
      text: "Send 2 kg rice\u0000 please",
      sentAt: new Date("2026-11-18T10:00:00Z"),
    };
    const r = await ingestInboundMessage(db, input);
    expect(r.duplicate).toBe(false);
    const [msg] = opened(await db.select().from(messages).where(eq(messages.id, r.messageId)));
    expect(msg).toMatchObject({ text: "Send 2 kg rice please", status: "queued", eventId: r.eventId, direction: "inbound", senderName: "Rahul" });
    const [ev] = await db.select().from(events).where(eq(events.id, r.eventId!));
    expect(ev).toMatchObject({ status: "queued", source: "api", messageId: r.messageId });
    const [ct] = await db.select().from(contacts).where(eq(contacts.id, msg.contactId!));
    expect(ct).toMatchObject({ phone: "+919847011234", displayName: "Rahul", handles: { api: "u-1" } });
    const [cv] = opened(await db.select().from(conversations).where(eq(conversations.id, r.conversationId)));
    expect(cv).toMatchObject({ unreadCount: 1, contactId: ct.id, lastMessagePreview: "Send 2 kg rice please" });
    const pm = await db.select().from(jobs).where(eq(jobs.dedupeKey, `pm:${r.eventId}`));
    expect(pm).toHaveLength(1);
    expect(pm[0].payload).toEqual({ eventId: r.eventId });
    const domain = (await db.select().from(jobs).where(eq(jobs.type, "domain_event"))).map((j) => j.payload as { type: string; data: { messageId?: string } });
    expect(domain.some((d) => d.type === "message.received" && d.data.messageId === r.messageId)).toBe(true);

    const again = await ingestInboundMessage(db, input);
    expect(again).toMatchObject({ duplicate: true, messageId: r.messageId, eventId: r.eventId, conversationId: r.conversationId });
    expect(opened(await db.select().from(messages).where(eq(messages.conversationId, r.conversationId)))).toHaveLength(1);
    const [cv2] = opened(await db.select().from(conversations).where(eq(conversations.id, r.conversationId)));
    expect(cv2.unreadCount).toBe(1);
  });

  it("merges contacts across channels by phone, clamps future timestamps, stores attachment bytes, honours skipProcessing", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const api = await ensureApiChannel(db, ws.workspaceId);
    const [tg] = await db.insert(channels).values({ id: "chn_tgtest0000000000000", workspaceId: ws.workspaceId, type: "telegram", name: "TG", webhookToken: "tok_merge_test_000000000001" }).returning();
    const a = await ingestInboundMessage(db, { workspaceId: ws.workspaceId, channelId: api.id, externalId: "a1", conversation: { externalId: "x" }, sender: { externalId: "crm-9", phone: "9847011299", name: "Meena" }, text: "hello", sentAt: new Date() });
    const future = new Date(Date.now() + 3 * 3600_000);
    const b = await ingestInboundMessage(db, {
      workspaceId: ws.workspaceId,
      channelId: tg.id,
      externalId: "b1",
      conversation: { externalId: "777" },
      sender: { externalId: "777", phone: "+919847011299" },
      text: "",
      attachments: [{ name: "receipt.png", mime: "image/png", data: Buffer.from([1, 2, 3]) }],
      sentAt: future,
      skipProcessing: true,
    });
    expect(b.contactId).toBe(a.contactId);
    const [ct] = await db.select().from(contacts).where(eq(contacts.id, a.contactId!));
    expect(ct.handles).toEqual({ api: "crm-9", telegram: "777" });
    const [msg] = opened(await db.select().from(messages).where(eq(messages.id, b.messageId)));
    expect(msg.sentAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect((msg.raw as { _infera: { sentAtClamped: string } })._infera.sentAtClamped).toBe(future.toISOString());
    expect(msg.kind).toBe("image");
    expect(msg.status).toBe("received");
    expect(msg.attachments[0]).toMatchObject({ name: "receipt.png", size: 3 });
    const [file] = opened(await db.select().from(files).where(eq(files.id, msg.attachments[0].fileId!)));
    expect(file).toMatchObject({ workspaceId: ws.workspaceId, messageId: b.messageId, size: 3 });
    const [ev] = await db.select().from(events).where(eq(events.id, b.eventId!));
    expect(ev.status).toBe("skipped");
    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, `pm:${b.eventId}`))).toHaveLength(0);
  });

  it("refuses channels of another workspace (rule 6) and creates one handle-only contact per sender", async () => {
    const ws = await createTestWorkspace();
    const other = await createTestWorkspace();
    const db = await getDb();
    const ch = await ensureApiChannel(db, other.workspaceId);
    await expect(ingestInboundMessage(db, { workspaceId: ws.workspaceId, channelId: ch.id, externalId: "z", conversation: { externalId: "z" }, sender: {}, text: "x", sentAt: new Date() })).rejects.toBeInstanceOf(ChannelNotFoundError);

    const mine = await ensureApiChannel(db, ws.workspaceId);
    const results = await Promise.all(
      [1, 2, 3].map((i) => ingestInboundMessage(db, { workspaceId: ws.workspaceId, channelId: mine.id, externalId: `h${i}`, conversation: { externalId: "grp", isGroup: true, title: "Team" }, sender: { externalId: "slack-user-1", name: "Dev" }, text: `msg ${i}`, sentAt: new Date() })),
    );
    expect(new Set(results.map((r) => r.contactId)).size).toBe(1);
    const [cv] = opened(await db.select().from(conversations).where(eq(conversations.id, results[0].conversationId)));
    expect(cv).toMatchObject({ isGroup: true, contactId: null, title: "Team", unreadCount: 3 });
  });
});

/* =========================== Channel management ========================== */

describe("channels API", () => {
  it("creates channels with generated secrets returned once and never exposes secrets", async () => {
    const ws = await createTestWorkspace();
    const res = await call(createChannel, { url: "/api/v1/channels", cookie: ws.cookie, body: { type: "telegram", name: "Support bot", secrets: { botToken: BOT_TOKEN } } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ type: "telegram", name: "Support bot", status: "active", externalId: "123456789", secretsSet: ["botToken", "webhookSecret"] });
    const secret = res.json.generatedSecrets.webhookSecret as string;
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(res.json.webhookUrl).toMatch(/^http:\/\/localhost:3000\/api\/webhooks\/telegram\/[A-Za-z0-9_-]+$/);

    const list = await call(listChannels, { url: "/api/v1/channels", cookie: ws.cookie });
    const one = await call(getChannel, { url: `/api/v1/channels/${res.json.id}`, cookie: ws.cookie, params: { id: res.json.id } });
    for (const r of [list, one]) {
      const text = JSON.stringify(r.json);
      expect(text).not.toContain(BOT_TOKEN);
      expect(text).not.toContain(secret);
      expect(text).not.toContain("generatedSecrets");
    }
    expect(one.json.secretsSet).toEqual(["botToken", "webhookSecret"]);
    const [row] = await (await getDb()).select().from(channels).where(eq(channels.id, res.json.id));
    expect(row.secretsEnc).not.toContain(BOT_TOKEN);

    // Same bot in another workspace → 409; audit written without secrets.
    const other = await createTestWorkspace();
    expect((await call(createChannel, { url: "/api/v1/channels", cookie: other.cookie, body: { type: "telegram", name: "Dup", secrets: { botToken: BOT_TOKEN } } })).status).toBe(409);
    const audits = await (await getDb()).select().from(auditLog).where(and(eq(auditLog.targetId, res.json.id), eq(auditLog.action, "channel.create")));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain(BOT_TOKEN);

    // registerWebhook needs a public https URL (no network call is made for http).
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const reg = await call(createChannel, { url: "/api/v1/channels", cookie: ws.cookie, body: { type: "telegram", name: "Bot 2", secrets: { botToken: "987654321:BBHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ" }, registerWebhook: true } });
    expect(reg.status).toBe(201);
    expect(reg.json.webhookRegistration).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates per-type requirements", async () => {
    const ws = await createTestWorkspace();
    const post = (body: unknown) => call(createChannel, { url: "/api/v1/channels", cookie: ws.cookie, body });
    // WhatsApp: shared app not configured → needs an appSecret; per-channel mode generates a verify token.
    expect((await post({ type: "whatsapp_cloud", name: "WA", externalId: "1098765432", secrets: { accessToken: "EAAG-token" } })).status).toBe(422);
    expect((await post({ type: "whatsapp_cloud", name: "WA", externalId: "not-digits", secrets: { accessToken: "EAAG", appSecret: "s" } })).status).toBe(422);
    const wa = await post({ type: "whatsapp_cloud", name: "WA", externalId: "1098765432", secrets: { accessToken: "EAAG-token", appSecret: "app-secret" } });
    expect(wa.status).toBe(201);
    expect(Object.keys(wa.json.generatedSecrets)).toEqual(["verifyToken"]);
    expect(wa.json.webhookUrl).toContain("/api/webhooks/whatsapp/");
    vi.stubEnv("WHATSAPP_APP_SECRET", "shared-secret");
    const shared = await post({ type: "whatsapp_cloud", name: "WA shared", externalId: "1098765433", secrets: { accessToken: "EAAG-token" } });
    expect(shared.status).toBe(201);
    expect(shared.json.webhookUrl).toBe("http://localhost:3000/api/webhooks/whatsapp");
    // Telegram bad token, Slack without signing secret, unknown secret names, secrets in config.
    expect((await post({ type: "telegram", name: "T", secrets: { botToken: "bad" } })).status).toBe(422);
    expect((await post({ type: "slack", name: "S", secrets: { botToken: "xoxb-1" } })).status).toBe(422);
    expect((await post({ type: "email", name: "E", secrets: { password: "x" } })).status).toBe(422);
    expect((await post({ type: "sms_twilio", name: "SMS", secrets: { authToken: "t" }, config: { apiKey: "leak" } })).status).toBe(422);
    const email = await post({ type: "email", name: "Inbox", externalId: "orders@shop.test" });
    expect(email.status).toBe(201);
    expect(email.json.inboundUrl).toBe(`${email.json.webhookUrl}?key=${encodeURIComponent(email.json.generatedSecrets.inboundSecret)}`);
    expect(email.json).toMatchObject({ externalId: null, config: { externalRef: "orders@shop.test" } });
  });

  it("enforces roles, scopes and tenancy; PATCH rotates and pauses; DELETE audits", async () => {
    const ws = await createTestWorkspace();
    const member = await addMember(ws.workspaceId, "member");
    const viewer = await addMember(ws.workspaceId, "viewer");
    const other = await createTestWorkspace();
    const body = { type: "slack", name: "Slack", secrets: { signingSecret: "sign-1", botToken: "xoxb-abc" }, config: { teamId: "T0001" } };
    expect((await call(createChannel, { url: "/api/v1/channels", cookie: member.cookie, body })).status).toBe(403);
    expect((await call(createChannel, { url: "/api/v1/channels", apiKey: ws.apiKey, body })).status).toBe(403);
    const created = await call(createChannel, { url: "/api/v1/channels", cookie: ws.cookie, body });
    expect(created.status).toBe(201);
    const id = created.json.id as string;
    expect((await call(getChannel, { url: `/x`, cookie: viewer.cookie, params: { id } })).status).toBe(200);
    expect((await call(getChannel, { url: `/x`, apiKey: ws.apiKey, params: { id } })).status).toBe(200);
    expect((await call(getChannel, { url: `/x`, cookie: other.cookie, params: { id } })).status).toBe(404);
    expect((await call(patchChannel, { url: `/x`, method: "PATCH", cookie: other.cookie, params: { id }, body: { name: "hijack" } })).status).toBe(404);
    expect((await call(deleteChannel, { url: `/x`, method: "DELETE", cookie: other.cookie, params: { id } })).status).toBe(404);
    expect((await call(patchChannel, { url: `/x`, method: "PATCH", cookie: member.cookie, params: { id }, body: { name: "x" } })).status).toBe(403);

    const oldUrl = created.json.webhookUrl;
    const patched = await call(patchChannel, { url: `/x`, method: "PATCH", cookie: ws.cookie, params: { id }, body: { status: "paused", secrets: { botToken: null, signingSecret: "sign-2" }, rotateWebhookToken: true } });
    expect(patched.status).toBe(200);
    expect(patched.json).toMatchObject({ status: "paused", secretsSet: ["signingSecret"] });
    expect(patched.json.webhookUrl).not.toBe(oldUrl);
    expect(JSON.stringify(patched.json)).not.toContain("sign-2");
    // Removing a required secret is rejected.
    expect((await call(patchChannel, { url: `/x`, method: "PATCH", cookie: ws.cookie, params: { id }, body: { secrets: { signingSecret: null } } })).status).toBe(422);

    expect((await call(deleteChannel, { url: `/x`, method: "DELETE", cookie: ws.cookie, params: { id } })).status).toBe(204);
    expect((await call(getChannel, { url: `/x`, cookie: ws.cookie, params: { id } })).status).toBe(404);
    const actions = (await (await getDb()).select().from(auditLog).where(eq(auditLog.targetId, id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["channel.create", "channel.update", "channel.delete"]));
  });

  it("sends a test message through the channel", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const ch = await ensureApiChannel(db, ws.workspaceId);
    const res = await call(testChannel, { url: "/x", cookie: ws.cookie, params: { id: ch.id }, body: { text: "Order 3 shirts, size M", senderName: "Tester" } });
    expect(res.status).toBe(202);
    const [msg] = opened(await db.select().from(messages).where(eq(messages.id, res.json.messageId)));
    expect(msg).toMatchObject({ text: "Order 3 shirts, size M", senderName: "Tester", eventId: res.json.eventId, conversationId: res.json.conversationId });
    const other = await createTestWorkspace();
    expect((await call(testChannel, { url: "/x", cookie: other.cookie, params: { id: ch.id }, body: { text: "x" } })).status).toBe(404);
  });
});

/* ============================== Events API ============================== */

describe("events API", () => {
  const event = (id: string, extra: Record<string, unknown> = {}) => ({
    conversation: { id: "crm-conv-1", name: "Rahul" },
    sender: { id: "crm-user-1", name: "Rahul", phone: "+919847055555" },
    message: { id, text: "I'd like to order 5 units", sent_at: "2026-11-18T10:00:00Z" },
    ...extra,
  });

  it("ingests with an ingest-scoped API key, dedupes, and enforces scopes and tenancy", async () => {
    const ws = await createTestWorkspace();
    const res = await call(postEvent, { url: "/api/v1/events", apiKey: ws.apiKey, body: event("ev-1") });
    expect(res.status).toBe(202);
    expect(res.json).toMatchObject({ status: "queued" });
    expect(res.json.event_id).toMatch(/^evt_/);
    const db = await getDb();
    const [msg] = opened(await db.select().from(messages).where(eq(messages.id, res.json.message_id)));
    expect(msg).toMatchObject({ text: "I'd like to order 5 units", workspaceId: ws.workspaceId });
    expect(msg.sentAt.toISOString()).toBe("2026-11-18T10:00:00.000Z");
    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, `pm:${res.json.event_id}`))).toHaveLength(1);
    const [ch] = await db.select().from(channels).where(eq(channels.id, msg.channelId));
    expect(ch).toMatchObject({ type: "api", name: "API" });

    const dup = await call(postEvent, { url: "/api/v1/events", apiKey: ws.apiKey, body: event("ev-1") });
    expect(dup.status).toBe(200);
    expect(dup.json).toMatchObject({ status: "duplicate", event_id: res.json.event_id, message_id: res.json.message_id });

    const readOnly = await createTestWorkspace({ scopes: ["read"] });
    expect((await call(postEvent, { url: "/api/v1/events", apiKey: readOnly.apiKey, body: event("ev-2") })).status).toBe(403);
    const viewer = await addMember(ws.workspaceId, "viewer");
    expect((await call(postEvent, { url: "/api/v1/events", cookie: viewer.cookie, body: event("ev-3") })).status).toBe(403);
    const member = await addMember(ws.workspaceId, "member");
    expect((await call(postEvent, { url: "/api/v1/events", cookie: member.cookie, body: event("ev-4") })).status).toBe(202);

    // Cross-tenant channel id → 404; non-API channel → 422.
    const other = await createTestWorkspace();
    const otherCh = await ensureApiChannel(db, other.workspaceId);
    expect((await call(postEvent, { url: "/api/v1/events", apiKey: ws.apiKey, body: event("ev-5", { channel_id: otherCh.id }) })).status).toBe(404);
    const [tg] = await db.insert(channels).values({ id: "chn_evtg00000000000000", workspaceId: ws.workspaceId, type: "telegram", name: "TG", webhookToken: "tok_events_test_0000000001" }).returning();
    expect((await call(postEvent, { url: "/api/v1/events", apiKey: ws.apiKey, body: event("ev-6", { channel_id: tg.id }) })).status).toBe(422);

    // Validation and camelCase aliases.
    expect((await call(postEvent, { url: "/api/v1/events", apiKey: ws.apiKey, body: { conversation: { id: "c" }, message: { id: "m", text: "" } } })).status).toBe(422);
    expect((await call(postEvent, { url: "/api/v1/events", apiKey: ws.apiKey, body: event("ev-7", { message: { id: "ev-7", text: "x", sent_at: "not a date" } }) })).status).toBe(422);
    const camel = await call(postEvent, { url: "/api/v1/events", apiKey: ws.apiKey, body: { channelId: msg.channelId, conversation: { id: "g1", isGroup: true }, sender: { id: "s1", isMe: true }, message: { id: "ev-8", text: "Payment received, thanks!", sentAt: 1763452800 } } });
    expect(camel.status).toBe(202);
    const [out] = opened(await db.select().from(messages).where(eq(messages.id, camel.json.message_id)));
    expect(out).toMatchObject({ direction: "outbound" });
    expect(out.sentAt.toISOString()).toBe(new Date(1763452800 * 1000).toISOString());
  });

  it("?sync=1 returns the processing result", async () => {
    const ws = await createTestWorkspace();
    processEventMock.mockImplementation(async (eventId: string) => ({ event_id: eventId, status: "processed", source: "api" }) as unknown as ProcessingResult);
    const res = await call(postEvent, { url: "/api/v1/events?sync=1", apiKey: ws.apiKey, body: event("sync-1") });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "processed", result: { event_id: res.json.event_id, status: "processed" } });
    expect(processEventMock).toHaveBeenCalledWith(res.json.event_id);
    // The durable job is still there as a fallback, delayed.
    const [job] = await (await getDb()).select().from(jobs).where(eq(jobs.dedupeKey, `pm:${res.json.event_id}`));
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 60_000);

    processEventMock.mockRejectedValueOnce(new Error("boom"));
    const failed = await call(postEvent, { url: "/api/v1/events?sync=1", apiKey: ws.apiKey, body: event("sync-2") });
    expect(failed.status).toBe(202);
    expect(failed.json).toMatchObject({ status: "queued", result: null });
  });

  it("lists events with filters and keyset pagination", async () => {
    const ws = await createTestWorkspace();
    for (let i = 0; i < 5; i++) await call(postEvent, { url: "/api/v1/events", apiKey: ws.apiKey, body: event(`list-${i}`) });
    const other = await createTestWorkspace();
    await call(postEvent, { url: "/api/v1/events", apiKey: other.apiKey, body: event("other-1") });

    const p1 = await call(listEvents, { url: "/api/v1/events?limit=2", cookie: ws.cookie });
    expect(p1.status).toBe(200);
    expect(p1.json.items).toHaveLength(2);
    expect(p1.json.nextCursor).toBeTruthy();
    const p2 = await call(listEvents, { url: `/api/v1/events?limit=2&cursor=${p1.json.nextCursor}`, cookie: ws.cookie });
    const p3 = await call(listEvents, { url: `/api/v1/events?limit=2&cursor=${p2.json.nextCursor}`, cookie: ws.cookie });
    const ids = [...p1.json.items, ...p2.json.items, ...p3.json.items].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(5);
    expect(p3.json.nextCursor).toBeNull();
    expect(p1.json.items[0]).toMatchObject({ source: "api", status: "queued", attempts: 0, result: null });

    expect((await call(listEvents, { url: "/api/v1/events?status=processed", apiKey: ws.apiKey })).json.items).toHaveLength(0);
    expect((await call(listEvents, { url: "/api/v1/events?status=queued&source=api", apiKey: ws.apiKey })).json.items).toHaveLength(5);
    expect((await call(listEvents, { url: "/api/v1/events?status=bogus", apiKey: ws.apiKey })).status).toBe(422);
    expect((await call(listEvents, { url: "/api/v1/events?since=2999-01-01T00:00:00Z", apiKey: ws.apiKey })).json.items).toHaveLength(0);
    const ingestOnly = await createTestWorkspace({ scopes: ["ingest"] });
    expect((await call(listEvents, { url: "/api/v1/events", apiKey: ingestOnly.apiKey })).status).toBe(403);
  });
});

/* =========================== WhatsApp import =========================== */

describe("WhatsApp export import", () => {
  const CHAT = [
    "12/11/2026, 10:14 - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.",
    "12/11/2026, 10:15 - Rahul: Hi",
    "12/11/2026, 10:16 - Rahul: I want 2 kg rice, how much?",
    "12/11/2026, 10:17 - Priya Store: ₹120 per kg",
    "12/11/2026, 10:18 - Rahul: ok",
    "12/11/2026, 10:18 - Rahul: ok",
  ].join("\n");

  const upload = async (cookie: string, fields: Record<string, string | File>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const req = new Request(`${BASE}/api/v1/imports/whatsapp`, { method: "POST", body: fd, headers: { cookie, origin: BASE, host: "localhost:3000" } });
    const res = await importWhatsApp(req, { params: Promise.resolve({}) });
    return { status: res.status, json: await res.json() };
  };

  it("imports a .txt export idempotently, in the workspace timezone, with 'me' as outbound", async () => {
    const ws = await createTestWorkspace();
    const file = () => new File([CHAT], "WhatsApp Chat with Rahul.txt", { type: "text/plain" });
    const first = await upload(ws.cookie, { file: file(), me: "Priya Store" });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ imported: 5, duplicates: 0, queued: 5, chatName: "Rahul" });
    const db = await getDb();
    const rows = opened(await db.select().from(messages).where(eq(messages.conversationId, first.json.conversationId)));
    expect(rows).toHaveLength(5);
    const reply = rows.find((m) => m.senderName === "Priya Store")!;
    expect(reply.direction).toBe("outbound");
    const hi = rows.find((m) => m.text === "Hi")!;
    expect(hi.sentAt.toISOString()).toBe("2026-11-12T04:45:00.000Z"); // 10:15 Asia/Kolkata
    const [conv] = opened(await db.select().from(conversations).where(eq(conversations.id, first.json.conversationId)));
    expect(conv).toMatchObject({ title: "Rahul", unreadCount: 0, lastMessagePreview: "ok" });
    const [ev] = await db.select().from(events).where(eq(events.id, hi.eventId!));
    expect(ev.source).toBe("whatsapp");
    const [job] = await db.select().from(jobs).where(eq(jobs.dedupeKey, `pm:${hi.eventId}`));
    expect(job.priority).toBe(200);
    // Historical import: no message.received domain events.
    const received = (await db.select().from(jobs).where(eq(jobs.type, "domain_event"))).filter((j) => (j.payload as { data: { messageId?: string } }).data.messageId === hi.id);
    expect(received).toHaveLength(0);

    const again = await upload(ws.cookie, { file: file(), me: "Priya Store", process: "false" });
    expect(again.json).toMatchObject({ imported: 0, duplicates: 5, conversationId: first.json.conversationId });
    expect(opened(await db.select().from(messages).where(eq(messages.conversationId, first.json.conversationId)))).toHaveLength(5);
  });

  it("imports .zip exports with referenced media and rejects bad uploads", async () => {
    const ws = await createTestWorkspace();
    const chat = "12/11/2026, 11:00 - Rahul: IMG-20261112-WA0001.jpg (file attached)\nphoto of the shop\n12/11/2026, 11:05 - Rahul: <Media omitted>";
    const zip = zipSync({ "WhatsApp Chat with Rahul.txt": strToU8(chat), "IMG-20261112-WA0001.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "unrelated.bin": new Uint8Array(1000) });
    const res = await upload(ws.cookie, { file: new File([zip], "WhatsApp Chat with Rahul.zip", { type: "application/zip" }), process: "false" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ imported: 2, queued: 0, skipped: 2, attachmentsStored: 1 });
    const db = await getDb();
    const rows = opened(await db.select().from(messages).where(eq(messages.conversationId, res.json.conversationId)));
    const img = rows.find((m) => m.attachments.length)!;
    expect(img).toMatchObject({ kind: "image", text: "photo of the shop", status: "received" });
    const [file] = opened(await db.select().from(files).where(eq(files.id, img.attachments[0].fileId!)));
    expect(file.size).toBe(4);
    expect(opened(await db.select().from(files).where(eq(files.workspaceId, ws.workspaceId)))).toHaveLength(1);

    expect((await upload(ws.cookie, { file: new File(["hello there"], "notes.txt", { type: "text/plain" }) })).status).toBe(422);
    expect((await upload(ws.cookie, { me: "x" })).status).toBe(422);
    expect((await upload(ws.cookie, { file: new File([CHAT], "c.txt"), timezone: "Mars/Olympus" })).status).toBe(422);
    const notMultipart = await call(importWhatsApp, { url: "/api/v1/imports/whatsapp", cookie: ws.cookie, body: { file: "x" } });
    expect(notMultipart.status).toBe(415);
    const viewer = await addMember(ws.workspaceId, "viewer");
    expect((await upload(viewer.cookie, { file: new File([CHAT], "c.txt") })).status).toBe(403);
  });

  it("converts wall-clock times across DST correctly", () => {
    expect(zonedTimeToUtc(2026, 7, 1, 12, 0, 0, "Europe/London").toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(zonedTimeToUtc(2026, 1, 1, 12, 0, 0, "Europe/London").toISOString()).toBe("2026-01-01T12:00:00.000Z");
    expect(zonedTimeToUtc(2026, 11, 12, 10, 15, 0, "Asia/Kolkata").toISOString()).toBe("2026-11-12T04:45:00.000Z");
  });
});

/* ============================ Outbound replies =========================== */

describe("replies and media", () => {
  async function telegramConversation() {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const created = await call(createChannel, { url: "/api/v1/channels", cookie: ws.cookie, body: { type: "telegram", name: "Bot", secrets: { botToken: `${100000000 + Math.floor(Math.random() * 899999999)}:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ` } } });
    expect(created.status).toBe(201);
    const r = await ingestInboundMessage(db, { workspaceId: ws.workspaceId, channelId: created.json.id, externalId: "555:1", conversation: { externalId: "555", title: "Anita" }, sender: { externalId: "555", name: "Anita" }, text: "Is it available?", sentAt: new Date() });
    return { ws, db, channelId: created.json.id as string, conversationId: r.conversationId, messageId: r.messageId };
  }

  it("replies on API conversations are unsupported (422)", async () => {
    const ws = await createTestWorkspace();
    const ev = await call(postEvent, { url: "/api/v1/events", apiKey: ws.apiKey, body: { conversation: { id: "c1" }, message: { id: "m1", text: "hello" } } });
    const res = await call(reply, { url: "/x", cookie: ws.cookie, params: { id: ev.json.conversation_id }, body: { text: "Hi!" } });
    expect(res.status).toBe(422);
    expect(res.json.error.message).toBe("Replies are not supported on this channel");
    const other = await createTestWorkspace();
    expect((await call(reply, { url: "/x", cookie: other.cookie, params: { id: ev.json.conversation_id }, body: { text: "Hi!" } })).status).toBe(404);
  });

  it("sends Telegram replies, stores and audits them", async () => {
    const { ws, db, conversationId } = await telegramConversation();
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ ok: true, result: { message_id: 99, chat: { id: 555 } } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await call(reply, { url: "/x", cookie: ws.cookie, params: { id: conversationId }, body: { text: "Yes, in stock!" } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ delivered: true, message: { direction: "outbound", text: "Yes, in stock!", externalId: "555:99", status: "processed" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/api\.telegram\.org\/bot\d+:[^/]+\/sendMessage$/);
    expect(JSON.parse(String(init?.body))).toEqual({ chat_id: "555", text: "Yes, in stock!", disable_web_page_preview: true });
    const [conv] = opened(await db.select().from(conversations).where(eq(conversations.id, conversationId)));
    expect(conv).toMatchObject({ unreadCount: 0, lastMessagePreview: "Yes, in stock!" });
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.workspaceId, ws.workspaceId), eq(auditLog.action, "message.send")));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain("Yes, in stock!");
    // Outbound messages are not queued for processing.
    expect(await db.select().from(events).where(eq(events.messageId, res.json.messageId))).toHaveLength(0);

    // Provider rejection → 502; network failure → 503.
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, 403)));
    const rejected = await call(reply, { url: "/x", cookie: ws.cookie, params: { id: conversationId }, body: { text: "Hello?" } });
    expect(rejected.status).toBe(502);
    expect(rejected.json.error.message).toContain("bot was blocked");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect((await call(reply, { url: "/x", cookie: ws.cookie, params: { id: conversationId }, body: { text: "Hello?" } })).status).toBe(503);
  });

  it("send_reply job retries transient failures and stops on permanent ones", async () => {
    const { ws, conversationId } = await telegramConversation();
    const actor = { type: "automation", id: "aut_1", label: "Auto" };
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, description: "Too Many Requests" }, 429)));
    const transient = await handleSendReply({ workspaceId: ws.workspaceId, conversationId, text: "hi", actor }).catch((e: unknown) => e);
    expect(transient).toBeInstanceOf(Error);
    expect(transient).not.toBeInstanceOf(PermanentJobError);
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, description: "Bad Request: chat not found" }, 400)));
    await expect(handleSendReply({ workspaceId: ws.workspaceId, conversationId, text: "hi", actor })).rejects.toBeInstanceOf(PermanentJobError);
    await expect(handleSendReply({ workspaceId: ws.workspaceId, conversationId: "cnv_missing", text: "hi", actor })).rejects.toBeInstanceOf(PermanentJobError);
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true, result: { message_id: 5 } })));
    await expect(handleSendReply({ workspaceId: ws.workspaceId, conversationId, text: "hi", actor })).resolves.toBeUndefined();
  });

  it("downloads WhatsApp media lazily into files", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const created = await call(createChannel, { url: "/api/v1/channels", cookie: ws.cookie, body: { type: "whatsapp_cloud", name: "WA", externalId: "5550001", secrets: { accessToken: "EAAG-media", appSecret: "s" } } });
    const [channel] = await db.select().from(channels).where(eq(channels.id, created.json.id));
    const r = await ingestInboundMessage(db, { workspaceId: ws.workspaceId, channelId: channel.id, externalId: "wamid.M1", conversation: { externalId: "919800000001" }, sender: { externalId: "919800000001", phone: "+919800000001" }, text: "", attachments: [{ name: "image-MID.jpg", mime: "image/jpeg", providerId: "MID" }], sentAt: new Date() });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === "https://graph.facebook.com/v21.0/MID") return json({ url: "https://lookaside.fbsbx.com/whatsapp/media?mid=1", mime_type: "image/jpeg", file_size: 3 });
      if (u.startsWith("https://lookaside.fbsbx.com/")) return new Response(new Uint8Array([7, 8, 9]), { status: 200 });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchProviderMedia(db, channel, { workspaceId: ws.workspaceId, messageId: r.messageId, items: [{ index: 0, providerId: "MID" }] });
    expect(out).toEqual({ stored: 1, failed: 0 });
    const [msg] = opened(await db.select().from(messages).where(eq(messages.id, r.messageId)));
    expect(msg.attachments[0].fileId).toMatch(/^fil_/);
    const [file] = opened(await db.select().from(files).where(eq(files.id, msg.attachments[0].fileId!)));
    expect([...file.data]).toEqual([7, 8, 9]);
    // Authorization header carries the channel token; second run is a no-op.
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ headers: { Authorization: "Bearer EAAG-media" } });
    expect(await fetchProviderMedia(db, channel, { workspaceId: ws.workspaceId, messageId: r.messageId, items: [{ index: 0, providerId: "MID" }] })).toEqual({ stored: 0, failed: 0 });
    expect(opened(await db.select().from(files).where(eq(files.messageId, r.messageId)))).toHaveLength(1);
  });

  it("downloads Twilio MMS media with Basic auth only from Twilio hosts", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const sid = "AC" + "0123456789abcdef".repeat(2); // fake SID, built so secret scanners don't flag it
    const created = await call(createChannel, { url: "/api/v1/channels", cookie: ws.cookie, body: { type: "sms_twilio", name: "SMS", secrets: { authToken: "tw-token", accountSid: sid } } });
    const [channel] = await db.select().from(channels).where(eq(channels.id, created.json.id));
    const good = "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1";
    const evil = "https://attacker.example/steal";
    const r = await ingestInboundMessage(db, {
      workspaceId: ws.workspaceId,
      channelId: channel.id,
      externalId: "MM1",
      conversation: { externalId: "+14155550100" },
      sender: { externalId: "+14155550100", phone: "+14155550100" },
      text: "",
      attachments: [
        { name: "media-1.jpg", mime: "image/jpeg", url: good, providerId: good },
        { name: "media-2.jpg", mime: "image/jpeg", url: evil, providerId: evil },
      ],
      sentAt: new Date(),
    });
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchProviderMedia(db, channel, { workspaceId: ws.workspaceId, messageId: r.messageId, items: [{ index: 0, providerId: good }, { index: 1, providerId: evil }] });
    expect(out).toEqual({ stored: 1, failed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(good);
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ headers: { Authorization: `Basic ${Buffer.from(`${sid}:tw-token`).toString("base64")}` } });
    const [msg] = opened(await db.select().from(messages).where(eq(messages.id, r.messageId)));
    expect(msg.attachments[0].fileId).toMatch(/^fil_/);
    expect(msg.attachments[1].fileId).toBeNull();
  });
});
