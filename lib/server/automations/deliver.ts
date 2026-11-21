/**
 * Outbound webhook deliveries.
 *
 * A delivery row stores the exact JSON payload `{ id, type, created_at, workspace_id, data }`
 * so retries resend identical bytes (receivers dedupe on `id`). Each attempt:
 *
 *   POST <endpoint url>
 *   Content-Type: application/json
 *   User-Agent: Infera-Webhooks/1.0
 *   X-Infera-Event: <type>
 *   X-Infera-Delivery: <delivery id>
 *   X-Infera-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * - 10 s timeout, redirects are not followed (a redirect counts as a failure, so a
 *   public URL can't bounce the request to an internal address);
 * - SSRF guard before every attempt (ssrf.ts);
 * - 2xx → delivered and the endpoint's failure streak resets; anything else → the
 *   attempt is recorded and the job retries with backoff, up to MAX_DELIVERY_ATTEMPTS;
 * - AUTO_DISABLE_AFTER consecutive failed attempts disable the endpoint and notify admins.
 *
 * Payload content is never logged (it carries record values) — only ids and statuses.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db";
import { webhookDeliveries, webhookEndpoints, type WebhookEndpointRow } from "../db/schema";
import { decrypt, hmacHex } from "../crypto";
import { enqueue } from "../jobs/queue";
import { log } from "../http";
import { newId } from "../ids";
import { notify } from "../notify";
import { writeAudit, SYSTEM_ACTOR } from "../audit";
import { bumpUsage } from "../usage";
import { SsrfBlockedError, assertPublicDestination } from "./ssrf";

export const MAX_DELIVERY_ATTEMPTS = 6;
export const AUTO_DISABLE_AFTER = 20;
export const DELIVERY_TIMEOUT_MS = 10_000;
export const USER_AGENT = "Infera-Webhooks/1.0";

export type WebhookPayload = { id: string; type: string; created_at: string; workspace_id: string; data: unknown };
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

/** `X-Infera-Signature` value for a raw body. Receivers recompute the HMAC over `${t}.${body}`. */
export function signatureHeader(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${hmacHex("sha256", secret, `${t}.${body}`)}`;
}

/**
 * Inserts a pending delivery and its `deliver_webhook` job (same transaction when `db` is one).
 * Idempotent when `id` is given: a second call with the same id does nothing.
 */
export async function queueDelivery(
  db: Database,
  input: { workspaceId: string; endpointId: string; payload: WebhookPayload; id?: string; priority?: number },
): Promise<string> {
  const id = input.id ?? newId("dlv");
  const inserted = await db
    .insert(webhookDeliveries)
    .values({ id, workspaceId: input.workspaceId, endpointId: input.endpointId, eventType: input.payload.type, payload: input.payload, status: "pending" })
    .onConflictDoNothing({ target: webhookDeliveries.id })
    .returning({ id: webhookDeliveries.id });
  if (inserted.length) {
    await enqueue(db, {
      type: "deliver_webhook",
      workspaceId: input.workspaceId,
      payload: { deliveryId: id },
      priority: input.priority ?? 60,
      maxAttempts: MAX_DELIVERY_ATTEMPTS,
      dedupeKey: `dlv:${id}`,
    });
  }
  return id;
}

export type DeliveryOutcome =
  /** Delivered (2xx), or already delivered earlier. */
  | { state: "delivered"; status: number | null }
  /** Failed attempt that should be retried. */
  | { state: "retry"; error: string; status: number | null }
  /** Failed for good (attempts exhausted, blocked destination). `inactive`: endpoint deleted/disabled, nothing was sent. */
  | { state: "failed"; error: string; status: number | null; inactive?: boolean }
  /** Nothing to do (delivery deleted). */
  | { state: "missing" };

const errorText = (e: unknown): string => {
  if (e instanceof SsrfBlockedError) return e.message;
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return `Timed out after ${DELIVERY_TIMEOUT_MS / 1000} s.`;
    const code = (e as { cause?: { code?: unknown } }).cause?.code ?? (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z_0-9]{2,40}$/.test(code)) return code === "ENOTFOUND" || code === "EAI_AGAIN" ? "The webhook host did not resolve." : `Connection failed (${code}).`;
    if (e.message === "The webhook host did not resolve.") return e.message;
  }
  return "Connection failed.";
};

/** Counts a failed attempt on the endpoint; disables it (once) after AUTO_DISABLE_AFTER in a row. */
async function recordEndpointFailure(db: Database, endpoint: WebhookEndpointRow, status: number | null): Promise<void> {
  const now = new Date();
  const [row] = await db
    .update(webhookEndpoints)
    .set({ failureCount: sql`${webhookEndpoints.failureCount} + 1`, lastStatus: status, lastDeliveryAt: now, updatedAt: now })
    .where(and(eq(webhookEndpoints.id, endpoint.id), eq(webhookEndpoints.workspaceId, endpoint.workspaceId)))
    .returning({ failureCount: webhookEndpoints.failureCount });
  if (!row || row.failureCount < AUTO_DISABLE_AFTER) return;
  const disabled = await db
    .update(webhookEndpoints)
    .set({ enabled: false, updatedAt: now })
    .where(and(eq(webhookEndpoints.id, endpoint.id), eq(webhookEndpoints.workspaceId, endpoint.workspaceId), eq(webhookEndpoints.enabled, true)))
    .returning({ id: webhookEndpoints.id });
  if (!disabled.length) return;
  let host = "your endpoint";
  try {
    host = new URL(endpoint.url).host;
  } catch {
    /* keep generic */
  }
  await writeAudit(db, {
    workspaceId: endpoint.workspaceId,
    actor: SYSTEM_ACTOR,
    action: "webhook.auto_disable",
    targetType: "webhook_endpoint",
    targetId: endpoint.id,
    before: { enabled: true },
    after: { enabled: false },
    meta: { consecutiveFailures: row.failureCount },
  });
  await notify(db, {
    workspaceId: endpoint.workspaceId,
    userIds: "admins",
    type: "webhook_disabled",
    title: "Webhook endpoint disabled",
    body: `Infera stopped sending events to ${host} after ${row.failureCount} failed deliveries in a row. Fix the receiver, then re-enable the endpoint.`,
    link: "/console/settings/webhooks",
  });
  log("warn", "webhook_endpoint_disabled", { workspaceId: endpoint.workspaceId, endpointId: endpoint.id, failures: row.failureCount });
}

/**
 * Attempts one delivery. Never throws for delivery failures — it reports them.
 * `inline` (console "send test event"): sends even if the endpoint is disabled, fails
 * immediately instead of scheduling retries, and doesn't count toward auto-disable.
 */
export async function deliverWebhook(db: Database, deliveryId: string, opts: { inline?: boolean } = {}): Promise<DeliveryOutcome> {
  const [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId)).limit(1);
  if (!delivery) return { state: "missing" };
  if (delivery.status === "delivered") return { state: "delivered", status: delivery.responseStatus };
  if (delivery.status === "failed" && !opts.inline) return { state: "failed", error: delivery.error ?? "Delivery failed.", status: delivery.responseStatus, inactive: true };

  const [endpoint] = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, delivery.endpointId), eq(webhookEndpoints.workspaceId, delivery.workspaceId)))
    .limit(1);

  const finalize = async (patch: Partial<DeliveryRow>) => {
    await db
      .update(webhookDeliveries)
      .set(patch)
      .where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.workspaceId, delivery.workspaceId)));
  };

  if (!endpoint) {
    await finalize({ status: "failed", error: "The webhook endpoint no longer exists." });
    return { state: "failed", error: "The webhook endpoint no longer exists.", status: null, inactive: true };
  }
  if (!endpoint.enabled && !opts.inline) {
    await finalize({ status: "failed", error: "The webhook endpoint is disabled." });
    return { state: "failed", error: "The webhook endpoint is disabled.", status: null, inactive: true };
  }

  const attempt = delivery.attempts + 1;
  const body = JSON.stringify(delivery.payload);
  let status: number | null = null;
  let error: string | null = null;
  let permanent = false;

  try {
    let secret: string;
    try {
      secret = decrypt(endpoint.secretEnc);
    } catch {
      permanent = true;
      throw new Error("The signing secret can't be decrypted — rotate the endpoint's secret.");
    }
    const url = await assertPublicDestination(endpoint.url).catch((e: unknown) => {
      if (e instanceof SsrfBlockedError) permanent = true;
      throw e;
    });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "X-Infera-Event": delivery.eventType,
        "X-Infera-Delivery": delivery.id,
        "X-Infera-Signature": signatureHeader(secret, body),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    status = res.status;
    // The response body is not needed (and never stored); release the connection.
    await res.body?.cancel().catch(() => {});
    if (status < 200 || status >= 300) error = status >= 300 && status < 400 ? `HTTP ${status} (redirects are not followed).` : `HTTP ${status}.`;
  } catch (e) {
    error = e instanceof Error && e.message.startsWith("The signing secret") ? e.message : errorText(e);
  }

  const now = new Date();
  if (!error) {
    await finalize({ status: "delivered", attempts: attempt, responseStatus: status, error: null, deliveredAt: now });
    await db
      .update(webhookEndpoints)
      .set({ failureCount: 0, lastStatus: status, lastDeliveryAt: now, updatedAt: now })
      .where(and(eq(webhookEndpoints.id, endpoint.id), eq(webhookEndpoints.workspaceId, endpoint.workspaceId)));
    await bumpUsage(delivery.workspaceId, { webhooks_delivered: 1 }, db).catch(() => {});
    log("info", "webhook_delivered", { deliveryId: delivery.id, endpointId: endpoint.id, status, attempt });
    return { state: "delivered", status };
  }

  const final = opts.inline || permanent || attempt >= MAX_DELIVERY_ATTEMPTS;
  await finalize({ status: final ? "failed" : "pending", attempts: attempt, responseStatus: status, error: error.slice(0, 500) });
  if (opts.inline) {
    await db
      .update(webhookEndpoints)
      .set({ lastStatus: status, lastDeliveryAt: now, updatedAt: now })
      .where(and(eq(webhookEndpoints.id, endpoint.id), eq(webhookEndpoints.workspaceId, endpoint.workspaceId)));
  } else {
    await recordEndpointFailure(db, endpoint, status);
  }
  log("warn", "webhook_delivery_failed", { deliveryId: delivery.id, endpointId: endpoint.id, status, attempt, final, blocked: permanent });
  return final ? { state: "failed", error, status } : { state: "retry", error, status };
}
