/**
 * POST /api/v1/assistant/ask { question, threadId? } (member / API write)
 * → AssistantAnswerDTO & { threadId } — answers from synced chats and collections, with cited messages.
 */
import { z } from "zod";
import { workspaceRoute } from "@/lib/server/api/handler";
import { ask } from "@/lib/server/data/assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ question: z.string().trim().min(2, "Ask a question.").max(1000), threadId: z.string().max(64).nullish() });

export const POST = workspaceRoute({ role: "member", scope: "write", rateLimit: { limit: 30, windowSec: 60 } }, async (c) => {
  const body = await c.body(Body);
  return ask(c.db, { workspaceId: c.auth.workspaceId, userId: c.auth.userId, question: body.question, threadId: body.threadId ?? null });
});
