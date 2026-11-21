/**
 * POST /api/v1/collection-plans { prompt } (member / API write)
 * → { plan: CollectionPlanDTO, since: ISO | null, rangeLabel: string | null, engine: "ai" | "rules" }
 *
 * "Find all leads from my chats for the last month" → a Leads plan plus `since` = 30 days ago.
 * Nothing is created: the console shows the plan to accept (POST /api/v1/collections with
 * the plan and `backfillSince: since`), edit or reject.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { workspaceRoute } from "@/lib/server/api/handler";
import { workspaces } from "@/lib/server/db/schema";
import { settingsOf } from "@/lib/server/pipeline/run";
import { planFromPrompt } from "@/lib/server/data/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ prompt: z.string().trim().min(3, "Describe what you want to track.").max(2000) });

export const POST = workspaceRoute({ role: "member", scope: "write", rateLimit: { limit: 20, windowSec: 60 } }, async (c) => {
  const body = await c.body(Body);
  const [ws] = await c.db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, c.auth.workspaceId)).limit(1);
  return planFromPrompt({ prompt: body.prompt, workspaceId: c.auth.workspaceId, aiMode: settingsOf(ws?.settings).aiMode });
});
