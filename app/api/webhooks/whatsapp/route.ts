/**
 * WhatsApp Cloud API webhook — shared Meta app (multi-tenant mode).
 *
 * GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=… → echoes the challenge (WHATSAPP_VERIFY_TOKEN).
 * POST signed with X-Hub-Signature-256 (WHATSAPP_APP_SECRET) → messages routed to channels by
 *      `metadata.phone_number_id`. Unknown numbers are ignored (still 200, so Meta doesn't retry forever).
 */
import { getDb } from "@/lib/server/db";
import { whatsappAppSecret, whatsappVerifyToken } from "@/lib/server/env";
import { log } from "@/lib/server/http";
import { parseWhatsAppPayload, verifyWhatsAppSignature, whatsappVerifyChallenge } from "@/lib/server/channels/adapters/whatsapp";
import { findChannelByExternalId } from "@/lib/server/channels/registry";
import { badSignatureResponse, channelRateLimit, ingestForChannel, notFoundResponse, webhookError, webhookHandler, webhookJson, webhookText, WEBHOOK_MAX_BYTES } from "@/lib/server/channels/webhook-http";
import { readCappedBytes, tryJson } from "@/lib/server/channels/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = webhookHandler("whatsapp_shared_verify", async (req) => {
  const token = whatsappVerifyToken();
  if (!token) return notFoundResponse();
  const challenge = whatsappVerifyChallenge(new URL(req.url).searchParams, token);
  return challenge === null ? webhookError(403, "forbidden", "Verification failed.") : webhookText(challenge);
});

export const POST = webhookHandler("whatsapp_shared", async (req) => {
  const secret = whatsappAppSecret();
  if (!secret) return notFoundResponse();
  const raw = await readCappedBytes(req, WEBHOOK_MAX_BYTES);
  if (!verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"), secret)) return badSignatureResponse();
  const payload = tryJson(raw.toString("utf8"));
  if (payload === undefined) return webhookError(400, "bad_request", "Body is not valid JSON.");

  const db = await getDb();
  let ingested = 0;
  let duplicates = 0;
  for (const batch of parseWhatsAppPayload(payload)) {
    if (!batch.messages.length) continue;
    const channel = await findChannelByExternalId(db, "whatsapp_cloud", batch.phoneNumberId);
    if (!channel) {
      log("warn", "whatsapp_unrouted", { messages: batch.messages.length });
      continue;
    }
    const limited = await channelRateLimit(channel);
    if (limited) return limited;
    const s = await ingestForChannel(db, channel, batch.messages, "whatsapp_shared");
    ingested += s.ingested;
    duplicates += s.duplicates;
  }
  return webhookJson({ ok: true, ingested, duplicates });
});
