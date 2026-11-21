/**
 * Workspace invitations. The invite link carries a random token; only its
 * SHA-256 is stored, so a database leak can't be turned into working links.
 */
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { roleAtLeast, type Actor, type Role } from "@/lib/shared/types";
import type { Database } from "../db";
import { invitations, memberships, users, workspaces, type WorkspaceRow } from "../db/schema";
import { newToken, sha256Hex } from "../crypto";
import { appUrl } from "../env";
import { newId } from "../ids";
import { writeAudit } from "../audit";
import { ApiError, conflict, forbidden } from "../api/handler";

export type InvitationRow = typeof invitations.$inferSelect;

export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
/** Open invitations allowed per workspace (abuse guard). */
export const MAX_OPEN_INVITES = 200;

export const inviteUrl = (token: string) => `${appUrl()}/invite/${encodeURIComponent(token)}`;

/** Shape check before hashing: tokens are base64url, 43 chars for 32 bytes. */
export const plausibleToken = (token: string) => /^[A-Za-z0-9_-]{16,128}$/.test(token);

export async function createInvitation(
  db: Database,
  input: { workspaceId: string; email: string; role: Role; inviter: { userId: string; role: Role; actor: Actor } },
): Promise<{ row: InvitationRow; token: string }> {
  const { workspaceId, email, role, inviter } = input;
  // Nobody can invite above their own role (so only owners invite owners).
  if (!roleAtLeast(inviter.role, role)) throw forbidden(role === "owner" ? "Only owners can invite owners." : "You can't invite someone with a higher role than yours.");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.workspaceId, workspaceId), eq(users.email, email)))
      .limit(1);
    if (existing) throw conflict("This person is already a member of the workspace.");

    // Re-inviting replaces the previous open invite (its link stops working).
    const replaced = await tx
      .delete(invitations)
      .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.email, email), isNull(invitations.acceptedAt)))
      .returning({ id: invitations.id });

    const [{ open }] = await tx
      .select({ open: count() })
      .from(invitations)
      .where(and(eq(invitations.workspaceId, workspaceId), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())));
    if (open >= MAX_OPEN_INVITES) throw conflict(`A workspace can have at most ${MAX_OPEN_INVITES} open invitations. Revoke some first.`);

    const token = newToken(32);
    const [row] = await tx
      .insert(invitations)
      .values({
        id: newId("inv"),
        workspaceId,
        email,
        role,
        tokenHash: sha256Hex(token),
        invitedBy: inviter.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning();

    await writeAudit(tx, {
      workspaceId,
      actor: inviter.actor,
      action: "invitation.create",
      targetType: "invitation",
      targetId: row.id,
      after: { email, role, expiresAt: row.expiresAt.toISOString() },
      meta: replaced.length ? { replaced: replaced.map((r) => r.id) } : undefined,
    });
    return { row, token };
  });
}

/** Looks an invitation up by its raw token (null for unknown/malformed tokens). */
export async function findInvitationByToken(db: Database, token: string): Promise<{ invitation: InvitationRow; workspace: WorkspaceRow } | null> {
  if (!plausibleToken(token)) return null;
  const [row] = await db
    .select({ invitation: invitations, workspace: workspaces })
    .from(invitations)
    .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
    .where(eq(invitations.tokenHash, sha256Hex(token)))
    .limit(1);
  return row ?? null;
}

export const invitationExpired = (i: InvitationRow, now = new Date()) => i.expiresAt.getTime() <= now.getTime();

/** 410 for invitations that can no longer be used. */
export function assertInvitationUsable(i: InvitationRow) {
  if (i.acceptedAt) throw new ApiError(410, "invitation_used", "This invitation has already been used.");
  if (invitationExpired(i)) throw new ApiError(410, "invitation_expired", "This invitation has expired. Ask for a new one.");
}

/**
 * Accepts an invitation for `userId` (call inside a transaction together with
 * any account creation). Marking it accepted is a single conditional UPDATE,
 * so two concurrent accepts can't both succeed. Membership is idempotent: an
 * existing member keeps their current role.
 */
export async function acceptInvitation(tx: Database, input: { invitation: InvitationRow; userId: string; actor: Actor }): Promise<void> {
  const { invitation, userId, actor } = input;
  const now = new Date();
  const [marked] = await tx
    .update(invitations)
    .set({ acceptedAt: now })
    .where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt), gt(invitations.expiresAt, now)))
    .returning({ id: invitations.id });
  if (!marked) throw new ApiError(410, "invitation_used", "This invitation is no longer valid.");

  const inserted = await tx
    .insert(memberships)
    .values({ workspaceId: invitation.workspaceId, userId, role: invitation.role })
    .onConflictDoNothing()
    .returning({ userId: memberships.userId });

  await writeAudit(tx, {
    workspaceId: invitation.workspaceId,
    actor,
    action: "invitation.accept",
    targetType: "member",
    targetId: userId,
    after: inserted.length ? { role: invitation.role } : undefined,
    meta: { invitationId: invitation.id, alreadyMember: inserted.length === 0 },
  });
}
