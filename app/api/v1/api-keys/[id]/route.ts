/** DELETE /api/v1/api-keys/:id → ApiKeyDTO (admin). Revokes the key (idempotent); it stops working immediately. */
import { and, eq, isNull } from "drizzle-orm";
import { notFound, workspaceRoute } from "@/lib/server/api/handler";
import { apiKeys } from "@/lib/server/db/schema";
import { writeAudit } from "@/lib/server/audit";
import { toApiKeyDTO } from "@/lib/server/auth/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = workspaceRoute<{ id: string }>({ role: "admin", rateLimit: { limit: 120, windowSec: 60 } }, async (c) => {
  return c.db.transaction(async (tx) => {
    const scope = and(eq(apiKeys.id, c.params.id), eq(apiKeys.workspaceId, c.auth.workspaceId));
    const [revoked] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(scope, isNull(apiKeys.revokedAt)))
      .returning();
    if (!revoked) {
      // Already revoked → same answer again; unknown or another workspace's key → 404.
      const [existing] = await tx.select().from(apiKeys).where(scope).limit(1);
      if (!existing) throw notFound("API key");
      return toApiKeyDTO(existing);
    }
    await writeAudit(tx, {
      workspaceId: c.auth.workspaceId,
      actor: c.auth.actor,
      action: "api_key.revoke",
      targetType: "api_key",
      targetId: revoked.id,
      before: { name: revoked.name, prefix: revoked.prefix, scopes: revoked.scopes },
    });
    return toApiKeyDTO(revoked);
  });
});
