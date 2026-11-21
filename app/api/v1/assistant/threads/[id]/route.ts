/** GET /api/v1/assistant/threads/:id (member, session; own threads only) → { id, title, messages: { role, text, at, data? }[] } */
import { and, eq } from "drizzle-orm";
import { notFound, workspaceRoute } from "@/lib/server/api/handler";
import { assistantThreads } from "@/lib/server/db/schema";
import { openText } from "@/lib/server/data/sealed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute<{ id: string }>({ role: "member" }, async (c) => {
  const [t] = await c.db
    .select()
    .from(assistantThreads)
    .where(and(eq(assistantThreads.id, c.params.id), eq(assistantThreads.workspaceId, c.auth.workspaceId), eq(assistantThreads.userId, c.auth.userId!)))
    .limit(1);
  if (!t) throw notFound("Thread");
  return { id: t.id, title: openText(t.title), messages: t.messages.map((m) => ({ ...m, text: openText(m.text) })) };
});
