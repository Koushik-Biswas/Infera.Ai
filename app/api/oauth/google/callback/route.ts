/**
 * GET /api/oauth/google/callback?code&state — Google's redirect after consent.
 * Verifies the signed state (channel + the same signed-in admin), stores the refresh token in the
 * channel's encrypted auth blob, starts the mailbox connection and returns to Channels.
 */
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { channels, memberships } from "@/lib/server/db/schema";
import { resolveSession } from "@/lib/server/auth/session";
import { writeAudit } from "@/lib/server/audit";
import { log } from "@/lib/server/http";
import { appUrl } from "@/lib/server/env";
import { ensureSession, sendConnectionCommand, setAuth } from "@/lib/server/sync/session";
import { exchangeGoogleCode, verifyState } from "@/lib/server/sync/google-oauth";
import { roleAtLeast } from "@/lib/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (params: Record<string, string>) => NextResponse.redirect(`${appUrl()}/console/channels?${new URLSearchParams(params)}`, 303);

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return back({ google: "cancelled" });
  const state = verifyState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!state || !code || code.length > 2000) return back({ google: "invalid" });

  const db = await getDb();
  const session = await resolveSession(db, req);
  if (!session || session.user.id !== state.userId) return NextResponse.redirect(`${appUrl()}/login?next=${encodeURIComponent("/console/channels")}`, 303);
  const [row] = await db
    .select({ channel: channels, role: memberships.role })
    .from(channels)
    .innerJoin(memberships, and(eq(memberships.workspaceId, channels.workspaceId), eq(memberships.userId, session.user.id)))
    .where(eq(channels.id, state.channelId))
    .limit(1);
  if (!row || row.channel.type !== "email_imap" || !roleAtLeast(row.role, "admin")) return back({ google: "invalid" });

  try {
    const auth = await exchangeGoogleCode(code);
    const channel = row.channel;
    await ensureSession(db, channel);
    await setAuth(db, channel.id, auth);
    await db
      .update(channels)
      .set({ config: { ...channel.config, provider: "gmail", address: auth.email, auth: "google" }, updatedAt: new Date() })
      .where(eq(channels.id, channel.id));
    await writeAudit(db, { workspaceId: channel.workspaceId, actor: { type: "user", id: session.user.id, label: session.user.name || session.user.email }, action: "channel.google_connected", targetType: "channel", targetId: channel.id });
    await sendConnectionCommand(db, channel, "connect");
    return back({ google: "connected" });
  } catch (e) {
    log("warn", "google_oauth_failed", { message: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    return back({ google: "failed" });
  }
}
