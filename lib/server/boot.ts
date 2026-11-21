/**
 * Node.js-only server startup, loaded from instrumentation.ts.
 * Starts the background job worker, the scheduler and the live-sync manager
 * on long-running servers (Docker, VM, `npm start`, `npm run dev`).
 * On serverless set INFERA_WORKER=off and call /api/cron on a schedule instead
 * (persistent connectors — WhatsApp QR, Telegram account, IMAP — need a long-running server).
 */
import { isProd, workerEnabled } from "./env";
import { getDb } from "./db";
import { log } from "./http";
import { autoLoginEnabled } from "@/lib/auto-login-flag";
import { startWorker, stopWorker } from "./jobs/queue";
import { startScheduler } from "./jobs/scheduler";
import { syncEnabled } from "./sync/session";

export async function boot() {
  if (!workerEnabled()) return;
  // Connect + migrate eagerly so the first request isn't slow and schema errors surface at boot.
  const db = await getDb();
  if (autoLoginEnabled() && isProd) log("warn", "auto_login_enabled", { message: "INFERA_AUTO_LOGIN is on: anyone who can reach this server is signed in as the owner." });
  startWorker();
  // Encrypt content stored before encryption at rest existed, and build its search index (idempotent, batched).
  void import("./data/sealed")
    .then(({ sealLegacyContent }) => sealLegacyContent(db))
    .then((n) => {
      if (n.messages || n.conversations || n.files) log("info", "legacy_content_sealed", n);
    })
    .catch((e) => log("error", "legacy_seal_failed", { message: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
  startScheduler();
  let stopSync: (() => Promise<void>) | null = null;
  if (syncEnabled()) {
    const { startSyncManager, stopSyncManager } = await import("./sync/manager");
    startSyncManager();
    stopSync = stopSyncManager;
  }
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopWorker();
    void stopSync?.();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
