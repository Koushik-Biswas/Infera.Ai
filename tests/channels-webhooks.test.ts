/**
 * Provider webhooks end to end: channel created through the API → signed provider
 * payload → message + event + process_message job; replays are duplicates; bad
 * signatures 401; unknown tokens 404; paused channels acknowledge but ignore.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/server/db";
import { contacts, events, files, jobs, messages } from "@/lib/server/db/schema";
import { hmacHex } from "@/lib/server/crypto";
import { twilioSignature } from "@/lib/server/channels/adapters/twilio";
import { POST as createChannel } from "@/app/api/v1/channels/route";
import { GET as getChannel, PATCH as patchChannel } from "@/app/api/v1/channels/[id]/route";
import { POST as postEvent } from "@/app/api/v1/events/route";
import { GET as waSharedGet, POST as waSharedPost } from "@/app/api/webhooks/whatsapp/route";
import { GET as waGet, POST as waPost } from "@/app/api/webhooks/whatsapp/[token]/route";
import { POST as telegramPost } from "@/app/api/webhooks/telegram/[token]/route";
import { POST as emailPost } from "@/app/api/webhooks/email/[token]/route";
import { POST as slackPost } from "@/app/api/webhooks/slack/[token]/route";
import { POST as smsPost } from "@/app/api/webhooks/sms/[token]/route";
import { BASE, call, createTestWorkspace, type TestWorkspace, opened } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
});

const tokenOf = (webhookUrl: string) => webhookUrl.split("/").pop()!;

async function newChannel(ws: TestWorkspace, body: Record<string, unknown>) {
  const res = await call(createChannel, { url: "/api/v1/channels", cookie: ws.cookie, body });
  expect(res.status).toBe(201);
  return res.json as { id: string; webhookUrl: string; generatedSecrets: Record<string, string> };
}

async function messagesOf(channelId: string) {
  const db = await getDb();
  return opened(await db.select().from(messages).where(eq(messages.channelId, channelId)));
}

async function expectQueued(messageId: string) {
  const db = await getDb();
  const [msg] = opened(await db.select().from(messages).where(eq(messages.id, messageId)));
  const [ev] = await db.select().from(events).where(eq(events.id, msg.eventId!));
  expect(ev).toMatchObject({ status: "queued", messageId });
  expect(await db.select().from(jobs).where(and(eq(jobs.type, "process_message"), eq(jobs.dedupeKey, `pm:${ev.id}`)))).toHaveLength(1);
  return { msg, ev };
}

const waPayload = (phoneNumberId: string, id: string, text: string, from = "919811122233") => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550009999", phone_number_id: phoneNumberId },
            contacts: [{ profile: { name: "Kiran" }, wa_id: from }],
            messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
          },
        },
      ],
    },
  ],
});

describe("WhatsApp webhooks", () => {
  it("per-channel app: verification, signed ingest, dedupe, bad signature, unknown token", async () => {
    const ws = await createTestWorkspace();
    const ch = await newChannel(ws, { type: "whatsapp_cloud", name: "WA", externalId: "200300400", secrets: { accessToken: "EAAG-x", appSecret: "per-channel-secret" } });
    const token = tokenOf(ch.webhookUrl);
    const verifyToken = ch.generatedSecrets.verifyToken;

    const ok = await call(waGet, { url: `/api/webhooks/whatsapp/${token}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=987654`, params: { token } });
    expect(ok.status).toBe(200);
    expect(ok.json).toBe(987654);
    expect(ok.headers.get("content-type")).toContain("text/plain");
    expect((await call(waGet, { url: `/api/webhooks/whatsapp/${token}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`, params: { token } })).status).toBe(403);

    const body = JSON.stringify(waPayload("200300400", "wamid.HBg1", "Need 20 cartons, what's the price?"));
    const sig = `sha256=${hmacHex("sha256", "per-channel-secret", body)}`;
    const send = (raw: string, signature: string, t = token) => call(waPost, { url: `/api/webhooks/whatsapp/${t}`, params: { token: t }, rawBody: raw, headers: { "content-type": "application/json", "x-hub-signature-256": signature } });

    const first = await send(body, sig);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ ok: true, ingested: 1, duplicates: 0 });
    const rows = await messagesOf(ch.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "wamid.HBg1", text: "Need 20 cartons, what's the price?", senderName: "Kiran", direction: "inbound" });
    const { ev } = await expectQueued(rows[0].id);
    expect(ev.source).toBe("whatsapp");
    const db = await getDb();
    const [ct] = await db.select().from(contacts).where(eq(contacts.id, rows[0].contactId!));
    expect(ct).toMatchObject({ phone: "+919811122233", displayName: "Kiran", handles: { whatsapp_cloud: "919811122233" } });

    const replay = await send(body, sig);
    expect(replay.json).toMatchObject({ ingested: 0, duplicates: 1 });
    expect(await messagesOf(ch.id)).toHaveLength(1);

    expect((await send(body, `sha256=${hmacHex("sha256", "wrong", body)}`)).status).toBe(401);
    expect((await send(body, "")).status).toBe(401);
    expect((await send(body, sig, "unknownTokenAAAAAAAAAAAAAAA")).status).toBe(404);
    expect((await send(body, sig, "../../etc")).status).toBe(404);

    // Messages for another phone number on the same app are not mis-filed.
    const otherBody = JSON.stringify(waPayload("999999999", "wamid.OTHER", "hello"));
    const other = await send(otherBody, `sha256=${hmacHex("sha256", "per-channel-secret", otherBody)}`);
    expect(other.json).toMatchObject({ ingested: 0 });
    // Status-only payloads are acknowledged.
    const statusBody = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "200300400" }, statuses: [{ id: "wamid.HBg1", status: "read" }] } }] }] });
    expect((await send(statusBody, `sha256=${hmacHex("sha256", "per-channel-secret", statusBody)}`)).json).toMatchObject({ ok: true, ingested: 0 });
    // Oversized bodies are refused before parsing.
    const huge = "x".repeat(1024 * 1024 + 10);
    expect((await send(huge, `sha256=${hmacHex("sha256", "per-channel-secret", huge)}`)).status).toBe(413);
  });

  it("shared app: routes by phone_number_id with WHATSAPP_APP_SECRET", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "shared-app-secret");
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "shared-verify");
    const ws = await createTestWorkspace();
    const ch = await newChannel(ws, { type: "whatsapp_cloud", name: "WA shared", externalId: "700800900", secrets: { accessToken: "EAAG-y" } });
    expect(ch.webhookUrl).toBe("http://localhost:3000/api/webhooks/whatsapp");

    const v = await call(waSharedGet, { url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=shared-verify&hub.challenge=abc" });
    expect(v.status).toBe(200);
    expect(v.json).toBe("abc");

    const body = JSON.stringify(waPayload("700800900", "wamid.SHARED1", "Payment done ₹2,500"));
    const res = await call(waSharedPost, { url: "/api/webhooks/whatsapp", rawBody: body, headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${hmacHex("sha256", "shared-app-secret", body)}` } });
    expect(res.json).toMatchObject({ ok: true, ingested: 1 });
    const rows = await messagesOf(ch.id);
    expect(rows.map((m) => m.text)).toEqual(["Payment done ₹2,500"]);
    await expectQueued(rows[0].id);

    const unknown = JSON.stringify(waPayload("111", "wamid.X", "hi"));
    expect((await call(waSharedPost, { url: "/api/webhooks/whatsapp", rawBody: unknown, headers: { "x-hub-signature-256": `sha256=${hmacHex("sha256", "shared-app-secret", unknown)}` } })).json).toMatchObject({ ok: true, ingested: 0 });
    expect((await call(waSharedPost, { url: "/api/webhooks/whatsapp", rawBody: body, headers: { "x-hub-signature-256": "sha256=00" } })).status).toBe(401);
  });

  it("links the same customer across WhatsApp and the API by phone", async () => {
    const ws = await createTestWorkspace();
    const ch = await newChannel(ws, { type: "whatsapp_cloud", name: "WA", externalId: "123123123", secrets: { accessToken: "EAAG", appSecret: "s3" } });
    const token = tokenOf(ch.webhookUrl);
    const body = JSON.stringify(waPayload("123123123", "wamid.LINK", "hi", "919877766655"));
    await call(waPost, { url: `/x`, params: { token }, rawBody: body, headers: { "x-hub-signature-256": `sha256=${hmacHex("sha256", "s3", body)}` } });
    const api = await call(postEvent, { url: "/api/v1/events", apiKey: ws.apiKey, body: { conversation: { id: "crm-1" }, sender: { id: "crm-77", phone: "+91 98777 66655" }, message: { id: "x1", text: "order update" } } });
    const db = await getDb();
    const [a] = await messagesOf(ch.id);
    const [b] = opened(await db.select().from(messages).where(eq(messages.id, api.json.message_id)));
    expect(b.contactId).toBe(a.contactId);
  });
});

describe("Telegram webhook", () => {
  it("checks the secret token, ingests, dedupes and ignores paused channels", async () => {
    const ws = await createTestWorkspace();
    const ch = await newChannel(ws, { type: "telegram", name: "Bot", secrets: { botToken: "555666777:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ" } });
    const token = tokenOf(ch.webhookUrl);
    const secret = ch.generatedSecrets.webhookSecret;
    const update = (id: number, text: string) => JSON.stringify({ update_id: id, message: { message_id: id, from: { id: 31337, is_bot: false, first_name: "Sam" }, chat: { id: 31337, type: "private", first_name: "Sam" }, date: Math.floor(Date.now() / 1000), text } });
    const send = (raw: string, s: string | null, t = token) => call(telegramPost, { url: `/api/webhooks/telegram/${t}`, params: { token: t }, rawBody: raw, headers: { "content-type": "application/json", ...(s ? { "x-telegram-bot-api-secret-token": s } : {}) } });

    const r1 = await send(update(1, "Book a table for 4 tomorrow 8pm"), secret);
    expect(r1.status).toBe(200);
    expect(r1.json).toMatchObject({ ingested: 1 });
    const [m] = await messagesOf(ch.id);
    expect(m).toMatchObject({ externalId: "31337:1", senderName: "Sam" });
    await expectQueued(m.id);
    expect((await send(update(1, "Book a table for 4 tomorrow 8pm"), secret)).json).toMatchObject({ duplicates: 1 });
    expect((await send(update(2, "x"), "wrong-secret-value-123")).status).toBe(401);
    expect((await send(update(2, "x"), null)).status).toBe(401);
    expect((await send(update(2, "x"), secret, "AAAAAAAAAAAAAAAAAAAAAAAA")).status).toBe(404);
    expect((await send("{not json", secret)).status).toBe(400);

    await call(patchChannel, { url: "/x", method: "PATCH", cookie: ws.cookie, params: { id: ch.id }, body: { status: "paused" } });
    const paused = await send(update(3, "while paused"), secret);
    expect(paused.status).toBe(200);
    expect(paused.json).toMatchObject({ ok: true, ingested: 0 });
    expect(await messagesOf(ch.id)).toHaveLength(1);

    const view = await call(getChannel, { url: "/x", cookie: ws.cookie, params: { id: ch.id } });
    expect(JSON.stringify(view.json)).not.toContain(secret);
  });
});

describe("Email webhook", () => {
  it("accepts Postmark JSON with ?key= or X-Infera-Token, rejects wrong keys, and stores multipart attachments", async () => {
    const ws = await createTestWorkspace();
    const ch = await newChannel(ws, { type: "email", name: "Orders inbox" });
    const token = tokenOf(ch.webhookUrl);
    const key = ch.generatedSecrets.inboundSecret;
    const postmark = (id: string) => JSON.stringify({ From: "Asha <asha@client.test>", FromFull: { Email: "asha@client.test", Name: "Asha" }, To: "orders@shop.test", Subject: "PO 991", TextBody: "Please ship 12 units.\n> old quote", MessageID: id, Date: new Date().toUTCString() });

    const r1 = await call(emailPost, { url: `/api/webhooks/email/${token}?key=${encodeURIComponent(key)}`, params: { token }, rawBody: postmark("pm-1"), headers: { "content-type": "application/json" } });
    expect(r1.status).toBe(200);
    expect(r1.json).toMatchObject({ ingested: 1 });
    const r2 = await call(emailPost, { url: `/api/webhooks/email/${token}`, params: { token }, rawBody: postmark("pm-2"), headers: { "content-type": "application/json", "x-infera-token": key } });
    expect(r2.json).toMatchObject({ ingested: 1 });
    const rows = await messagesOf(ch.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toBe("PO 991\n\nPlease ship 12 units.");
    expect(new Set(rows.map((r) => r.conversationId)).size).toBe(1);
    await expectQueued(rows[0].id);

    expect((await call(emailPost, { url: `/api/webhooks/email/${token}?key=wrong`, params: { token }, rawBody: postmark("pm-3"), headers: { "content-type": "application/json" } })).status).toBe(401);
    expect((await call(emailPost, { url: `/api/webhooks/email/${token}`, params: { token }, rawBody: postmark("pm-3"), headers: { "content-type": "application/json" } })).status).toBe(401);

    // Mailgun-style multipart with an attachment.
    const fd = new FormData();
    fd.append("from", "Ravi <ravi@client.test>");
    fd.append("subject", "Invoice");
    fd.append("body-plain", "Invoice attached, amount ₹8,400");
    fd.append("Message-Id", "<mg-1@client.test>");
    fd.append("attachment-1", new File([new Uint8Array([37, 80, 68, 70])], "invoice.pdf", { type: "application/pdf" }));
    const req = new Request(`${BASE}/api/webhooks/email/${token}?key=${encodeURIComponent(key)}`, { method: "POST", body: fd });
    const res = await emailPost(req, { params: Promise.resolve({ token }) });
    expect(res.status).toBe(200);
    const db = await getDb();
    const [mg] = opened(await db.select().from(messages).where(and(eq(messages.channelId, ch.id), eq(messages.externalId, "mg-1@client.test"))));
    expect(mg).toMatchObject({ text: "Invoice\n\nInvoice attached, amount ₹8,400", kind: "document" });
    const [file] = opened(await db.select().from(files).where(eq(files.id, mg.attachments[0].fileId!)));
    expect(file).toMatchObject({ name: "invoice.pdf", mime: "application/pdf", size: 4 });
  });
});

describe("Slack webhook", () => {
  it("answers url_verification, ingests messages, rejects bad or stale signatures", async () => {
    const ws = await createTestWorkspace();
    const ch = await newChannel(ws, { type: "slack", name: "Slack", secrets: { signingSecret: "slack-signing-secret" }, config: { teamId: "T0TEAM" } });
    const token = tokenOf(ch.webhookUrl);
    const send = (raw: string, opts: { ts?: number; secret?: string } = {}) => {
      const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
      const sig = `v0=${hmacHex("sha256", opts.secret ?? "slack-signing-secret", `v0:${ts}:${raw}`)}`;
      return call(slackPost, { url: `/api/webhooks/slack/${token}`, params: { token }, rawBody: raw, headers: { "content-type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": sig } });
    };
    const challenge = await send(JSON.stringify({ type: "url_verification", challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P", token: "legacy" }));
    expect(challenge.json).toEqual({ challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P" });

    const event = (ts: string, extra: Record<string, unknown> = {}, team = "T0TEAM") => JSON.stringify({ type: "event_callback", team_id: team, event_id: `Ev${ts}`, event: { type: "message", channel: "C0SALES", user: "U0ASHA", text: "Client wants 3 licences, budget 90k", ts, channel_type: "channel", ...extra } });
    const r = await send(event("1763452800.000200"));
    expect(r.json).toMatchObject({ ok: true, ingested: 1 });
    const [m] = await messagesOf(ch.id);
    expect(m).toMatchObject({ externalId: "C0SALES:1763452800.000200", senderHandle: "U0ASHA" });
    await expectQueued(m.id);
    expect((await send(event("1763452800.000200"))).json).toMatchObject({ duplicates: 1 });
    expect((await send(event("1763452801.000000", { bot_id: "B1" }))).json).toMatchObject({ ignored: "bot_or_subtype" });
    expect((await send(event("1763452802.000000", {}, "T0OTHER"))).json).toMatchObject({ ignored: "other_team" });
    expect((await send(event("1763452803.000000"), { secret: "nope" })).status).toBe(401);
    expect((await send(event("1763452804.000000"), { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    expect(await messagesOf(ch.id)).toHaveLength(1);
  });
});

describe("Twilio SMS webhook", () => {
  it("verifies X-Twilio-Signature, ingests and answers with TwiML", async () => {
    const ws = await createTestWorkspace();
    const ch = await newChannel(ws, { type: "sms_twilio", name: "SMS", secrets: { authToken: "twilio-auth-token" }, config: { phoneNumber: "+14155559999" } });
    const token = tokenOf(ch.webhookUrl);
    const url = `http://localhost:3000/api/webhooks/sms/${token}`;
    const params: [string, string][] = [
      ["MessageSid", "SM0001"],
      ["AccountSid", "AC00000000000000000000000000000000"],
      ["From", "+14155550123"],
      ["To", "+14155559999"],
      ["Body", "Can I get a refund for order 77?"],
      ["NumMedia", "0"],
    ];
    const raw = new URLSearchParams(params).toString();
    const send = (sig: string) => call(smsPost, { url: `/api/webhooks/sms/${token}`, params: { token }, rawBody: raw, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig } });

    const ok = await send(twilioSignature(url, params, "twilio-auth-token"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/xml");
    expect(ok.json).toContain("<Response>");
    const [m] = await messagesOf(ch.id);
    expect(m).toMatchObject({ externalId: "SM0001", text: "Can I get a refund for order 77?", senderHandle: "+14155550123" });
    expect((m.raw as { to: string }).to).toBe("+14155559999");
    await expectQueued(m.id);
    expect((await send(twilioSignature(url, params, "wrong-token"))).status).toBe(401);
    expect((await send(twilioSignature(`${url}?x=1`, params, "twilio-auth-token"))).status).toBe(401);
  });
});
