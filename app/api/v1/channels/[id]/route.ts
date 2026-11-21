/**
 * GET    /api/v1/channels/:id → ChannelDTO                                   (viewer / API read)
 * PATCH  /api/v1/channels/:id { name?, status?, externalId?, config?, secrets?, rotate?, rotateWebhookToken?, registerWebhook? } (admin)
 *        → ChannelDTO + `generatedSecrets` for rotated/generated secrets (once)
 * DELETE /api/v1/channels/:id → 204; removes the channel and its conversations/messages (admin, audited)
 *
 * Another workspace's channel id → 404 (rule 6).
 */
import { and, eq, ne } from "drizzle-orm";
import { conflict, notFound, workspaceRoute } from "@/lib/server/api/handler";
import { writeAudit } from "@/lib/server/audit";
import { encryptJson, newToken } from "@/lib/server/crypto";
import { channels, type ChannelRow } from "@/lib/server/db/schema";
import { ChannelPatchBody, isUniqueViolation, rejectTelegramCredentials, resolveChannelSetup } from "@/lib/server/channels/manage";
import { LEGACY_TELEGRAM_CONFIG_KEYS, LEGACY_TELEGRAM_SECRET_KEYS, decryptSecrets, getWorkspaceChannel, toChannelDTO, webhookUrlFor } from "@/lib/server/channels/registry";
import { registerTelegramWebhook } from "@/lib/server/channels/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/** Non-secret snapshot for the audit log. */
const snapshot = (row: ChannelRow) => ({ name: row.name, status: row.status, externalId: row.externalId, config: row.config, secretsSet: Object.keys(decryptSecrets(row)).sort() });

export const GET = workspaceRoute<Params>({ role: "viewer", scope: "read" }, async (c) => {
  const row = await getWorkspaceChannel(c.db, c.auth.workspaceId, c.params.id);
  if (!row) throw notFound("Channel");
  return toChannelDTO(row);
});

export const PATCH = workspaceRoute<Params>({ role: "admin" }, async (c) => {
  const body = await c.body(ChannelPatchBody);
  const current = await getWorkspaceChannel(c.db, c.auth.workspaceId, c.params.id);
  if (!current) throw notFound("Channel");

  const mergedSecrets = { ...decryptSecrets(current) };
  for (const [k, v] of Object.entries(body.secrets ?? {})) {
    if (v === null) delete mergedSecrets[k];
    else mergedSecrets[k] = v;
  }
  const mergedConfig: Record<string, unknown> = { ...(current.config ?? {}) };
  for (const [k, v] of Object.entries(body.config ?? {})) {
    if (v === null) delete mergedConfig[k];
    else mergedConfig[k] = v;
  }
  // Telegram account channels: new per-channel credentials are rejected (400). Values stored by older
  // versions are kept as they are (unused — the server's TELEGRAM_API_ID / TELEGRAM_API_HASH apply) and
  // skip validation so the channel can still be renamed or paused. Sending null removes them.
  const legacy: { config: Record<string, unknown>; secrets: Record<string, string> } = { config: {}, secrets: {} };
  if (current.type === "telegram_user") {
    rejectTelegramCredentials(body.config, body.secrets ?? undefined);
    for (const k of LEGACY_TELEGRAM_CONFIG_KEYS) {
      if (k in mergedConfig) {
        legacy.config[k] = mergedConfig[k];
        delete mergedConfig[k];
      }
    }
    for (const k of LEGACY_TELEGRAM_SECRET_KEYS) {
      if (k in mergedSecrets) {
        legacy.secrets[k] = mergedSecrets[k];
        delete mergedSecrets[k];
      }
    }
  }
  const setup = resolveChannelSetup(current.type, {
    externalId: body.externalId !== undefined ? body.externalId : current.externalId,
    config: mergedConfig,
    secrets: mergedSecrets,
    generate: body.rotate,
  });
  // The default API / export channels keep their internal marker id.
  const externalId = current.type === "api" || current.type === "whatsapp_export" ? current.externalId : setup.externalId;

  const updated = await c.db.transaction(async (tx) => {
    if (externalId && externalId !== current.externalId) {
      const taken = await tx
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.type, current.type), eq(channels.externalId, externalId), ne(channels.id, current.id)))
        .limit(1);
      if (taken[0]) throw conflict("Another Infera channel already uses this provider id.");
    }
    let row: ChannelRow | undefined;
    try {
      [row] = await tx
        .update(channels)
        .set({
          name: body.name ?? current.name,
          status: body.status ?? current.status,
          externalId,
          config: { ...setup.config, ...legacy.config },
          secretsEnc: Object.keys(setup.secrets).length + Object.keys(legacy.secrets).length ? encryptJson({ ...setup.secrets, ...legacy.secrets }) : null,
          webhookToken: body.rotateWebhookToken ? newToken(24) : current.webhookToken,
          // Re-enabling a channel clears a stale error.
          lastError: body.status === "active" ? null : current.lastError,
          updatedAt: new Date(),
        })
        .where(and(eq(channels.id, current.id), eq(channels.workspaceId, c.auth.workspaceId)))
        .returning();
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("Another Infera channel already uses this provider id.");
      throw e;
    }
    if (!row) throw notFound("Channel");
    const changedSecrets = Object.keys({ ...(body.secrets ?? {}), ...setup.generated }).sort();
    await writeAudit(tx, {
      workspaceId: c.auth.workspaceId,
      actor: c.auth.actor,
      action: "channel.update",
      targetType: "channel",
      targetId: row.id,
      before: snapshot(current),
      after: snapshot(row),
      meta: { secretsChanged: changedSecrets, webhookTokenRotated: Boolean(body.rotateWebhookToken), ip: c.auth.ip },
    });
    return row;
  });

  const out: Record<string, unknown> = { ...toChannelDTO(updated), generatedSecrets: setup.generated };
  if (updated.type === "telegram" && body.registerWebhook) {
    const url = webhookUrlFor(updated, setup.secrets);
    const reg = url ? await registerTelegramWebhook({ botToken: setup.secrets.botToken, url, secret: setup.secrets.webhookSecret }) : { ok: false, error: "No webhook URL." };
    await writeAudit(c.db, { workspaceId: c.auth.workspaceId, actor: c.auth.actor, action: "channel.webhook_register", targetType: "channel", targetId: updated.id, after: { ok: reg.ok }, meta: { error: reg.error ?? null } });
    out.webhookRegistration = reg;
  }
  return out;
});

export const DELETE = workspaceRoute<Params>({ role: "admin" }, async (c) => {
  await c.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(channels)
      .where(and(eq(channels.id, c.params.id), eq(channels.workspaceId, c.auth.workspaceId)))
      .returning();
    if (!row) throw notFound("Channel");
    await writeAudit(tx, {
      workspaceId: c.auth.workspaceId,
      actor: c.auth.actor,
      action: "channel.delete",
      targetType: "channel",
      targetId: row.id,
      before: { type: row.type, ...snapshot(row) },
      meta: { ip: c.auth.ip },
    });
  });
  return null;
});
