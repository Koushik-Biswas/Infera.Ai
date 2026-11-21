/** GET /api/v1/members → { items: MemberDTO[], nextCursor: null } (viewer, session only). */
import { workspaceRoute } from "@/lib/server/api/handler";
import { listMembers } from "@/lib/server/auth/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute({ role: "viewer" }, async (c) => ({ items: await listMembers(c.db, c.auth.workspaceId), nextCursor: null }));
