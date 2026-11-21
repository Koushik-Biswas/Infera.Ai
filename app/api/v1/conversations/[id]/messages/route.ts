/**
 * GET /api/v1/conversations/:id/messages?cursor=&limit= (viewer / API read)
 * → Page<MessageDTO>, newest first (the console reverses for display). Text is decrypted per page.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { notFound, pageLimit, workspaceRoute } from "@/lib/server/api/handler";
import { conversations, messages } from "@/lib/server/db/schema";
import { decodeKeyset, exactTimestamp, pageOf } from "@/lib/server/automations/paging";
import { toMessageDTO } from "@/lib/server/data/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute<{ id: string }>({ role: "viewer", scope: "read" }, async (c) => {
  const [conv] = await c.db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, c.params.id), eq(conversations.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!conv) throw notFound("Conversation");
  const limit = pageLimit(c.query, 50, 200);
  const cursor = decodeKeyset(c.query.get("cursor"));
  const rows = await c.db
    .select({
      id: messages.id,
      workspaceId: messages.workspaceId,
      conversationId: messages.conversationId,
      channelId: messages.channelId,
      contactId: messages.contactId,
      externalId: messages.externalId,
      direction: messages.direction,
      senderName: messages.senderName,
      senderHandle: messages.senderHandle,
      kind: messages.kind,
      text: messages.text,
      attachments: messages.attachments,
      sentAt: messages.sentAt,
      receivedAt: messages.receivedAt,
      status: messages.status,
      classification: messages.classification,
      eventId: messages.eventId,
      createdAt: messages.createdAt,
      cursorAt: exactTimestamp(messages.sentAt),
    })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, c.auth.workspaceId),
        eq(messages.conversationId, conv.id),
        ...(cursor ? [sql`(${messages.sentAt}, ${messages.id}) < (${cursor.at}::timestamptz, ${cursor.id})`] : []),
      ),
    )
    .orderBy(desc(messages.sentAt), desc(messages.id))
    .limit(limit + 1);
  const { rows: page, nextCursor } = pageOf(rows, limit);
  return { items: page.map((m) => toMessageDTO(m)), nextCursor };
});
