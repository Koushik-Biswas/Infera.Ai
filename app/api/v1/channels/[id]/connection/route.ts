/**
 * Live connection of a channel.
 *
 *   GET  /api/v1/channels/:id/connection → ConnectionDTO (state, QR, progress, account…)
 *   POST /api/v1/channels/:id/connection  { action, phone? } → ConnectionDTO
 *        action: connect | disconnect | logout | resync | pair_code (phone required, E.164 digits)
 *
 * Commands are queued for the server instance holding the connection
 * (lib/server/sync/manager.ts). The console follows progress through
 * `channel.status` events on /api/v1/stream.
 */
import { z } from "zod";
import { isPersistentChannel } from "@/lib/shared/types";
import { ApiError, conflict, notFound, unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { writeAudit } from "@/lib/server/audit";
import { getWorkspaceChannel } from "@/lib/server/channels/registry";
import { getConnection, sendConnectionCommand, syncEnabled } from "@/lib/server/sync/session";
import { sealText } from "@/lib/server/data/sealed";
import { telegramApiCredentials } from "@/lib/server/env";
import { TELEGRAM_NOT_CONFIGURED } from "@/lib/server/channels/manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { id: string };

export const GET = workspaceRoute<P>({ role: "viewer", scope: "read" }, async (c) => {
  const conn = await getConnection(c.db, c.auth.workspaceId, c.params.id);
  if (!conn) throw notFound("Channel");
  return conn;
});

const Body = z.object({
  action: z.enum(["connect", "disconnect", "logout", "resync", "pair_code", "password", "phone_login", "code"]),
  /** Telegram two-step verification password (sealed while it waits for the connector). */
  password: z.string().min(1).max(256).optional(),
  /** WhatsApp pairing-code number, or the Telegram phone-number login (E.164). */
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s().-]/g, ""))
    .pipe(z.string().regex(/^\+?[1-9]\d{6,14}$/, "Enter the phone number with country code, e.g. +919876543210."))
    .optional(),
  /** Telegram login code (from the Telegram app, SMS or call). */
  code: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^[0-9A-Za-z]{3,12}$/, "Enter the login code Telegram sent you."))
    .optional(),
});

const TELEGRAM_ONLY = new Set(["password", "phone_login", "code"]);

export const POST = workspaceRoute<P>({ role: "admin", rateLimit: { limit: 30, windowSec: 60 } }, async (c) => {
  const body = await c.body(Body);
  const channel = await getWorkspaceChannel(c.db, c.auth.workspaceId, c.params.id);
  if (!channel) throw notFound("Channel");
  if (!isPersistentChannel(channel.type)) throw unprocessable("This channel receives messages through webhooks; there is no live connection to control.");
  if (!syncEnabled()) {
    throw new ApiError(503, "sync_unavailable", "Live sync needs a long-running server (Docker or a VM). It is turned off on this deployment (INFERA_SYNC=off or INFERA_WORKER=off).");
  }
  if (channel.status !== "active") throw conflict("Resume the channel before connecting it.");
  if (channel.type === "whatsapp_web" && body.action !== "disconnect" && body.action !== "logout" && channel.config?.riskAcknowledged !== true) {
    throw new ApiError(409, "risk_ack_required", "Confirm that you understand the risks of the unofficial WhatsApp linked-device connection first.");
  }
  if (body.action === "pair_code") {
    if (channel.type !== "whatsapp_web") throw unprocessable("Pairing codes are only available for WhatsApp linked devices.");
    if (!body.phone) throw unprocessable("phone: Enter the WhatsApp number to pair.");
  }
  if (TELEGRAM_ONLY.has(body.action) && channel.type !== "telegram_user") throw unprocessable("This step is only used when linking a Telegram account.");
  // Telegram account login runs with the server's TELEGRAM_API_ID / TELEGRAM_API_HASH only.
  if (channel.type === "telegram_user" && body.action !== "disconnect" && body.action !== "logout" && !telegramApiCredentials()) {
    throw new ApiError(503, "telegram_not_configured", TELEGRAM_NOT_CONFIGURED);
  }
  if (body.action === "password" && !body.password) throw unprocessable("password: Enter your Telegram two-step verification password.");
  if (body.action === "phone_login" && !body.phone) throw unprocessable("phone: Enter your phone number with country code.");
  if (body.action === "code" && !body.code) throw unprocessable("code: Enter the login code Telegram sent you.");
  // Passwords, login codes and phone numbers are sealed while they wait in connector_sessions.
  const arg =
    body.action === "pair_code"
      ? body.phone!.replace(/\D/g, "")
      : body.action === "password"
        ? sealText(body.password!)
        : body.action === "phone_login"
          ? sealText(`+${body.phone!.replace(/\D/g, "")}`)
          : body.action === "code"
            ? sealText(body.code!)
            : null;
  // pair_code also needs the connector running: make sure it is wanted.
  if (body.action === "pair_code") await sendConnectionCommand(c.db, channel, "connect");
  await sendConnectionCommand(c.db, channel, body.action, arg);
  await writeAudit(c.db, {
    workspaceId: c.auth.workspaceId,
    actor: c.auth.actor,
    action: "channel.connection_command",
    targetType: "channel",
    targetId: channel.id,
    meta: { command: body.action, ip: c.ip },
  });
  return (await getConnection(c.db, c.auth.workspaceId, channel.id))!;
});
