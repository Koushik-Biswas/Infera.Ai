/**
 * GET /api/v1/channels/:id/google (admin, browser navigation) → 302 to Google's consent screen
 * for a Gmail mailbox channel. Google sends the user back to /api/oauth/google/callback.
 */
import { NextResponse } from "next/server";
import { ApiError, notFound, unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { getWorkspaceChannel } from "@/lib/server/channels/registry";
import { googleAuthUrl, googleConfigured, signState } from "@/lib/server/sync/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute<{ id: string }>({ role: "admin", rateLimit: { limit: 20, windowSec: 300 } }, async (c) => {
  if (!googleConfigured()) throw new ApiError(503, "google_not_configured", "Sign in with Google isn't set up on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Use an app password instead.");
  const channel = await getWorkspaceChannel(c.db, c.auth.workspaceId, c.params.id);
  if (!channel) throw notFound("Channel");
  if (channel.type !== "email_imap") throw unprocessable("Google sign-in is for mailbox channels.");
  const hint = typeof channel.config?.address === "string" ? channel.config.address : null;
  return NextResponse.redirect(googleAuthUrl(signState({ channelId: channel.id, userId: c.auth.userId! }), hint), 302);
});
