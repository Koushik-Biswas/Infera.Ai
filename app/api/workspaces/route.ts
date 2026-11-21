/**
 * POST /api/workspaces {name} → WorkspaceDTO (201). The creator becomes owner,
 * default collections are created and the session switches to it.
 */
import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import { conflict, created, userRoute } from "@/lib/server/api/handler";
import { memberships } from "@/lib/server/db/schema";
import { setSessionWorkspace } from "@/lib/server/auth/session";
import { userActor } from "@/lib/server/auth/accounts";
import { toWorkspaceDTO } from "@/lib/server/auth/dto";
import { workspaceNameField } from "@/lib/server/auth/validation";
import { createWorkspace } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Abuse guard: workspaces one user may own. */
const MAX_OWNED_WORKSPACES = 50;

const Body = z.object({ name: workspaceNameField });

export const POST = userRoute({ rateLimit: { limit: 10, windowSec: 3600 } }, async (c) => {
  const { name } = await c.body(Body);
  const [{ owned }] = await c.db
    .select({ owned: count() })
    .from(memberships)
    .where(and(eq(memberships.userId, c.user.id), eq(memberships.role, "owner")));
  if (owned >= MAX_OWNED_WORKSPACES) throw conflict(`You can own at most ${MAX_OWNED_WORKSPACES} workspaces.`);

  const ws = await createWorkspace(c.db, { name, ownerUserId: c.user.id, actor: userActor(c.user) });
  await setSessionWorkspace(c.db, c.sessionId, ws.id);
  return created(toWorkspaceDTO(ws));
});
