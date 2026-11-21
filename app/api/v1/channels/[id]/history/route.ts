/**
 * POST /api/v1/channels/:id/history { days? } (admin) → 202 { started: true }
 * Imports recent conversations from Messenger / Instagram (Graph API) in the background;
 * progress arrives as `channel.status` events (GET /api/v1/channels/:id/connection).
 */
import { after } from "next/server";
import { z } from "zod";
import { jsonResponse, notFound, unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { writeAudit } from "@/lib/server/audit";
import { getDb } from "@/lib/server/db";
import { getWorkspaceChannel } from "@/lib/server/channels/registry";
import { importMetaHistory } from "@/lib/server/channels/meta-history";
import { importLinkedInHistory } from "@/lib/server/channels/linkedin";
import { log } from "@/lib/server/http";
import { isTest } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ days: z.number().int().min(1).max(365).optional() });

export const POST = workspaceRoute<{ id: string }>({ role: "admin", rateLimit: { limit: 5, windowSec: 300 } }, async (c) => {
  const body = await c.body(Body);
  const channel = await getWorkspaceChannel(c.db, c.auth.workspaceId, c.params.id);
  if (!channel) throw notFound("Channel");
  if (channel.type !== "messenger" && channel.type !== "instagram" && channel.type !== "linkedin") throw unprocessable("History import is available for Messenger, Instagram and LinkedIn channels.");
  await writeAudit(c.db, { workspaceId: c.auth.workspaceId, actor: c.auth.actor, action: "channel.history_import", targetType: "channel", targetId: channel.id, meta: { days: body.days ?? null } });
  if (!isTest) after(async () => {
    try {
      const db = await getDb();
      if (channel.type === "linkedin") await importLinkedInHistory(db, channel, { days: body.days });
      else await importMetaHistory(db, channel, { days: body.days });
    } catch (e) {
      log("error", "meta_history_failed", { channelId: channel.id, message: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    }
  });
  return jsonResponse({ started: true }, 202);
});
