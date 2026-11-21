/**
 * GET  /api/v1/channels → { items: ChannelDTO[], nextCursor: null }                     (viewer / API read)
 * POST /api/v1/channels { type, name, externalId?, config?, secrets?, registerWebhook? }  (admin, session only)
 *      → 201 ChannelDTO + `generatedSecrets` (once) [+ `inboundUrl` for email, `webhookRegistration` for Telegram]
 *
 * Secrets are AES-GCM encrypted at rest and never returned (only `secretsSet` names).
 */
import { and, asc, count, eq } from "drizzle-orm";
import { ApiError, conflict, created, workspaceRoute } from "@/lib/server/api/handler";
import { writeAudit } from "@/lib/server/audit";
import { encryptJson, newToken } from "@/lib/server/crypto";
import { channels } from "@/lib/server/db/schema";
import { newId } from "@/lib/server/ids";
import { ChannelCreateBody, MAX_CHANNELS_PER_WORKSPACE, TELEGRAM_NOT_CONFIGURED, resolveChannelSetup } from "@/lib/server/channels/manage";
import { toChannelDTO, webhookUrlFor } from "@/lib/server/channels/registry";
import { registerTelegramWebhook } from "@/lib/server/channels/providers";
import { after } from "next/server";
import { getDb } from "@/lib/server/db";
import { log } from "@/lib/server/http";
import { isTest, telegramApiCredentials } from "@/lib/server/env";
import { registerMetaWebhook } from "@/lib/server/channels/meta-graph";
import { importMetaHistory } from "@/lib/server/channels/meta-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute({ role: "viewer", scope: "read" }, async (c) => {
  const rows = await c.db.select().from(channels).where(eq(channels.workspaceId, c.auth.workspaceId)).orderBy(asc(channels.createdAt), asc(channels.id)).limit(MAX_CHANNELS_PER_WORKSPACE * 2);
  return { items: rows.map(toChannelDTO), nextCursor: null };
});

export const POST = workspaceRoute({ role: "admin", rateLimit: { limit: 30, windowSec: 600 } }, async (c) => {
  const body = await c.body(ChannelCreateBody);
  const setup = resolveChannelSetup(body.type, { externalId: body.externalId, config: body.config ?? {}, secrets: body.secrets ?? {} });
  // Telegram accounts link with the server's TELEGRAM_API_ID / TELEGRAM_API_HASH only — without them a channel could never connect.
  if (body.type === "telegram_user" && !telegramApiCredentials()) throw new ApiError(503, "telegram_not_configured", TELEGRAM_NOT_CONFIGURED);

  const row = await c.db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(channels).where(eq(channels.workspaceId, c.auth.workspaceId));
    if (n >= MAX_CHANNELS_PER_WORKSPACE) throw conflict(`A workspace can have at most ${MAX_CHANNELS_PER_WORKSPACE} channels.`);
    if (setup.externalId) {
      const taken = await tx
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.type, body.type), eq(channels.externalId, setup.externalId)))
        .limit(1);
      if (taken[0]) throw conflict(body.type === "telegram" ? "This Telegram bot is already connected to an Infera workspace." : "This WhatsApp number is already connected to an Infera workspace.");
    }
    const [inserted] = await tx
      .insert(channels)
      .values({
        id: newId("chn"),
        workspaceId: c.auth.workspaceId,
        type: body.type,
        name: body.name,
        externalId: setup.externalId,
        webhookToken: newToken(24),
        config: setup.config,
        secretsEnc: Object.keys(setup.secrets).length ? encryptJson(setup.secrets) : null,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted) throw conflict("This channel is already connected to an Infera workspace.");
    await writeAudit(tx, {
      workspaceId: c.auth.workspaceId,
      actor: c.auth.actor,
      action: "channel.create",
      targetType: "channel",
      targetId: inserted.id,
      after: { type: inserted.type, name: inserted.name, externalId: inserted.externalId, config: inserted.config, secretsSet: Object.keys(setup.secrets).sort() },
      meta: { ip: c.auth.ip },
    });
    return inserted;
  });

  const dto = toChannelDTO(row);
  const out: Record<string, unknown> = { ...dto, generatedSecrets: setup.generated };
  if (row.type === "email" && setup.secrets.inboundSecret && dto.webhookUrl) out.inboundUrl = `${dto.webhookUrl}?key=${encodeURIComponent(setup.secrets.inboundSecret)}`;
  if (row.type === "telegram" && body.registerWebhook) {
    const url = webhookUrlFor(row, setup.secrets);
    const reg = url ? await registerTelegramWebhook({ botToken: setup.secrets.botToken, url, secret: setup.secrets.webhookSecret }) : { ok: false, error: "No webhook URL." };
    await writeAudit(c.db, { workspaceId: c.auth.workspaceId, actor: c.auth.actor, action: "channel.webhook_register", targetType: "channel", targetId: row.id, after: { ok: reg.ok }, meta: { error: reg.error ?? null } });
    out.webhookRegistration = reg;
  }
  if (row.type === "messenger" || row.type === "instagram") {
    const url = webhookUrlFor(row, setup.secrets);
    const appId = typeof row.config?.appId === "string" ? row.config.appId : null;
    if (body.registerWebhook) {
      const reg =
        url && appId
          ? await registerMetaWebhook({ appId, appSecret: setup.secrets.appSecret, pageId: String(row.config.pageId), pageAccessToken: setup.secrets.pageAccessToken, callbackUrl: url, verifyToken: setup.secrets.verifyToken, platform: row.type })
          : { ok: false, steps: [{ step: "app_webhook", ok: false, error: appId ? "No public webhook URL (set APP_URL)." : "config.appId (Meta App ID) is required to register the webhook." }] };
      await writeAudit(c.db, { workspaceId: c.auth.workspaceId, actor: c.auth.actor, action: "channel.webhook_register", targetType: "channel", targetId: row.id, after: { ok: reg.ok } });
      out.webhookRegistration = reg;
    }
    // Bring in recent conversations right away (background; progress via channel.status).
    if (!isTest) after(async () => {
      try {
        await importMetaHistory(await getDb(), row);
      } catch (e) {
        log("error", "meta_history_failed", { channelId: row.id, message: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
      }
    });
  }
  return created(out);
});
