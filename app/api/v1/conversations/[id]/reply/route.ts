/**
 * POST /api/v1/conversations/:id/reply { text } (member / API write)
 * → 201 { messageId, delivered: true, message: MessageDTO }
 * → 422 when the channel can't send replies (export / API / email channels, missing credentials, paused)
 * → 502 when the provider rejected the message, 503 when it was unreachable (safe to retry)
 *
 * Sent through the conversation's provider (WhatsApp Cloud API, Telegram, Slack, Twilio); audited as `message.send`.
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { ApiError, created, notFound, unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { toMessageDTO } from "@/lib/server/data/dto";
import { MAX_REPLY_CHARS, sendOutbound } from "@/lib/server/channels/outbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().trim().min(1, "Type a reply.").max(MAX_REPLY_CHARS) });

export const POST = workspaceRoute<{ id: string }>({ role: "member", scope: "write", rateLimit: { limit: 60, windowSec: 60 } }, async (c) => {
  const body = await c.body(Body);
  if (!c.params.id || c.params.id.length > 64) throw notFound("Conversation");
  const r = await sendOutbound(c.db, { workspaceId: c.auth.workspaceId, conversationId: c.params.id, text: body.text, actor: c.auth.actor });
  if (!r.delivered) {
    const message = r.error ?? "The reply could not be sent.";
    if (r.code === "provider_error") throw new ApiError(r.retryable ? 503 : 502, r.retryable ? "unavailable" : "provider_error", message);
    throw unprocessable(message);
  }
  const row = await c.db.query.messages.findFirst({ where: (m) => and(eq(m.id, r.messageId), eq(m.workspaceId, c.auth.workspaceId)) });
  return created({ messageId: r.messageId, delivered: true, message: row ? toMessageDTO(row) : null });
});
