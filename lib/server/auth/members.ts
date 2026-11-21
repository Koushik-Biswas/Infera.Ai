/**
 * Membership management: role changes and removals with the authorisation
 * rules of the product:
 *
 *  - Owners can do anything (grant/revoke owner, change admins).
 *  - Admins can only move members/viewers between "member" and "viewer", and
 *    remove members/viewers.
 *  - Anyone can remove themself (leave).
 *  - A workspace always keeps at least one owner (409 `last_owner`).
 *
 * Role checks run inside a transaction that locks the affected membership rows
 * (target, actor and all owners), so concurrent demotions can't leave a
 * workspace without an owner.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { roleAtLeast, type Actor, type MemberDTO, type Role } from "@/lib/shared/types";
import type { Database } from "../db";
import { memberships, sessions, users } from "../db/schema";
import { writeAudit } from "../audit";
import { ApiError, forbidden, notFound } from "../api/handler";
import { toMemberDTO } from "./dto";

type MemberActor = { userId: string; actor: Actor };

const LAST_OWNER_ROLE = "The workspace needs at least one owner. Make someone else an owner first.";
const LAST_OWNER_LEAVE = "The last owner can't leave the workspace. Make someone else an owner first, or delete the workspace.";

/** May a user with `actor` role change a `target`-role member to `next`? */
export function canChangeRole(actor: Role, target: Role, next: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return (target === "member" || target === "viewer") && (next === "member" || next === "viewer");
  return false;
}

/** May a user with `actor` role remove a `target`-role member? (Leaving is always allowed.) */
export function canRemoveMember(actor: Role, target: Role, self: boolean): boolean {
  if (self) return true;
  if (actor === "owner") return true;
  if (actor === "admin") return target === "member" || target === "viewer";
  return false;
}

/** Locks and returns the memberships relevant to a change: target, actor and all owners. */
async function lockRelevant(tx: Database, workspaceId: string, userIds: string[]) {
  return tx
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), or(inArray(memberships.userId, userIds), eq(memberships.role, "owner"))))
    .for("update");
}

export async function listMembers(db: Database, workspaceId: string): Promise<MemberDTO[]> {
  const rows = await db
    .select({ userId: memberships.userId, role: memberships.role, createdAt: memberships.createdAt, email: users.email, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId))
    .orderBy(memberships.createdAt, memberships.userId);
  return rows.map(toMemberDTO);
}

async function memberDTO(db: Database, workspaceId: string, userId: string): Promise<MemberDTO> {
  const [row] = await db
    .select({ userId: memberships.userId, role: memberships.role, createdAt: memberships.createdAt, email: users.email, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Member");
  return toMemberDTO(row);
}

export async function changeMemberRole(db: Database, input: { workspaceId: string; by: MemberActor; targetUserId: string; role: Role }): Promise<MemberDTO> {
  const { workspaceId, by, targetUserId, role: next } = input;
  return db.transaction(async (tx) => {
    const rows = await lockRelevant(tx, workspaceId, [targetUserId, by.userId]);
    const target = rows.find((r) => r.userId === targetUserId);
    if (!target) throw notFound("Member");
    const actorRole = rows.find((r) => r.userId === by.userId)?.role;
    if (!actorRole || !roleAtLeast(actorRole, "admin")) throw forbidden();
    if (target.role === next) return memberDTO(tx, workspaceId, targetUserId);
    if (!canChangeRole(actorRole, target.role, next)) {
      throw forbidden(actorRole === "admin" ? "Admins can only switch members between Member and Viewer. Ask an owner." : undefined);
    }
    const owners = rows.filter((r) => r.role === "owner").length;
    if (target.role === "owner" && next !== "owner" && owners <= 1) throw new ApiError(409, "last_owner", LAST_OWNER_ROLE);

    await tx.update(memberships).set({ role: next }).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, targetUserId)));
    await writeAudit(tx, {
      workspaceId,
      actor: by.actor,
      action: "member.role_change",
      targetType: "member",
      targetId: targetUserId,
      before: { role: target.role },
      after: { role: next },
    });
    return memberDTO(tx, workspaceId, targetUserId);
  });
}

/**
 * Removes a member (or lets a member leave). Their sessions that point at this
 * workspace are detached so they can't keep acting in it.
 */
export async function removeMember(db: Database, input: { workspaceId: string; by: MemberActor; targetUserId: string }): Promise<void> {
  const { workspaceId, by, targetUserId } = input;
  const self = by.userId === targetUserId;
  await db.transaction(async (tx) => {
    const rows = await lockRelevant(tx, workspaceId, [targetUserId, by.userId]);
    const target = rows.find((r) => r.userId === targetUserId);
    const actorRole = rows.find((r) => r.userId === by.userId)?.role;
    if (!actorRole) throw forbidden();
    // Non-admins must not learn whether other user ids are members.
    if (!self && !roleAtLeast(actorRole, "admin")) throw forbidden();
    if (!target) throw notFound("Member");
    if (!canRemoveMember(actorRole, target.role, self)) throw forbidden("Only owners can remove admins or owners.");
    const owners = rows.filter((r) => r.role === "owner").length;
    if (target.role === "owner" && owners <= 1) throw new ApiError(409, "last_owner", self ? LAST_OWNER_LEAVE : LAST_OWNER_ROLE);

    await tx.delete(memberships).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, targetUserId)));
    await tx
      .update(sessions)
      .set({ workspaceId: null })
      .where(and(eq(sessions.userId, targetUserId), eq(sessions.workspaceId, workspaceId)));
    await writeAudit(tx, {
      workspaceId,
      actor: by.actor,
      action: self ? "member.leave" : "member.remove",
      targetType: "member",
      targetId: targetUserId,
      before: { role: target.role },
    });
  });
}
