/**
 * GET  /api/v1/invitations?status=open|all&cursor=&limit= → Page<InvitationDTO> (admin)
 * POST /api/v1/invitations {email, role} → InvitationDTO with `url` (shown once) (admin)
 */
import { z } from "zod";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { created, decodeCursor, encodeCursor, pageLimit, workspaceRoute } from "@/lib/server/api/handler";
import { ROLES } from "@/lib/shared/types";
import { invitations } from "@/lib/server/db/schema";
import { sessionUser } from "@/lib/server/auth/accounts";
import { toInvitationDTO } from "@/lib/server/auth/dto";
import { createInvitation, inviteUrl } from "@/lib/server/auth/invitations";
import { emailField } from "@/lib/server/auth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cursor timestamps are JS Dates (ms); order and compare at ms precision so pages never skip rows. */
const createdMs = sql<Date>`date_trunc('milliseconds', ${invitations.createdAt})`;

export const GET = workspaceRoute({ role: "admin" }, async (c) => {
  const limit = pageLimit(c.query, 50, 200);
  const cursor = decodeCursor(c.query.get("cursor"));
  const openOnly = c.query.get("status") === "open";
  const rows = await c.db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, c.auth.workspaceId),
        openOnly ? and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())) : undefined,
        cursor ? sql`(${createdMs}, ${invitations.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id})` : undefined,
      ),
    )
    .orderBy(desc(createdMs), desc(invitations.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page.map((r) => toInvitationDTO(r)), nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
});

const Body = z.object({ email: emailField, role: z.enum(ROLES).default("member") });

export const POST = workspaceRoute({ role: "admin", rateLimit: { limit: 60, windowSec: 3600 } }, async (c) => {
  const body = await c.body(Body);
  const by = sessionUser(c.auth);
  const { row, token } = await createInvitation(c.db, {
    workspaceId: c.auth.workspaceId,
    email: body.email,
    role: body.role,
    inviter: { userId: by.userId, role: c.auth.role, actor: by.actor },
  });
  return created(toInvitationDTO(row, inviteUrl(token)));
});
