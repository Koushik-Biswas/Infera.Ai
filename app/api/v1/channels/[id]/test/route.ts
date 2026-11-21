/**
 * POST /api/v1/channels/:id/test { text, senderName? } (member / API write)
 * → 202 { eventId, messageId, conversationId }
 *
 * Ingests a synthetic inbound message on the channel (in a dedicated "Test conversation")
 * so admins can see the whole pipeline work before connecting the provider.
 */
import { z } from "zod";
import { jsonResponse, notFound, workspaceRoute } from "@/lib/server/api/handler";
import { newToken } from "@/lib/server/crypto";
import { kickSoon } from "@/lib/server/jobs/kick";
import { ingestInboundMessage } from "@/lib/server/channels/ingest";
import { getWorkspaceChannel } from "@/lib/server/channels/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  text: z.string().trim().min(1, "Type a test message.").max(4000),
  senderName: z.string().trim().max(80).optional(),
});

export const POST = workspaceRoute<{ id: string }>({ role: "member", scope: "write", rateLimit: { limit: 60, windowSec: 60 } }, async (c) => {
  const body = await c.body(Body);
  const channel = await getWorkspaceChannel(c.db, c.auth.workspaceId, c.params.id);
  if (!channel) throw notFound("Channel");
  const r = await ingestInboundMessage(c.db, {
    workspaceId: c.auth.workspaceId,
    channelId: channel.id,
    externalId: `test_${newToken(12)}`,
    direction: "inbound",
    conversation: { externalId: "infera-test", title: "Test conversation", isGroup: false },
    sender: { externalId: "infera-test-sender", name: body.senderName || "Test sender" },
    text: body.text,
    sentAt: new Date(),
    actor: c.auth.actor,
    priority: 10,
    raw: { test: true, actorType: c.auth.actor.type, actorId: c.auth.actor.id },
  });
  kickSoon();
  return jsonResponse({ eventId: r.eventId, messageId: r.messageId, conversationId: r.conversationId }, 202);
});
