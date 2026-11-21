/** GET /api/v1/assistant/threads (member, session) → { items: { id, title, updatedAt }[] } — your recent conversations with the assistant. */
import { and, desc, eq } from "drizzle-orm";
import { workspaceRoute } from "@/lib/server/api/handler";
import { assistantThreads } from "@/lib/server/db/schema";
import { openText } from "@/lib/server/data/sealed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute({ role: "member" }, async (c) => {
  const rows = await c.db
    .select({ id: assistantThreads.id, title: assistantThreads.title, updatedAt: assistantThreads.updatedAt })
    .from(assistantThreads)
    .where(and(eq(assistantThreads.workspaceId, c.auth.workspaceId), eq(assistantThreads.userId, c.auth.userId!)))
    .orderBy(desc(assistantThreads.updatedAt))
    .limit(30);
  return { items: rows.map((r) => ({ id: r.id, title: openText(r.title), updatedAt: r.updatedAt.toISOString() })) };
});
