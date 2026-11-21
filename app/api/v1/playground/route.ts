import { z } from "zod";
import { workspaceRoute } from "@/lib/server/api/handler";
import { dryRunProcess } from "@/lib/server/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  text: z.string().trim().min(1, "Enter a message to test.").max(8000),
  senderName: z.string().trim().max(120).nullish(),
  senderPhone: z.string().trim().max(40).nullish(),
  source: z.enum(["whatsapp", "telegram", "email", "slack", "sms", "api"]).nullish(),
  collectionIds: z.array(z.string().min(1).max(100)).max(20).nullish(),
});

/**
 * POST /api/v1/playground — dry run: the full pipeline (classification,
 * extraction, evidence checks, decisions) without writing anything.
 */
export const POST = workspaceRoute({ role: "member", scope: "write", rateLimit: { limit: 30, windowSec: 60 }, maxBodyBytes: 64 * 1024 }, async (c) => {
  const body = await c.body(Body);
  return dryRunProcess(c.db, c.auth.workspaceId, body);
});
