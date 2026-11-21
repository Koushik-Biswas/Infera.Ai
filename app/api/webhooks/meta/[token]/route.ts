/**
 * Meta Messenger / Instagram Direct webhook (official Messenger Platform), one URL per channel.
 *
 *   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=… → echoes the challenge (channel verifyToken)
 *   POST X-Hub-Signature-256 signed with the channel's appSecret → messages ingested live
 *
 * Only events for the channel's own Page (Messenger) / Instagram account are accepted.
 * Customer names are looked up from the Graph API (cached) because webhooks carry only ids.
 */
import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "@/lib/server/db";
import { channels, type ChannelRow } from "@/lib/server/db/schema";
import { metaVerifyChallenge, parseMetaPayload, verifyMetaSignature } from "@/lib/server/channels/adapters/meta";
import { metaNames } from "@/lib/server/channels/meta-graph";
import { decryptSecrets } from "@/lib/server/channels/registry";
import { badSignatureResponse, channelRateLimit, ingestForChannel, notFoundResponse, webhookError, webhookHandler, webhookJson, webhookText, WEBHOOK_MAX_BYTES } from "@/lib/server/channels/webhook-http";
import { readCappedBytes, tryJson } from "@/lib/server/channels/util";
import { log } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { token: string };

async function channelFor(db: Database, token: string): Promise<ChannelRow | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.webhookToken, token)))
    .limit(1);
  return row && (row.type === "messenger" || row.type === "instagram") ? row : null;
}

export const GET = webhookHandler<Params>("meta_verify", async (req, { token }) => {
  const db = await getDb();
  const channel = await channelFor(db, token);
  if (!channel) return notFoundResponse();
  const challenge = metaVerifyChallenge(new URL(req.url).searchParams, decryptSecrets(channel).verifyToken ?? "");
  return challenge === null ? webhookError(403, "forbidden", "Verification failed.") : webhookText(challenge);
});

export const POST = webhookHandler<Params>("meta", async (req, { token }) => {
  const db = await getDb();
  const channel = await channelFor(db, token);
  if (!channel) return notFoundResponse();
  const raw = await readCappedBytes(req, WEBHOOK_MAX_BYTES);
  const secrets = decryptSecrets(channel);
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secrets.appSecret ?? "")) return badSignatureResponse();
  const payload = tryJson(raw.toString("utf8"));
  if (payload === undefined) return webhookError(400, "bad_request", "Body is not valid JSON.");
  const limited = await channelRateLimit(channel);
  if (limited) return limited;

  const platform = channel.type === "instagram" ? "instagram" : "messenger";
  const cfg = channel.config ?? {};
  const own = new Set([cfg.pageId, cfg.instagramAccountId].filter((x): x is string => typeof x === "string" && x.length > 0));
  const mine = (accountId: string, p: string) => p === platform && (own.size === 0 || own.has(accountId) || (platform === "instagram" && !cfg.instagramAccountId));
  const batches = parseMetaPayload(payload).filter((b) => {
    const ok = mine(b.accountId, b.platform);
    if (!ok && b.messages.length) log("warn", "meta_other_account_ignored", { channelId: channel.id, platform: b.platform, messages: b.messages.length });
    return ok;
  });
  const ids = [...new Set(batches.flatMap((b) => b.customerIds))];
  const names = secrets.pageAccessToken && ids.length ? await metaNames({ pageAccessToken: secrets.pageAccessToken, platform, ids }) : new Map<string, string>();
  const messages = parseMetaPayload(payload, names)
    .filter((b) => mine(b.accountId, b.platform))
    .flatMap((b) => b.messages);
  const s = await ingestForChannel(db, channel, messages, platform);
  return webhookJson({ ok: true, ingested: s.ingested, duplicates: s.duplicates });
});
