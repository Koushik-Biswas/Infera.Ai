/**
 * Delivers form submissions to an outbound webhook (Slack, Zapier, Make, a CRM…).
 *
 * - 8s timeout per attempt; one retry on network errors, 429 and 5xx.
 * - Payload carries a `text` summary (so Slack incoming webhooks accept it)
 *   plus the structured fields at the top level (for Zapier/CRM mapping).
 * - If WEBHOOK_SIGNING_SECRET is set, adds X-Infera-Signature:
 *   "t=<unix>,v1=<hex HMAC-SHA256 of `${t}.${body}`>" so receivers can verify.
 */
import { createHmac, randomUUID } from "node:crypto";

const TIMEOUT_MS = 8000;

export class WebhookNotConfigured extends Error {}

/** Escape text for Slack mrkdwn so user input can't inject <!channel> pings or links. */
export const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function deliverWebhook(
  url: string | undefined,
  event: string,
  text: string,
  data: Record<string, unknown>,
): Promise<{ id: string; delivered: boolean }> {
  const id = randomUUID();
  if (!url) {
    if (process.env.NODE_ENV === "production") throw new WebhookNotConfigured(event);
    console.info(`[${event}] (dev, no webhook configured)`, data);
    return { id, delivered: false };
  }

  const body = JSON.stringify({ event, id, submittedAt: new Date().toISOString(), text, ...data });
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "Infera-Webhooks/1.0" };
  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  if (secret) {
    const t = Math.floor(Date.now() / 1000);
    headers["X-Infera-Signature"] = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
      if (res.ok) return { id, delivered: true };
      lastError = new Error(`Webhook responded ${res.status}`);
      if (res.status !== 429 && res.status < 500) break; // 4xx = config problem; retrying won't help
    } catch (e) {
      lastError = e;
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 400));
  }
  throw lastError;
}
