/**
 * GET /api/v1/conversations?q=&channelId=&archived=1&unread=1&cursor=&limit= (viewer / API read)
 * → Page<ConversationDTO>, most recent activity first.
 */
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { pageLimit, workspaceRoute } from "@/lib/server/api/handler";
import { channels, conversations } from "@/lib/server/db/schema";
import { decodeKeyset, encodeKeyset } from "@/lib/server/automations/paging";
import { toConversationDTO } from "@/lib/server/data/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const activity = sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`;
const activityText = sql<string>`to_char(coalesce(${conversations.lastMessageAt}, ${conversations.createdAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const GET = workspaceRoute({ role: "viewer", scope: "read" }, async (c) => {
  const limit = pageLimit(c.query, 50, 200);
  const q = c.query.get("q")?.trim().slice(0, 100);
  const channelId = c.query.get("channelId");
  const cursor = decodeKeyset(c.query.get("cursor"));
  const where = [eq(conversations.workspaceId, c.auth.workspaceId), eq(conversations.archived, c.query.get("archived") === "1")];
  if (channelId) where.push(eq(conversations.channelId, channelId));
  if (q) where.push(ilike(conversations.title, `%${q.replace(/[%_\\]/g, "\\$&")}%`));
  if (c.query.get("unread") === "1") where.push(sql`${conversations.unreadCount} > 0`);
  if (cursor) where.push(sql`(${activity}, ${conversations.id}) < (${cursor.at}::timestamptz, ${cursor.id})`);
  const rows = await c.db
    .select({ conv: conversations, channelType: channels.type, cursorAt: activityText })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(...where))
    .orderBy(desc(activity), desc(conversations.id))
    .limit(limit + 1);
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return { items: page.map((r) => toConversationDTO(r.conv, r.channelType)), nextCursor: more && last ? encodeKeyset(last.cursorAt, last.conv.id) : null };
});
