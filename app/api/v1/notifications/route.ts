/**
 * GET /api/v1/notifications?unread=1&cursor=&limit= → Page<NotificationDTO> & { unread: number }
 * The signed-in user's notifications: rows addressed to them plus workspace-wide ones
 * (userId null), newest first. `unread` counts all of the user's unread notifications.
 * Session only (viewer+); API keys are rejected.
 */
import { and, count, desc, eq, isNull, or } from "drizzle-orm";
import { badRequest, pageLimit, workspaceRoute } from "@/lib/server/api/handler";
import { notifications } from "@/lib/server/db/schema";
import { sessionUser } from "@/lib/server/auth/accounts";
import { afterKeyset, decodeKeyset, exactTimestamp, pageOf } from "@/lib/server/automations/paging";
import type { NotificationDTO } from "@/lib/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute({ role: "viewer" }, async (c) => {
  const { userId } = sessionUser(c.auth);
  const limit = pageLimit(c.query, 30, 100);
  const rawCursor = c.query.get("cursor");
  const cursor = decodeKeyset(rawCursor);
  if (rawCursor && !cursor) throw badRequest("Invalid cursor.");
  const unreadOnly = c.query.get("unread") === "1" || c.query.get("unread") === "true";

  const n = notifications;
  const mine = and(eq(n.workspaceId, c.auth.workspaceId), or(eq(n.userId, userId), isNull(n.userId)));
  const [rows, [{ unread }]] = await Promise.all([
    c.db
      .select({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.readAt, createdAt: n.createdAt, cursorAt: exactTimestamp(n.createdAt) })
      .from(n)
      .where(and(mine, unreadOnly ? isNull(n.readAt) : undefined, cursor ? afterKeyset(n.createdAt, n.id, cursor) : undefined))
      .orderBy(desc(n.createdAt), desc(n.id))
      .limit(limit + 1),
    c.db
      .select({ unread: count() })
      .from(n)
      .where(and(mine, isNull(n.readAt))),
  ]);
  const page = pageOf(rows, limit);
  const items: NotificationDTO[] = page.rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link ?? null,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
  return { items, nextCursor: page.nextCursor, unread };
});
