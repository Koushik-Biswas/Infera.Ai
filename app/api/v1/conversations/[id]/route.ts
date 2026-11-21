/**
 * GET   /api/v1/conversations/:id → ConversationDTO & { contact: ContactDTO | null } (viewer / API read)
 * PATCH /api/v1/conversations/:id { archived?, read?: true, agentsEnabled? } (member / API write)
 *       agentsEnabled = agents extract records from this chat ("agents on selected chats").
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { notFound, workspaceRoute } from "@/lib/server/api/handler";
import { writeAudit } from "@/lib/server/audit";
import type { Database } from "@/lib/server/db";
import { channels, contacts, conversations } from "@/lib/server/db/schema";
import { toContactDTO, toConversationDTO } from "@/lib/server/data/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { id: string };

async function load(db: Database, workspaceId: string, id: string) {
  const [row] = await db
    .select({ conv: conversations, channelType: channels.type })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export const GET = workspaceRoute<P>({ role: "viewer", scope: "read" }, async (c) => {
  const row = await load(c.db, c.auth.workspaceId, c.params.id);
  if (!row) throw notFound("Conversation");
  const [contact] = row.conv.contactId
    ? await c.db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, row.conv.contactId), eq(contacts.workspaceId, c.auth.workspaceId)))
        .limit(1)
    : [];
  return { ...toConversationDTO(row.conv, row.channelType), contact: contact ? toContactDTO(contact) : null };
});

const Body = z.object({ archived: z.boolean().optional(), read: z.literal(true).optional(), agentsEnabled: z.boolean().optional() });

export const PATCH = workspaceRoute<P>({ role: "member", scope: "write" }, async (c) => {
  const body = await c.body(Body);
  const row = await load(c.db, c.auth.workspaceId, c.params.id);
  if (!row) throw notFound("Conversation");
  const patch: Partial<typeof conversations.$inferInsert> = {};
  if (body.archived !== undefined) patch.archived = body.archived;
  if (body.read) patch.unreadCount = 0;
  if (body.agentsEnabled !== undefined) patch.agentsEnabled = body.agentsEnabled;
  if (!Object.keys(patch).length) return toConversationDTO(row.conv, row.channelType);
  const [updated] = await c.db
    .update(conversations)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(conversations.id, row.conv.id), eq(conversations.workspaceId, c.auth.workspaceId)))
    .returning();
  if (body.agentsEnabled !== undefined || body.archived !== undefined) {
    await writeAudit(c.db, {
      workspaceId: c.auth.workspaceId,
      actor: c.auth.actor,
      action: "conversation.update",
      targetType: "conversation",
      targetId: row.conv.id,
      before: { archived: row.conv.archived, agentsEnabled: row.conv.agentsEnabled },
      after: { archived: updated.archived, agentsEnabled: updated.agentsEnabled },
    });
  }
  return toConversationDTO(updated, row.channelType);
});
