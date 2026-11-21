import { cleanText, guardJsonPost, json, log } from "@/lib/server/http";
import { deliverWebhook, slackEscape, WebhookNotConfigured } from "@/lib/server/webhook";
import { HONEYPOT_FIELD, isValidCountryCode, isValidEmail, TEAM_SIZES, toE164 } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "demo";

/**
 * Demo-request endpoint. Validates input and forwards it to DEMO_WEBHOOK_URL
 * (Slack / Zapier / CRM). In development without the env var it only logs.
 */
export async function POST(request: Request) {
  const g = await guardJsonPost(request, { route: ROUTE, limit: 5, windowSec: 600 });
  if (!g.ok) return g.response;
  const body = g.body;

  // Bot filled the invisible field: pretend success, store nothing.
  if (cleanText(body[HONEYPOT_FIELD], 200)) {
    log("info", "honeypot_triggered", { route: ROUTE });
    return json({ ok: true });
  }

  const country = cleanText(body.country, 5) || "+91";
  const phoneRaw = cleanText(body.phone, 20);
  const teamSize = cleanText(body.teamSize, 20);
  const data = {
    name: cleanText(body.name, 120),
    email: cleanText(body.email, 254).toLowerCase(),
    country,
    phone: phoneRaw,
    phoneE164: toE164(country, phoneRaw),
    business: cleanText(body.business, 160),
    teamSize: (TEAM_SIZES as readonly string[]).includes(teamSize) ? teamSize : "",
    message: cleanText(body.message, 2000, { multiline: true }),
  };

  if (!data.name) return json({ error: "Please enter your name." }, 422);
  if (!data.business) return json({ error: "Tell us your business name." }, 422);
  if (!isValidEmail(data.email)) return json({ error: "Enter a valid email address." }, 422);
  if (!isValidCountryCode(country) || !data.phoneE164) return json({ error: "Enter a valid phone number." }, 422);

  const text = [
    `*New demo request* — ${slackEscape(data.business)}`,
    `${slackEscape(data.name)} · ${slackEscape(data.email)} · ${data.phoneE164}`,
    data.teamSize && `Team size: ${slackEscape(data.teamSize)}`,
    data.message && `> ${slackEscape(data.message).replace(/\n/g, "\n> ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { id } = await deliverWebhook(process.env.DEMO_WEBHOOK_URL, "demo_request", text, data);
    log("info", "submission_delivered", { route: ROUTE, id });
  } catch (e) {
    if (e instanceof WebhookNotConfigured) {
      log("error", "webhook_not_configured", { route: ROUTE, env: "DEMO_WEBHOOK_URL" });
      return json({ error: "Demo booking is temporarily unavailable. Please email us instead." }, 503);
    }
    log("error", "webhook_failed", { route: ROUTE, message: e instanceof Error ? e.message : String(e) });
    return json({ error: "We couldn't submit your request. Please try again." }, 502);
  }
  return json({ ok: true });
}
