/**
 * Append-only audit log (spec step 10). Every mutation of tenant data writes
 * one entry: who did it, what changed (before/after), and the source
 * references (event id, message ids) that justify it.
 *
 * Never put secrets or passwords in `before`/`after`/`meta`.
 */
import type { Actor } from "@/lib/shared/types";
import type { Database } from "./db";
import { auditLog } from "./db/schema";

export type AuditInput = {
  workspaceId: string | null;
  actor: Actor;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
};

export async function writeAudit(db: Database, e: AuditInput): Promise<void> {
  await db.insert(auditLog).values({
    workspaceId: e.workspaceId,
    actorType: e.actor.type,
    actorId: e.actor.id,
    actorLabel: e.actor.label ?? null,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    meta: e.meta ?? null,
  });
}

export const SYSTEM_ACTOR: Actor = { type: "system", id: null, label: "Infera" };
export const PIPELINE_ACTOR: Actor = { type: "pipeline", id: null, label: "Infera AI pipeline" };
