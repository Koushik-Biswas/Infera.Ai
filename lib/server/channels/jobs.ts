/**
 * `send_reply` job (enqueued by the automations module's `reply` action).
 * Transient provider failures throw so the queue retries with backoff;
 * permanent ones (unsupported channel, rejected message, missing credentials,
 * conversation gone) end the job with PermanentJobError.
 */
import { z } from "zod";
import { getDb } from "../db";
import { ApiError } from "../api/handler";
import { PermanentJobError } from "../jobs/queue";
import { sendOutbound } from "./outbound";

const Payload = z.object({
  workspaceId: z.string().min(1).max(64),
  conversationId: z.string().min(1).max(64),
  text: z.string().min(1).max(20_000),
  actor: z
    .object({
      type: z.enum(["user", "api_key", "system", "pipeline", "automation"]),
      id: z.string().max(200).nullable(),
      label: z.string().max(200).optional(),
    })
    .catch({ type: "automation", id: null, label: "Automation" }),
});

export async function handleSendReply(payload: { workspaceId: string; conversationId: string; text: string; actor: unknown }): Promise<void> {
  const parsed = Payload.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError("Invalid send_reply payload");
  const p = parsed.data;
  const db = await getDb();
  let result;
  try {
    result = await sendOutbound(db, { workspaceId: p.workspaceId, conversationId: p.conversationId, text: p.text, actor: p.actor });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new PermanentJobError("Conversation no longer exists");
    throw e;
  }
  if (result.delivered) return;
  if (result.retryable) throw new Error(result.error ?? "Reply delivery failed");
  throw new PermanentJobError(result.error ?? "Reply could not be delivered");
}
