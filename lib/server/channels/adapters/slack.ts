/**
 * Slack Events API — pure parsing + request signing check.
 *
 * Signature: `X-Slack-Signature: v0=<hex HMAC-SHA256(signingSecret, "v0:{X-Slack-Request-Timestamp}:{rawBody}")>`,
 * rejected when the timestamp is more than 5 minutes from now (replay protection).
 * Conversation = Slack channel id; message id = `<channel>:<ts>` (ts is unique per channel).
 */
import type { MessageKind } from "@/lib/shared/types";
import { hmacHex, safeEqual } from "../../crypto";
import type { InboundAttachment, ParsedInbound } from "../types";
import { arr, cleanMime, kindForMime, num, obj, parseTimestamp, str } from "../util";

export const SLACK_MAX_SKEW_SEC = 5 * 60;

export function verifySlackSignature(rawBody: Buffer | string, timestamp: string | null, signature: string | null, signingSecret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!timestamp || !signature || !signingSecret) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSec - Number(timestamp)) > SLACK_MAX_SKEW_SEC) return false;
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = `v0=${hmacHex("sha256", signingSecret, `v0:${timestamp}:${body}`)}`;
  return safeEqual(expected, signature.trim());
}

/** Slack mrkdwn → plain text: `<url|label>` → "label (url)", `<@U1>` → "@U1", entity decoding. */
export function slackToPlain(text: string): string {
  return text
    .replace(/<([^<>|]+)\|([^<>]+)>/g, (_m, target: string, label: string) => (/^[@#!]/.test(target) ? `${target[0] === "#" ? "#" : "@"}${label}` : `${label} (${target})`))
    .replace(/<([@#!])([^<>]+)>/g, (_m, sigil: string, id: string) => `${sigil === "#" ? "#" : "@"}${id}`)
    .replace(/<([^<>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Escapes text we send to Slack so user content can't inject <!channel> pings or links. */
export const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type SlackParsed =
  | { type: "url_verification"; challenge: string }
  | { type: "message"; teamId: string | null; message: ParsedInbound }
  | { type: "ignore"; reason: string };

const ALLOWED_SUBTYPES = new Set(["file_share", "thread_broadcast"]);

export function parseSlackPayload(payload: unknown): SlackParsed {
  const p = obj(payload);
  if (p.type === "url_verification") {
    const challenge = str(p.challenge);
    return challenge && challenge.length <= 500 ? { type: "url_verification", challenge } : { type: "ignore", reason: "bad_challenge" };
  }
  if (p.type !== "event_callback") return { type: "ignore", reason: "not_event_callback" };
  const e = obj(p.event);
  if (e.type !== "message") return { type: "ignore", reason: "not_message" };
  const subtype = str(e.subtype);
  if (e.bot_id || e.bot_profile || (subtype && !ALLOWED_SUBTYPES.has(subtype))) return { type: "ignore", reason: "bot_or_subtype" };
  const channel = str(e.channel);
  const ts = str(e.ts);
  const user = str(e.user);
  if (!channel || !ts || !user) return { type: "ignore", reason: "incomplete" };

  const attachments: InboundAttachment[] = arr(e.files).map((f) => {
    const file = obj(f);
    const mime = cleanMime(file.mimetype);
    // url_private needs the bot token, so it's kept as a provider reference, not a public URL.
    return { name: str(file.name) ?? str(file.title) ?? `file-${str(file.id) ?? ""}`, mime, size: num(file.size), providerId: str(file.id) };
  });
  const text = slackToPlain(str(e.text) ?? "");
  if (!text.trim() && !attachments.length) return { type: "ignore", reason: "empty" };
  const kind: MessageKind = !text.trim() && attachments[0] ? kindForMime(attachments[0].mime) : "text";
  const channelType = str(e.channel_type) ?? "channel";
  const threadTs = str(e.thread_ts);
  return {
    type: "message",
    teamId: str(p.team_id) ?? str(e.team),
    message: {
      externalId: `${channel}:${ts}`,
      direction: "inbound",
      conversation: { externalId: channel, title: channelType === "im" ? null : channel, isGroup: channelType !== "im" },
      sender: { externalId: user, name: null },
      kind,
      text,
      attachments,
      sentAt: parseTimestamp(ts) ?? new Date(),
      replyToExternalId: threadTs && threadTs !== ts ? `${channel}:${threadTs}` : null,
      raw: { provider: "slack", eventId: str(p.event_id), channelType, subtype, threadTs },
    },
  };
}
