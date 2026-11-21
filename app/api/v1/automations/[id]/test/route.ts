/**
 * POST /api/v1/automations/:id/test {recordId?, messageId?} → dry run (admin, session only):
 *   { matched, triggerMatched, triggerReason, conditionResults: [{field, op, value, actual, pass}],
 *     actions: [{type, wouldRun, reason?}], sample: {eventType, recordId, messageId} }
 * Evaluates the automation against a record / message of the workspace (or empty data)
 * without writing, sending or queueing anything. Foreign ids → 404.
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { notFound, workspaceRoute } from "@/lib/server/api/handler";
import { automations } from "@/lib/server/db/schema";
import { sessionUser } from "@/lib/server/auth/accounts";
import { dryRunAutomation } from "@/lib/server/automations/dry-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  recordId: z.string().trim().min(1).max(64).optional(),
  messageId: z.string().trim().min(1).max(64).optional(),
});

export const POST = workspaceRoute<{ id: string }>({ role: "admin", rateLimit: { limit: 60, windowSec: 60 } }, async (c) => {
  const body = await c.body(Body);
  const by = sessionUser(c.auth);
  const [automation] = await c.db
    .select()
    .from(automations)
    .where(and(eq(automations.id, c.params.id), eq(automations.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!automation) throw notFound("Automation");
  return dryRunAutomation(c.db, c.auth.workspaceId, automation, body, by.actor);
});
