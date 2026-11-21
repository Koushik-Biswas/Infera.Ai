import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/server/db";
import { channels } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { newToken } from "@/lib/server/crypto";
import { kvStore } from "@/lib/server/sync/session";
import { contentText, isIgnoredJid, parseLinkedDeviceMessage, phoneFromJid, toNum, unwrapContent } from "@/lib/server/channels/adapters/whatsapp-web";
import { createTestWorkspace } from "./helpers";

const who = { chatJid: "919876543210@s.whatsapp.net", chatTitle: "Asha", sender: { jid: "919876543210@s.whatsapp.net", phone: "+919876543210", name: "Asha" } };

describe("whatsapp linked device — message parsing", () => {
  it("parses a plain inbound text message", () => {
    const p = parseLinkedDeviceMessage({ key: { id: "ABC1", remoteJid: who.chatJid, fromMe: false }, message: { conversation: "Need 2 kg rice tomorrow" }, messageTimestamp: 1_760_000_000, pushName: "Asha" }, who);
    expect(p).toMatchObject({
      externalId: "ABC1",
      direction: "inbound",
      conversation: { externalId: who.chatJid, title: "Asha", isGroup: false },
      sender: { phone: "+919876543210", name: "Asha" },
      kind: "text",
      text: "Need 2 kg rice tomorrow",
    });
    expect(p!.sentAt.getTime()).toBe(1_760_000_000_000);
    // Never keeps message content in raw.
    expect(JSON.stringify(p!.raw)).not.toContain("rice");
  });

  it("marks own messages as outbound and accepts Long-like timestamps", () => {
    const p = parseLinkedDeviceMessage({ key: { id: "OUT1", remoteJid: who.chatJid, fromMe: true }, message: { extendedTextMessage: { text: "Sure, sending today", contextInfo: { stanzaId: "ABC1" } } }, messageTimestamp: { toNumber: () => 1_760_000_100 } }, { ...who, sender: null });
    expect(p).toMatchObject({ direction: "outbound", sender: { isMe: true }, replyToExternalId: "ABC1", text: "Sure, sending today" });
  });

  it("unwraps ephemeral/view-once containers and describes media", () => {
    const content = unwrapContent({ ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: { caption: "invoice", mimetype: "image/jpeg", fileLength: 2048 } } } } } });
    expect(contentText(content)).toMatchObject({ kind: "image", text: "invoice" });
    const p = parseLinkedDeviceMessage({ key: { id: "IMG1", remoteJid: "1203630@g.us" }, message: { documentWithCaptionMessage: { message: { documentMessage: { fileName: "price-list.pdf", mimetype: "application/pdf", caption: "" } } } } }, { chatJid: "1203630@g.us", chatTitle: "Wholesale", sender: { jid: "447700900123@s.whatsapp.net", phone: "+447700900123", name: "Ben" } });
    expect(p).toMatchObject({ kind: "document", conversation: { isGroup: true, title: "Wholesale" }, attachments: [{ name: "price-list.pdf", mime: "application/pdf", providerId: "IMG1" }] });
  });

  it("turns contacts and locations into readable text", () => {
    const vcard = "BEGIN:VCARD\nVERSION:3.0\nFN:Ravi Kumar\nORG:Kumar Traders;\nTEL;type=CELL;waid=919800000000:+91 98000 00000\nEND:VCARD";
    expect(contentText({ contactMessage: { displayName: "Ravi", vcard } })).toMatchObject({ kind: "contact", text: "Contact: Ravi, Kumar Traders, +91 98000 00000" });
    expect(contentText({ locationMessage: { degreesLatitude: 12.97, degreesLongitude: 77.59, name: "Shop" } })).toMatchObject({ kind: "location", text: "📍 12.97,77.59 Shop" });
  });

  it("skips reactions, protocol messages, status and newsletters", () => {
    expect(parseLinkedDeviceMessage({ key: { id: "R1", remoteJid: who.chatJid }, message: { reactionMessage: { text: "👍" } } }, who)).toBeNull();
    expect(parseLinkedDeviceMessage({ key: { id: "P1", remoteJid: who.chatJid }, message: { protocolMessage: { type: 0 } } }, who)).toBeNull();
    expect(parseLinkedDeviceMessage({ key: { id: "S1", remoteJid: "status@broadcast" }, message: { conversation: "hi" } }, { ...who, chatJid: "status@broadcast" })).toBeNull();
    expect(isIgnoredJid("1203@newsletter")).toBe(true);
    expect(isIgnoredJid(who.chatJid)).toBe(false);
  });

  it("extracts phone numbers only from phone JIDs", () => {
    expect(phoneFromJid("919876543210:12@s.whatsapp.net")).toBe("+919876543210");
    expect(phoneFromJid("123456789012345@lid")).toBeNull();
    expect(phoneFromJid("1203630@g.us")).toBeNull();
    expect(toNum("42")).toBe(42);
    expect(toNum(undefined)).toBeNull();
  });
});

describe("connector KV — batched writes", () => {
  it("upserts and deletes many keys in one call", async () => {
    const ws = await createTestWorkspace();
    const db = await getDb();
    const [ch] = await db.insert(channels).values({ id: newId("chn"), workspaceId: ws.workspaceId, type: "whatsapp_web", name: "WA", webhookToken: newToken(18), config: {} }).returning();
    const kv = kvStore(db, ch.id);
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 450; i++) many[`pre-key:${i}`] = `v${i}`;
    await kv.setMany(many);
    expect(await kv.get("pre-key:449")).toBe("v449");
    await kv.setMany({ "pre-key:1": "changed", "pre-key:2": null });
    const got = await kv.getMany<string>(["pre-key:1", "pre-key:2", "pre-key:3"]);
    expect(got).toEqual({ "pre-key:1": "changed", "pre-key:3": "v3" });
    await kv.clear("pre-key:");
    expect(await kv.get("pre-key:3")).toBeNull();
  });
});
