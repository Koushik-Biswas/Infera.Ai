/**
 * Workspaces (tenants): creation with sensible defaults, and the "who am I"
 * view used by the console (MeDTO).
 */
import { and, desc, eq } from "drizzle-orm";
import { defaultWorkspaceSettings, type Actor, type MeDTO, type Role } from "@/lib/shared/types";
import type { Database } from "./db";
import { collections, memberships, users, workspaces, type WorkspaceRow } from "./db/schema";
import { newId, slugify } from "./ids";
import { DEFAULT_TEMPLATES, templatePlan } from "./templates";
import { writeAudit } from "./audit";
import { setSessionWorkspace } from "./auth/session";
import { toMeDTO, type WorkspaceSummary } from "./auth/dto";

const SLUG_ATTEMPTS = 8;

/**
 * Creates a workspace owned by `ownerUserId`: unique slug, default settings,
 * owner membership, the default collections (so the pipeline has somewhere to
 * put data from the first message) and an audit entry. Atomic.
 */
export async function createWorkspace(db: Database, input: { name: string; ownerUserId: string; actor: Actor }): Promise<WorkspaceRow> {
  const name = input.name.trim().slice(0, 80) || "My workspace";
  return db.transaction(async (tx) => {
    const id = newId("ws");
    const base = slugify(name);
    let row: WorkspaceRow | undefined;
    for (let attempt = 0; attempt < SLUG_ATTEMPTS && !row; attempt++) {
      // First try the plain slug; on collision add a random suffix. ON CONFLICT keeps the transaction usable.
      const slug = attempt === 0 ? base : `${base.slice(0, 33).replace(/-+$/, "")}-${newId("ws").slice(-6)}`;
      [row] = await tx
        .insert(workspaces)
        .values({ id, name, slug, settings: { ...defaultWorkspaceSettings } })
        .onConflictDoNothing({ target: workspaces.slug })
        .returning();
    }
    if (!row) throw new Error("Could not allocate a unique workspace slug");

    await tx.insert(memberships).values({ workspaceId: id, userId: input.ownerUserId, role: "owner" });

    const plans = DEFAULT_TEMPLATES.map(templatePlan);
    const collectionIds: string[] = [];
    if (plans.length) {
      await tx.insert(collections).values(
        plans.map((p) => {
          const colId = newId("col");
          collectionIds.push(colId);
          return {
            id: colId,
            workspaceId: id,
            name: p.name,
            description: p.description,
            icon: p.icon,
            template: p.template,
            fields: p.fields,
            routing: p.routing,
            matchFields: p.matchFields,
            autopilot: true,
            createdBy: input.ownerUserId,
          };
        }),
      );
    }

    await writeAudit(tx, {
      workspaceId: id,
      actor: input.actor,
      action: "workspace.create",
      targetType: "workspace",
      targetId: id,
      after: { name: row.name, slug: row.slug },
      meta: { defaultCollections: collectionIds },
    });
    return row;
  });
}

type MembershipWithWorkspace = { workspace: WorkspaceRow; role: Role; joinedAt: Date };

async function loadMemberships(db: Database, userId: string): Promise<MembershipWithWorkspace[]> {
  return db
    .select({ workspace: workspaces, role: memberships.role, joinedAt: memberships.createdAt })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(desc(memberships.createdAt));
}

const summaries = (rows: MembershipWithWorkspace[]): WorkspaceSummary[] =>
  rows
    .map((r) => ({ id: r.workspace.id, name: r.workspace.name, slug: r.workspace.slug, role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

/** The user's role in a workspace, or null if they aren't a member. */
export async function membershipRole(db: Database, workspaceId: string, userId: string): Promise<Role | null> {
  const [m] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);
  return m?.role ?? null;
}

/** Workspace the user joined most recently (the default after login), or null. */
export async function latestWorkspaceId(db: Database, userId: string): Promise<string | null> {
  const [m] = await db.select({ id: memberships.workspaceId }).from(memberships).where(eq(memberships.userId, userId)).orderBy(desc(memberships.createdAt)).limit(1);
  return m?.id ?? null;
}

/**
 * MeDTO for a user with `workspaceId` as the active workspace. `workspace` and
 * `role` are null when the id is null or the user is not (any longer) a member.
 */
export async function getMe(db: Database, userId: string, workspaceId: string | null): Promise<MeDTO> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found");
  const rows = await loadMemberships(db, userId);
  const active = workspaceId ? rows.find((r) => r.workspace.id === workspaceId) : undefined;
  return toMeDTO(user, active?.workspace ?? null, active?.role ?? null, summaries(rows));
}

/**
 * MeDTO for a session, repairing the session's active workspace when needed:
 * if it is unset or the membership is gone, the most recently joined workspace
 * becomes active (or none, when the user has no workspaces).
 */
export async function getMeForSession(db: Database, s: { userId: string; sessionId: string; workspaceId: string | null }): Promise<MeDTO> {
  const me = await getMe(db, s.userId, s.workspaceId);
  if (me.workspace) return me;
  const fallback = await latestWorkspaceId(db, s.userId);
  if (fallback !== s.workspaceId) await setSessionWorkspace(db, s.sessionId, fallback);
  return fallback ? getMe(db, s.userId, fallback) : me;
}
