/**
 * POST /api/v1/review/:id/approve {values?: Record<string, CellValue>, note?} → { item: ReviewItemDTO, operation: RecordOperation | null }
 * (member, API scope "write"). Applies the proposed record operation — `values` are the
 * reviewer's corrections (stored as human input). `operation` is null only for items that
 * carry no proposal (acknowledged). Errors: 404 (unknown/foreign), 409 `already_resolved`,
 * 409 `conflict` (collection archived / record deleted), 422 (missing required fields).
 */
import { z } from "zod";
import { workspaceRoute } from "@/lib/server/api/handler";
import { cleanText } from "@/lib/server/http";
import { kickSoon } from "@/lib/server/jobs/kick";
import { toReviewItemDTO } from "@/lib/server/automations/dto";
import { resolveReviewItem } from "@/lib/server/automations/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cell = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

const Body = z.object({
  values: z
    .record(z.string().trim().min(1).max(40), cell)
    .refine((v) => Object.keys(v).length <= 60, "Too many values.")
    .optional(),
  note: z
    .string()
    .max(4000)
    .transform((v) => cleanText(v, 1000, { multiline: true }))
    .optional(),
});

export const POST = workspaceRoute<{ id: string }>({ role: "member", scope: "write" }, async (c) => {
  const body = await c.body(Body);
  const { item, operation } = await resolveReviewItem(c.db, {
    workspaceId: c.auth.workspaceId,
    reviewItemId: c.params.id,
    decision: "approve",
    actor: c.auth.actor,
    resolvedBy: c.auth.userId ?? c.auth.apiKeyId,
    values: body.values,
    note: body.note,
  });
  kickSoon();
  return { item: toReviewItemDTO(item), operation };
});
