import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/server/db";
import { messages } from "@/lib/server/db/schema";
import { hmacHex } from "@/lib/server/crypto";
import { isMetaCdnUrl, metaVerifyChallenge, parseMetaEvent, parseMetaPayload, verifyMetaSignature } from "@/lib/server/channels/adapters/meta";
import { importMetaHistory } from "@/lib/server/channels/meta-history";
import { getWorkspaceChannel } from "@/lib/server/channels/registry";
import { GET as metaGet, POST as metaPost } from "@/app/api/webhooks/meta/[token]/route";
import { POST as createChannel } from "@/app/api/v1/channels/route";
import { POST as reply } from "@/app/api/v1/conversations/[id]/reply/route";
import { GET as listConversations } from "@/app/api/v1/conversations/route";
import { call, createTestWorkspace, opened } from "./helpers";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("Meta adapter", () => {
  it("parses messages, echoes, postbacks and attachments; skips reads", () => {
    const payload = {
      object: "page",
      entry: [
        {
          id: "111222333",
          time: 1763452800000,
          messaging: [
            { sender: { id: "PSID1" }, recipient: { id: "111222333" }, timestamp: 1763452800000, message: { mid: "m_1", text: "Do you have this in blue?" } },
            { sender: { id: "111222333" }, recipient: { id: "PSID1" }, timestamp: 1763452860000, message: { mid: "m_2", text: "Yes, ₹1,200", is_echo: true, app_id: 42 } },
            { sender: { id: "PSID1" }, recipient: { id: "111222333" }, timestamp: 1763452900000, message: { mid: "m_3", attachments: [{ type: "image", payload: { url: "https://scontent.xx.fbcdn.net/v/t1/abc.jpg" } }, { type: "image", payload: { url: "https://evil.example/x.jpg" } }] } },
            { sender: { id: "PSID1" }, recipient: { id: "111222333" }, timestamp: 1763452950000, postback: { title: "Order now", payload: "ORDER" } },
            { sender: { id: "PSID1" }, recipient: { id: "111222333" }, timestamp: 1763452960000, read: { watermark: 1 } },
          ],
        },
      ],
    };
    const [b] = parseMetaPayload(payload, new Map([["PSID1", "Rahul S"]]));
    expect(b).toMatchObject({ accountId: "111222333", platform: "messenger", customerIds: ["PSID1"] });
    expect(b.messages).toHaveLength(4);
    expect(b.messages[0]).toMatchObject({ externalId: "m_1", direction: "inbound", conversation: { externalId: "PSID1", title: "Rahul S" }, sender: { externalId: "PSID1", name: "Rahul S" }, text: "Do you have this in blue?" });
    expect(b.messages[1]).toMatchObject({ externalId: "m_2", direction: "outbound", conversation: { externalId: "PSID1" }, sender: { isMe: true } });
    expect(b.messages[2].kind).toBe("image");
    expect(b.messages[2].attachments).toHaveLength(2);
    expect(b.messages[2].attachments![0].providerId).toMatch(/fbcdn\.net/);
    expect(b.messages[2].attachments![1].providerId).toBeNull(); // never fetch non-Meta hosts
    expect(b.messages[3]).toMatchObject({ text: "Order now", direction: "inbound" });
    expect(parseMetaPayload({ object: "instagram", entry: [{ id: "1784", messaging: [{ sender: { id: "IG1" }, recipient: { id: "1784" }, timestamp: 1, message: { mid: "ig_1", text: "hi" } }] }] })[0].platform).toBe("instagram");
    expect(parseMetaEvent({ sender: { id: "a" }, recipient: { id: "b" }, message: { mid: "x", is_deleted: true } }, "messenger")).toBeNull();
    expect(isMetaCdnUrl("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1")).toBe(true);
    expect(isMetaCdnUrl("http://scontent.fbcdn.net/x")).toBe(false);
  });

  it("verifies signatures and the subscription handshake", () => {
    const body = '{"object":"page"}';
    expect(verifyMetaSignature(body, `sha256=${hmacHex("sha256", "s3cret", body)}`, "s3cret")).toBe(true);
    expect(verifyMetaSignature(body, `sha256=${hmacHex("sha256", "wrong", body)}`, "s3cret")).toBe(false);
    const q = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "tok-1234567890abcdef", "hub.challenge": "42" });
    expect(metaVerifyChallenge(q, "tok-1234567890abcdef")).toBe("42");
    expect(metaVerifyChallenge(q, "other-token-xxxxxxxxx")).toBeNull();
  });
});

describe("Messenger channel end to end", () => {
  it("creates, verifies, ingests signed webhooks with names, replies, and imports history", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const created = await call(createChannel, {
      url: "/api/v1/channels",
      cookie: ws.cookie,
      body: { type: "messenger", name: "Shop Page", externalId: "111222333", secrets: { pageAccessToken: "EAAG-page-token", appSecret: "meta-app-secret" }, config: { historyDays: 30 } },
    });
    expect(created.status).toBe(201);
    const verifyToken = created.json.generatedSecrets.verifyToken;
    expect(verifyToken).toBeTruthy();
    const token = String(created.json.webhookUrl).split("/").pop()!;
    expect(created.json.webhookUrl).toContain("/api/webhooks/meta/");
    expect((await call(createChannel, { url: "/x", cookie: ws.cookie, body: { type: "messenger", name: "X", externalId: "111", secrets: {} } })).status).toBe(422);

    // GET handshake
    const ok = await call(metaGet, { url: `/api/webhooks/meta/${token}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=777`, params: { token } });
    expect(ok.json).toBe(777);
    expect((await call(metaGet, { url: `/api/webhooks/meta/${token}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`, params: { token } })).status).toBe(403);

    // Signed POST: name looked up from the Graph API
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/PSID9")) return json({ first_name: "Meena", last_name: "K", name: "Meena K" });
      if (u.endsWith("/me/messages")) return json({ recipient_id: "PSID9", message_id: "m_reply_1" });
      if (u.includes("/111222333/conversations"))
        return json({
          data: [
            {
              updated_time: new Date().toISOString(),
              participants: { data: [{ id: "PSID7", name: "Old Customer" }, { id: "111222333", name: "Shop" }] },
              messages: {
                data: [
                  { id: "h_2", created_time: new Date().toISOString(), from: { id: "111222333" }, message: "Sure, shipping tomorrow" },
                  { id: "h_1", created_time: new Date(Date.now() - 3600_000).toISOString(), from: { id: "PSID7", name: "Old Customer" }, message: "Can I order 2 lamps?" },
                  { id: "h_0", created_time: new Date(Date.now() - 90 * 86_400_000).toISOString(), from: { id: "PSID7" }, message: "too old" },
                ],
              },
            },
          ],
        });
      return json({ error: { message: "unexpected" } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify({ object: "page", entry: [{ id: "111222333", messaging: [{ sender: { id: "PSID9" }, recipient: { id: "111222333" }, timestamp: Date.now(), message: { mid: "m_in_1", text: "I want to order 3 cushions" } }] }] });
    const send = (raw: string, secret = "meta-app-secret") => call(metaPost, { url: `/api/webhooks/meta/${token}`, params: { token }, rawBody: raw, headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${hmacHex("sha256", secret, raw)}` } });
    expect((await send(body, "wrong")).status).toBe(401);
    const r = await send(body);
    expect(r.json).toMatchObject({ ok: true, ingested: 1 });
    expect((await send(body)).json).toMatchObject({ ingested: 0, duplicates: 1 });
    const other = JSON.stringify({ object: "page", entry: [{ id: "999", messaging: [{ sender: { id: "P" }, recipient: { id: "999" }, timestamp: 1, message: { mid: "x1", text: "hi" } }] }] });
    expect((await send(other)).json).toMatchObject({ ingested: 0 });

    const [m] = opened(await db.select().from(messages).where(eq(messages.externalId, "m_in_1")));
    expect(m).toMatchObject({ text: "I want to order 3 cushions", senderName: "Meena K", direction: "inbound" });
    const convs = await call(listConversations, { url: "/x", cookie: ws.cookie });
    const conv = convs.json.items.find((c: { externalId: string }) => c.externalId === "PSID9");
    expect(conv).toMatchObject({ title: "Meena K", channelType: "messenger" });

    // Reply from the inbox
    const sent = await call(reply, { url: "/x", cookie: ws.cookie, params: { id: conv.id }, body: { text: "Yes! ₹1,500 each" } });
    expect(sent.status).toBe(201);
    expect(sent.json.message).toMatchObject({ direction: "outbound", text: "Yes! ₹1,500 each", externalId: "m_reply_1" });
    const call_ = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/me/messages"))!;
    expect(JSON.parse(String(call_[1]?.body))).toMatchObject({ recipient: { id: "PSID9" }, messaging_type: "RESPONSE", message: { text: "Yes! ₹1,500 each" } });

    // Recent history import
    const channel = (await getWorkspaceChannel(db, ws.workspaceId, created.json.id))!;
    const h = await importMetaHistory(db, channel, { days: 30 });
    expect(h).toMatchObject({ imported: 2, error: null });
    const hist = opened(await db.select().from(messages).where(eq(messages.externalId, "h_1")));
    expect(hist[0]).toMatchObject({ text: "Can I order 2 lamps?", senderName: "Old Customer", direction: "inbound" });
    expect(opened(await db.select().from(messages).where(eq(messages.externalId, "h_2")))[0].direction).toBe("outbound");
    expect(await db.select().from(messages).where(eq(messages.externalId, "h_0"))).toHaveLength(0);
  });
});
