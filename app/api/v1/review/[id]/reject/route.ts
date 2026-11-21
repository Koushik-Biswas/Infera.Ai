/**
 * POST /api/v1/review/:id/reject {note?} → { item: ReviewItemDTO }   (member, API scope "write")
 * Nothing is written to records. Errors: 404 (unknown/foreign), 409 `already_resolved`.
 */
import { z } from "zod";
import { workspaceRoute } from "@/lib/server/api/handler";
import { cleanText } from "@/lib/server/http";
import { kickSoon } from "@/lib/server/jobs/kick";
import { toReviewItemDTO } from "@/lib/server/automations/dto";
import { resolveReviewItem } from "@/lib/server/automations/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  note: z
    .string()
    .max(4000)
    .transform((v) => cleanText(v, 1000, { multiline: true }))
    .optional(),
});

export const POST = workspaceRoute<{ id: string }>({ role: "member", scope: "write" }, async (c) => {
  const body = await c.body(Body);
  const { item } = await resolveReviewItem(c.db, {
    workspaceId: c.auth.workspaceId,
    reviewItemId: c.params.id,
    decision: "reject",
    actor: c.auth.actor,
    resolvedBy: c.auth.userId ?? c.auth.apiKeyId,
    note: body.note,
  });
  kickSoon();
  return { item: toReviewItemDTO(item) };
});
