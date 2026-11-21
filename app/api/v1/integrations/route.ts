/**
 * GET /api/v1/integrations (viewer) → which connection methods this server supports,
 * so the console only offers options that will work.
 *
 * `telegram` is true only when TELEGRAM_API_ID / TELEGRAM_API_HASH are set and well-formed
 * (they are server-only; users never enter Telegram API credentials).
 */
import { workspaceRoute } from "@/lib/server/api/handler";
import { telegramApiCredentials } from "@/lib/server/env";
import { googleConfigured } from "@/lib/server/sync/google-oauth";
import { syncEnabled } from "@/lib/server/sync/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute({ role: "viewer" }, async () => ({
  google: googleConfigured(),
  telegram: telegramApiCredentials() !== null,
  liveSync: syncEnabled(),
}));
