/**
 * Twilio Messaging webhook (SMS/MMS and WhatsApp-via-Twilio). Form-encoded body,
 * `X-Twilio-Signature` verified with the channel's auth token against the public
 * URL (APP_URL) and the URL as received. Responds with empty TwiML.
 */
import { getDb } from "@/lib/server/db";
import { appUrl } from "@/lib/server/env";
import { parseTwilioForm, verifyTwilioSignature } from "@/lib/server/channels/adapters/twilio";
import { decryptSecrets, findChannelByToken } from "@/lib/server/channels/registry";
import { badSignatureResponse, channelRateLimit, ingestForChannel, notFoundResponse, webhookHandler, webhookText, WEBHOOK_MAX_BYTES } from "@/lib/server/channels/webhook-http";
import { readCappedBytes } from "@/lib/server/channels/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** URLs Twilio may have signed: the public APP_URL form, the forwarded host form, and the URL as received. */
function candidateUrls(req: Request): string[] {
  const u = new URL(req.url);
  const path = `${u.pathname}${u.search}`;
  const out = new Set<string>([`${appUrl()}${path}`, req.url]);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (host && proto && /^https?$/.test(proto)) out.add(`${proto}://${host}${path}`);
  return [...out];
}

export const POST = webhookHandler<{ token: string }>("sms_twilio", async (req, { token }) => {
  const db = await getDb();
  const channel = await findChannelByToken(db, "sms_twilio", token);
  if (!channel) return notFoundResponse();
  const raw = await readCappedBytes(req, WEBHOOK_MAX_BYTES);
  const entries = [...new URLSearchParams(raw.toString("utf8")).entries()];
  const secrets = decryptSecrets(channel);
  if (!verifyTwilioSignature(candidateUrls(req), entries, req.headers.get("x-twilio-signature"), secrets.authToken ?? "")) return badSignatureResponse();
  const limited = await channelRateLimit(channel);
  if (limited) return limited;
  const params: Record<string, string> = {};
  for (const [k, v] of entries) params[k] ??= v;
  const parsed = parseTwilioForm(params);
  await ingestForChannel(db, channel, parsed ? [parsed] : [], "sms_twilio");
  return webhookText(TWIML_EMPTY, 200, "text/xml; charset=utf-8");
});
