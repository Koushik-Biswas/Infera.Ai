/**
 * LinkedIn (Unipile) login.
 *
 *   POST /api/v1/channels/:id/linkedin (admin) → { url } — Unipile's hosted LinkedIn login (open it).
 *   GET  /api/v1/channels/:id/linkedin?complete=1 (admin, browser) — Unipile's success redirect:
 *        links the new account, registers the webhook, imports recent conversations, returns to Channels.
 */
import { after, NextResponse } from "next/server";
import { notFound, unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { writeAudit } from "@/lib/server/audit";
import { getDb } from "@/lib/server/db";
import { appUrl, isTest } from "@/lib/server/env";
import { log } from "@/lib/server/http";
import { getWorkspaceChannel } from "@/lib/server/channels/registry";
import { completeLinkedIn, unipileCreds } from "@/lib/server/channels/linkedin";
import { unipileHostedLink } from "@/lib/server/channels/unipile";
import { updateConnectorSession } from "@/lib/server/sync/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { id: string };

export const POST = workspaceRoute<P>({ role: "admin", rateLimit: { limit: 10, windowSec: 300 } }, async (c) => {
  const channel = await getWorkspaceChannel(c.db, c.auth.workspaceId, c.params.id);
  if (!channel) throw notFound("Channel");
  const creds = channel.type === "linkedin" ? unipileCreds(channel) : null;
  if (!creds) throw unprocessable("This isn't a LinkedIn channel with Unipile credentials.");
  const base = `${appUrl()}/api/v1/channels/${channel.id}/linkedin`;
  const link = await unipileHostedLink(creds, { name: channel.id, successUrl: `${base}?complete=1`, failureUrl: `${appUrl()}/console/channels?linkedin=failed` });
  if ("error" in link) throw unprocessable(link.error);
  await updateConnectorSession(c.db, channel, { state: "pairing", lastError: null });
  await writeAudit(c.db, { workspaceId: c.auth.workspaceId, actor: c.auth.actor, action: "channel.linkedin_link", targetType: "channel", targetId: channel.id });
  return { url: link.url };
});

export const GET = workspaceRoute<P>({ role: "admin" }, async (c) => {
  const channel = await getWorkspaceChannel(c.db, c.auth.workspaceId, c.params.id);
  if (!channel || channel.type !== "linkedin") throw notFound("Channel");
  if (c.query.get("complete") !== "1") throw unprocessable("Nothing to do.");
  // Unipile may still be finalising the account: complete in the background.
  if (!isTest)
    after(async () => {
      try {
        await completeLinkedIn(await getDb(), channel);
      } catch (e) {
        log("error", "linkedin_complete_failed", { channelId: channel.id, message: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
      }
    });
  await updateConnectorSession(c.db, channel, { state: "syncing", progress: { phase: "history", total: null, done: 0, startedAt: new Date().toISOString(), finishedAt: null, message: "Linking your LinkedIn account…" } });
  return NextResponse.redirect(`${appUrl()}/console/channels?linkedin=connected`, 303);
});
