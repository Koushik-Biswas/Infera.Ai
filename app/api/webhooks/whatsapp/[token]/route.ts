/**
 * WhatsApp Cloud API webhook — per-channel Meta app.
 *
 * The channel's own `verifyToken` / `appSecret` secrets are used. Only messages
 * for the channel's phone_number_id are accepted (another number on the same
 * app is ignored rather than mis-filed).
 */
import { getDb } from "@/lib/server/db";
import { parseWhatsAppPayload, verifyWhatsAppSignature, whatsappVerifyChallenge } from "@/lib/server/channels/adapters/whatsapp";
import { decryptSecrets, findChannelByToken } from "@/lib/server/channels/registry";
import { badSignatureResponse, channelRateLimit, ingestForChannel, notFoundResponse, webhookError, webhookHandler, webhookJson, webhookText, WEBHOOK_MAX_BYTES } from "@/lib/server/channels/webhook-http";
import { readCappedBytes, tryJson } from "@/lib/server/channels/util";
import { log } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { token: string };

export const GET = webhookHandler<Params>("whatsapp_channel_verify", async (req, { token }) => {
  const db = await getDb();
  const channel = await findChannelByToken(db, "whatsapp_cloud", token);
  if (!channel) return notFoundResponse();
  const secrets = decryptSecrets(channel);
  const challenge = whatsappVerifyChallenge(new URL(req.url).searchParams, secrets.verifyToken ?? "");
  return challenge === null ? webhookError(403, "forbidden", "Verification failed.") : webhookText(challenge);
});

export const POST = webhookHandler<Params>("whatsapp_channel", async (req, { token }) => {
  const db = await getDb();
  const channel = await findChannelByToken(db, "whatsapp_cloud", token);
  if (!channel) return notFoundResponse();
  const raw = await readCappedBytes(req, WEBHOOK_MAX_BYTES);
  const secrets = decryptSecrets(channel);
  if (!verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"), secrets.appSecret ?? "")) return badSignatureResponse();
  const payload = tryJson(raw.toString("utf8"));
  if (payload === undefined) return webhookError(400, "bad_request", "Body is not valid JSON.");
  const limited = await channelRateLimit(channel);
  if (limited) return limited;

  const messages = parseWhatsAppPayload(payload).flatMap((b) => {
    if (channel.externalId && b.phoneNumberId !== channel.externalId) {
      if (b.messages.length) log("warn", "whatsapp_other_number_ignored", { channelId: channel.id, messages: b.messages.length });
      return [];
    }
    return b.messages;
  });
  const s = await ingestForChannel(db, channel, messages, "whatsapp_channel");
  return webhookJson({ ok: true, ingested: s.ingested, duplicates: s.duplicates });
});
