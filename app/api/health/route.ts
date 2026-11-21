import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for load balancers and uptime monitors.
 * Reports "degraded" (still HTTP 200, the site itself is up) when a form
 * webhook is missing, because those forms will return 503 until it's set.
 * Only booleans are exposed — never URLs or secrets.
 */
export function GET() {
  const checks = {
    demoWebhook: Boolean(process.env.DEMO_WEBHOOK_URL),
    channelWebhook: Boolean(process.env.CHANNEL_WEBHOOK_URL),
    sharedRateLimit: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  };
  const status = checks.demoWebhook && checks.channelWebhook ? "ok" : "degraded";
  return json({ status, checks, time: new Date().toISOString() });
}
