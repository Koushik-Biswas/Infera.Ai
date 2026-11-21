/**
 * Slack Events API webhook. Verifies `X-Slack-Signature` (v0 HMAC over
 * `v0:{timestamp}:{body}`, timestamp within 5 minutes) before anything else,
 * answers `url_verification`, ingests `message` events (bots and edits ignored).
 * If the channel config has `teamId`, events from other Slack workspaces are ignored.
 */
import { getDb } from "@/lib/server/db";
import { parseSlackPayload, verifySlackSignature } from "@/lib/server/channels/adapters/slack";
import { decryptSecrets, findChannelByToken } from "@/lib/server/channels/registry";
import { badSignatureResponse, channelRateLimit, ingestForChannel, notFoundResponse, webhookError, webhookHandler, webhookJson, WEBHOOK_MAX_BYTES } from "@/lib/server/channels/webhook-http";
import { obj, readCappedBytes, str, tryJson } from "@/lib/server/channels/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = webhookHandler<{ token: string }>("slack", async (req, { token }) => {
  const db = await getDb();
  const channel = await findChannelByToken(db, "slack", token);
  if (!channel) return notFoundResponse();
  const raw = await readCappedBytes(req, WEBHOOK_MAX_BYTES);
  const secrets = decryptSecrets(channel);
  if (!verifySlackSignature(raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"), secrets.signingSecret ?? "")) return badSignatureResponse();
  const payload = tryJson(raw.toString("utf8"));
  if (payload === undefined) return webhookError(400, "bad_request", "Body is not valid JSON.");

  const parsed = parseSlackPayload(payload);
  if (parsed.type === "url_verification") return webhookJson({ challenge: parsed.challenge });
  if (parsed.type === "ignore") return webhookJson({ ok: true, ignored: parsed.reason });
  const teamId = str(obj(channel.config).teamId);
  if (teamId && parsed.teamId && teamId !== parsed.teamId) return webhookJson({ ok: true, ignored: "other_team" });
  const limited = await channelRateLimit(channel);
  if (limited) return limited;
  const s = await ingestForChannel(db, channel, [parsed.message], "slack");
  return webhookJson({ ok: true, ingested: s.ingested, duplicates: s.duplicates });
});
