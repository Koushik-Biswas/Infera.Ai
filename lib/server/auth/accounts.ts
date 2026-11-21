/**
 * User accounts: race-safe creation (unique email) and small helpers shared by
 * the identity routes.
 */
import type { Actor } from "@/lib/shared/types";
import type { Database } from "../db";
import { users, type UserRow } from "../db/schema";
import { newId } from "../ids";
import { forbidden, type AuthContext } from "../api/handler";

/** Deliberately vague: doesn't confirm more than the 409 status already does. */
export const DUPLICATE_EMAIL_MESSAGE = "We couldn't create an account with this email. If you already have one, sign in instead.";

/**
 * Inserts a user. Returns null when the email is already registered
 * (ON CONFLICT, so concurrent sign-ups with the same email can't both win).
 * `email` must already be lower-cased and validated; `passwordHash` from hashPassword().
 */
export async function insertUser(db: Database, input: { name: string; email: string; passwordHash: string }): Promise<UserRow | null> {
  const now = new Date();
  const [row] = await db
    .insert(users)
    .values({ id: newId("usr"), email: input.email, name: input.name, passwordHash: input.passwordHash, lastLoginAt: now })
    .onConflictDoNothing({ target: users.email })
    .returning();
  return row ?? null;
}

export const userActor = (u: Pick<UserRow, "id" | "name" | "email">): Actor => ({ type: "user", id: u.id, label: u.name || u.email });

/** For session-only routes: the signed-in user id behind an AuthContext. */
export function sessionUser(auth: AuthContext): { userId: string; actor: Actor } {
  if (auth.kind !== "session" || !auth.userId) throw forbidden("This endpoint can't be used with an API key.");
  return { userId: auth.userId, actor: auth.actor };
}
