/**
 * GET  /api/v1/api-keys → { items: ApiKeyDTO[], nextCursor: null }          (admin, session only)
 * POST /api/v1/api-keys {name, scopes, expiresInDays?} → ApiKeyDTO + `key` once (201)
 * Keys are stored as SHA-256 only; hashes are never returned.
 */
import { z } from "zod";
import { and, count, desc, eq, gt, isNull, or } from "drizzle-orm";
import { conflict, created, workspaceRoute } from "@/lib/server/api/handler";
import { API_SCOPES } from "@/lib/shared/types";
import { apiKeys } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { writeAudit } from "@/lib/server/audit";
import { cleanText } from "@/lib/server/http";
import { sessionUser } from "@/lib/server/auth/accounts";
import { MAX_ACTIVE_API_KEYS, generateApiKey } from "@/lib/server/auth/api-keys";
import { toApiKeyDTO } from "@/lib/server/auth/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revoked/expired keys are kept for history; the list shows the most recent ones. */
const LIST_LIMIT = 500;

export const GET = workspaceRoute({ role: "admin" }, async (c) => {
  const rows = await c.db.select().from(apiKeys).where(eq(apiKeys.workspaceId, c.auth.workspaceId)).orderBy(desc(apiKeys.createdAt), desc(apiKeys.id)).limit(LIST_LIMIT);
  return { items: rows.map((r) => toApiKeyDTO(r)), nextCursor: null };
});

const Body = z.object({
  name: z
    .string()
    .max(1000)
    .transform((v) => cleanText(v, 80))
    .pipe(z.string().min(1, "Give the key a name.")),
  scopes: z
    .array(z.enum(API_SCOPES))
    .min(1, "Pick at least one scope.")
    .max(API_SCOPES.length * 2)
    // Deduplicate and keep the canonical order.
    .transform((s) => API_SCOPES.filter((x) => s.includes(x))),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

export const POST = workspaceRoute({ role: "admin", rateLimit: { limit: 30, windowSec: 3600 } }, async (c) => {
  const body = await c.body(Body);
  const by = sessionUser(c.auth);
  const now = new Date();
  const expiresAt = body.expiresInDays ? new Date(now.getTime() + body.expiresInDays * 86_400_000) : null;
  const { key, prefix, hash } = generateApiKey();

  const row = await c.db.transaction(async (tx) => {
    const [{ active }] = await tx
      .select({ active: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.workspaceId, c.auth.workspaceId), isNull(apiKeys.revokedAt), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now))));
    if (active >= MAX_ACTIVE_API_KEYS) throw conflict(`A workspace can have at most ${MAX_ACTIVE_API_KEYS} active API keys. Revoke unused keys first.`);
    const [row] = await tx
      .insert(apiKeys)
      .values({ id: newId("key"), workspaceId: c.auth.workspaceId, name: body.name, prefix, keyHash: hash, scopes: body.scopes, createdBy: by.userId, expiresAt })
      .returning();
    await writeAudit(tx, {
      workspaceId: c.auth.workspaceId,
      actor: by.actor,
      action: "api_key.create",
      targetType: "api_key",
      targetId: row.id,
      after: { name: row.name, prefix: row.prefix, scopes: row.scopes, expiresAt: row.expiresAt?.toISOString() ?? null },
    });
    return row;
  });
  return created(toApiKeyDTO(row, key));
});
