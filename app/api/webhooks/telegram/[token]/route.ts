/**
 * Telegram Bot API webhook. `X-Telegram-Bot-Api-Secret-Token` must equal the
 * channel's `webhookSecret` (set via setWebhook `secret_token`).
 */
import { getDb } from "@/lib/server/db";
import { parseTelegramUpdate, verifyTelegramSecret } from "@/lib/server/channels/adapters/telegram";
import { decryptSecrets, findChannelByToken } from "@/lib/server/channels/registry";
import { badSignatureResponse, channelRateLimit, ingestForChannel, notFoundResponse, webhookError, webhookHandler, webhookJson, WEBHOOK_MAX_BYTES } from "@/lib/server/channels/webhook-http";
import { readCappedBytes, tryJson } from "@/lib/server/channels/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = webhookHandler<{ token: string }>("telegram", async (req, { token }) => {
  const db = await getDb();
  const channel = await findChannelByToken(db, "telegram", token);
  if (!channel) return notFoundResponse();
  const secrets = decryptSecrets(channel);
  if (!verifyTelegramSecret(req.headers.get("x-telegram-bot-api-secret-token"), secrets.webhookSecret ?? "")) return badSignatureResponse();
  const raw = await readCappedBytes(req, WEBHOOK_MAX_BYTES);
  const update = tryJson(raw.toString("utf8"));
  if (update === undefined) return webhookError(400, "bad_request", "Body is not valid JSON.");
  const limited = await channelRateLimit(channel);
  if (limited) return limited;
  const parsed = parseTelegramUpdate(update);
  const s = await ingestForChannel(db, channel, parsed ? [parsed] : [], "telegram");
  return webhookJson({ ok: true, ingested: s.ingested, duplicates: s.duplicates });
});
