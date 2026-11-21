import { cleanText, guardJsonPost, json, log } from "@/lib/server/http";
import { deliverWebhook, slackEscape, WebhookNotConfigured } from "@/lib/server/webhook";
import { CHANNEL_IDS, HONEYPOT_FIELD, isValidEmail } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "channel-request";
const ALLOWED = new Set<string>(CHANNEL_IDS);

/** Records which upcoming channels a visitor wants. Forwards to CHANNEL_WEBHOOK_URL. */
export async function POST(request: Request) {
  const g = await guardJsonPost(request, { route: ROUTE, limit: 10, windowSec: 600 });
  if (!g.ok) return g.response;
  const body = g.body;

  if (cleanText(body[HONEYPOT_FIELD], 200)) {
    log("info", "honeypot_triggered", { route: ROUTE });
    return json({ ok: true });
  }

  const channels = Array.isArray(body.channels)
    ? [...new Set(body.channels.filter((c): c is string => typeof c === "string" && ALLOWED.has(c)))]
    : [];
  if (!channels.length) return json({ error: "Pick at least one channel." }, 422);

  const email = cleanText(body.email, 254).toLowerCase() || undefined;
  if (email && !isValidEmail(email)) return json({ error: "That email doesn't look right." }, 422);

  const text = `*Channel vote*: ${channels.join(", ")}${email ? ` — ${slackEscape(email)}` : ""}`;

  try {
    const { id } = await deliverWebhook(process.env.CHANNEL_WEBHOOK_URL, "channel_request", text, { channels, email });
    log("info", "submission_delivered", { route: ROUTE, id });
  } catch (e) {
    if (e instanceof WebhookNotConfigured) {
      log("error", "webhook_not_configured", { route: ROUTE, env: "CHANNEL_WEBHOOK_URL" });
      return json({ error: "Voting is temporarily unavailable. Please try again later." }, 503);
    }
    log("error", "webhook_failed", { route: ROUTE, message: e instanceof Error ? e.message : String(e) });
    return json({ error: "Could not save your vote. Please try again." }, 502);
  }
  return json({ ok: true });
}
