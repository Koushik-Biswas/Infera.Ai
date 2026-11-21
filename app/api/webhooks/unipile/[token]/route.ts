/**
 * Unipile (LinkedIn) webhook, one URL per channel. Unipile sends our secret in the
 * `X-Infera-Token` header (set when the webhook was registered); only `message_received`
 * events for the channel's own LinkedIn account are ingested.
 */
import { getDb } from "@/lib/server/db";
import { safeEqual } from "@/lib/server/crypto";
import { decryptSecrets, findChannelByToken } from "@/lib/server/channels/registry";
import { parseUnipileEvent } from "@/lib/server/channels/unipile";
import { badSignatureResponse, channelRateLimit, ingestForChannel, notFoundResponse, webhookError, webhookHandler, webhookJson, WEBHOOK_MAX_BYTES } from "@/lib/server/channels/webhook-http";
import { readCappedBytes, tryJson } from "@/lib/server/channels/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = webhookHandler<{ token: string }>("unipile", async (req, { token }) => {
  const db = await getDb();
  const channel = await findChannelByToken(db, "linkedin", token);
  if (!channel) return notFoundResponse();
  const secret = decryptSecrets(channel).webhookSecret ?? "";
  const provided = req.headers.get("x-infera-token") ?? "";
  if (!secret || !safeEqual(provided, secret)) return badSignatureResponse();
  const raw = await readCappedBytes(req, WEBHOOK_MAX_BYTES);
  const payload = tryJson(raw.toString("utf8"));
  if (payload === undefined) return webhookError(400, "bad_request", "Body is not valid JSON.");
  const limited = await channelRateLimit(channel);
  if (limited) return limited;
  const accountId = typeof channel.config?.accountId === "string" ? channel.config.accountId : null;
  const msg = parseUnipileEvent(payload, accountId);
  const s = await ingestForChannel(db, channel, msg ? [msg] : [], "unipile");
  return webhookJson({ ok: true, ingested: s.ingested, duplicates: s.duplicates });
});
