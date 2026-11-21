/**
 * POST /api/v1/notifications/read {ids?: string[], all?: true} → { updated: number }
 * Marks the signed-in user's notifications (own + workspace-wide) as read. Session only.
 * Note: workspace-wide notifications (userId null) have one shared read state.
 */
import { z } from "zod";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { workspaceRoute } from "@/lib/server/api/handler";
import { notifications } from "@/lib/server/db/schema";
import { sessionUser } from "@/lib/server/auth/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    ids: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
    all: z.boolean().optional(),
  })
  .refine((b) => b.all === true || (b.ids?.length ?? 0) > 0, "Pass the notification ids, or all: true.");

export const POST = workspaceRoute({ role: "viewer" }, async (c) => {
  const body = await c.body(Body);
  const { userId } = sessionUser(c.auth);
  const n = notifications;
  const rows = await c.db
    .update(n)
    .set({ readAt: new Date() })
    .where(and(eq(n.workspaceId, c.auth.workspaceId), or(eq(n.userId, userId), isNull(n.userId)), isNull(n.readAt), body.all ? undefined : inArray(n.id, [...new Set(body.ids)])))
    .returning({ id: n.id });
  return { updated: rows.length };
});
