/**
 * Single-user auto sign-in: no login or signup screens. Opening the app signs the
 * browser in as the workspace owner automatically.
 *
 *   INFERA_AUTO_LOGIN=1   on      (required in production — explicit opt-in)
 *   INFERA_AUTO_LOGIN=0   off     (normal accounts and login)
 *   unset                 on in development, off in production
 *   INFERA_AUTO_LOGIN_EMAIL  which account to use (default: the first workspace owner,
 *                            or a new "owner@infera.local" account on an empty database)
 *
 * Anyone who can reach the server is signed in as that owner, so only enable it in
 * production behind a private network, VPN or an authenticating reverse proxy.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db";
import { memberships, users, type UserRow } from "../db/schema";
import { autoLoginEnabled } from "@/lib/auto-login-flag";
import { newId } from "../ids";
import { userActor } from "./accounts";
import { createWorkspace, latestWorkspaceId } from "../workspaces";

export { autoLoginEnabled };

const DEFAULT_EMAIL = "owner@infera.local";
/** Not a valid scrypt hash: password sign-in is impossible for the auto-created account. */
const NO_PASSWORD = "auto-login$no-password";

/** The owner account auto sign-in uses (created on first use), with a workspace. */
export async function ensureAutoLoginUser(db: Database): Promise<{ user: UserRow; workspaceId: string }> {
  return db.transaction(async (tx) => {
    // One instance at a time creates the account (two first visits must not create two owners).
    await tx.execute(sql`select pg_advisory_xact_lock(72017002)`);
    const wanted = process.env.INFERA_AUTO_LOGIN_EMAIL?.trim().toLowerCase() || null;
    let user: UserRow | null = null;
    if (wanted) {
      [user] = await tx.select().from(users).where(eq(users.email, wanted)).limit(1);
    } else {
      const [owner] = await tx
        .select({ user: users })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.role, "owner"))
        .orderBy(asc(memberships.createdAt))
        .limit(1);
      user = owner?.user ?? (await tx.select().from(users).orderBy(asc(users.createdAt)).limit(1))[0] ?? null;
    }
    if (!user) {
      [user] = await tx
        .insert(users)
        .values({ id: newId("usr"), email: wanted ?? DEFAULT_EMAIL, name: "Owner", passwordHash: NO_PASSWORD })
        .returning();
    }
    let workspaceId = await latestWorkspaceId(tx, user.id);
    if (!workspaceId) {
      const ws = await createWorkspace(tx, { name: "My workspace", ownerUserId: user.id, actor: userActor(user) });
      workspaceId = ws.id;
    }
    return { user, workspaceId };
  });
}
