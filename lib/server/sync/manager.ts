/**
 * Sync manager: keeps persistent connectors (WhatsApp linked device, Telegram
 * user account, IMAP mailbox) running on long-running servers.
 *
 * - Exactly one instance runs a given channel: it holds a lease on the
 *   channel's connector_sessions row (renewed every tick, DB clock). If the
 *   instance dies, another one takes over once the lease expires (~45 s).
 * - Console commands (connect / disconnect / logout / resync / pair_code) are
 *   written to the session row; `pg_notify('infera_sync')` wakes every manager,
 *   and the lease holder executes them.
 * - Failures stop the connector and restart it with exponential backoff
 *   (30 s → 10 min). A logged-out account stays stopped until "connect".
 *
 * Started from lib/server/boot.ts when INFERA_SYNC !== "off" and the worker is on.
 */
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { PERSISTENT_CHANNEL_TYPES, isPersistentChannel, type ConnectionCommand, type PersistentChannelType } from "@/lib/shared/types";
import { getDb, getDbState, type Database } from "../db";
import { channels, connectorSessions, type ChannelRow, type ConnectorSessionRow } from "../db/schema";
import { log } from "../http";
import { decryptSecrets } from "../channels/registry";
import { ingestInboundMessage } from "../channels/ingest";
import type { ParsedInbound } from "../channels/types";
import { connectorLoaders } from "./registry";
import { SYNC_CHANNEL, ensureSession, getAuth, kvStore, setAuth, updateConnectorSession } from "./session";
import type { ConnectorContext, ConnectorRuntime } from "./types";

const TICK_MS = 10_000;
const LEASE_SECONDS = 45;
const STOP_TIMEOUT_MS = 10_000;
const STALE_COMMAND_MS = 10 * 60_000;

type Running = { channelId: string; workspaceId: string; type: PersistentChannelType; runtime: ConnectorRuntime | null; abort: AbortController; stopping: boolean };

const g = globalThis as unknown as {
  __inferaSync?: { stop: () => Promise<void>; workerId: string; running: Map<string, Running> };
};

const safeMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 300);

export function syncManagerStatus() {
  const m = g.__inferaSync;
  return m ? { running: m.running.size, workerId: m.workerId } : null;
}

export function startSyncManager() {
  if (g.__inferaSync) return g.__inferaSync;
  const workerId = `${hostname().slice(0, 30)}-${process.pid}-${randomBytes(3).toString("hex")}`;
  const running = new Map<string, Running>();
  const backoff = new Map<string, { attempts: number; nextAt: number }>();
  let stopped = false;
  let ticking = false;
  let again = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let unlisten: (() => Promise<void>) | null = null;

  const logf = (level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) => log(level, `sync_${event}`, { workerId, ...fields });

  /* ------------------------------ Leases ------------------------------ */

  const acquire = async (db: Database, channelId: string) => {
    const rows = await db
      .update(connectorSessions)
      .set({ leaseOwner: workerId, leaseUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})` })
      .where(and(eq(connectorSessions.channelId, channelId), or(isNull(connectorSessions.leaseOwner), lt(connectorSessions.leaseUntil, sql`now()`), eq(connectorSessions.leaseOwner, workerId))))
      .returning({ id: connectorSessions.channelId });
    return rows.length > 0;
  };
  const release = async (db: Database, channelId: string) => {
    await db
      .update(connectorSessions)
      .set({ leaseOwner: null, leaseUntil: null })
      .where(and(eq(connectorSessions.channelId, channelId), eq(connectorSessions.leaseOwner, workerId)));
  };
  const heldByOther = (s: ConnectorSessionRow) => Boolean(s.leaseOwner && s.leaseOwner !== workerId && s.leaseUntil && s.leaseUntil.getTime() > Date.now());

  /* --------------------------- Start / stop --------------------------- */

  const stopRunning = async (db: Database, channelId: string, reason: string) => {
    const r = running.get(channelId);
    if (!r || r.stopping) return;
    r.stopping = true;
    r.abort.abort(reason);
    try {
      await Promise.race([r.runtime?.stop(), new Promise((res) => setTimeout(res, STOP_TIMEOUT_MS))]);
    } catch (e) {
      logf("warn", "stop_failed", { channelId, message: safeMessage(e) });
    }
    running.delete(channelId);
    await release(db, channelId).catch(() => {});
    logf("info", "stopped", { channelId, reason });
  };

  const onFail = async (db: Database, channel: Pick<ChannelRow, "id" | "workspaceId">, error: unknown) => {
    const r = running.get(channel.id);
    if (r?.stopping) return;
    logf("warn", "connector_failed", { channelId: channel.id, message: safeMessage(error) });
    await stopRunning(db, channel.id, "failed");
    const b = backoff.get(channel.id) ?? { attempts: 0, nextAt: 0 };
    b.attempts++;
    b.nextAt = Date.now() + Math.min(600_000, 30_000 * 2 ** (b.attempts - 1));
    backoff.set(channel.id, b);
    const [s] = await db.select({ state: connectorSessions.state }).from(connectorSessions).where(eq(connectorSessions.channelId, channel.id)).limit(1);
    // A connector that reported "logged_out" (or a user who disconnected) must not be flipped to "error".
    if (s && s.state !== "logged_out" && s.state !== "disconnected") {
      await updateConnectorSession(db, channel, { state: "error", lastError: safeMessage(error), qr: null, pairingCode: null, prompt: null }).catch(() => {});
    }
  };

  const makeContext = (db: Database, channel: ChannelRow, abort: AbortController): ConnectorContext => {
    const ctx: ConnectorContext = {
      db,
      channel,
      workspaceId: channel.workspaceId,
      secrets: decryptSecrets(channel),
      signal: abort.signal,
      log: (level, event, fields = {}) => log(level, `connector_${event}`, { channelId: channel.id, type: channel.type, ...fields }),
      update: async (patch) => {
        if (abort.signal.aborted && patch.state && patch.state !== "logged_out") return;
        if (patch.state === "connected") {
          backoff.delete(channel.id);
          patch = { lastConnectedAt: new Date(), lastError: null, qr: null, pairingCode: null, prompt: null, ...patch };
        }
        await updateConnectorSession(db, channel, patch);
      },
      getAuth: <T>() => getAuth<T>(db, channel.id),
      setAuth: (v) => setAuth(db, channel.id, v),
      getCursor: async () => {
        const [r] = await db.select({ c: connectorSessions.cursor }).from(connectorSessions).where(eq(connectorSessions.channelId, channel.id)).limit(1);
        return r?.c ?? {};
      },
      setCursor: async (patch) => {
        await db
          .update(connectorSessions)
          .set({ cursor: sql`${connectorSessions.cursor} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
          .where(eq(connectorSessions.channelId, channel.id));
      },
      kv: kvStore(db, channel.id),
      ingest: (msg: ParsedInbound, opts = {}) =>
        ingestInboundMessage(db, {
          ...msg,
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          historical: opts.historical ?? msg.historical,
          priority: opts.priority ?? msg.priority ?? ((opts.historical ?? msg.historical) ? 200 : 50),
          skipProcessing: opts.skipProcessing ?? msg.skipProcessing,
        }),
      ingestMany: async (msgs, opts = {}) => {
        let imported = 0;
        let duplicates = 0;
        const total = opts.progress?.total ?? null;
        const base = opts.progress?.baseDone ?? 0;
        for (let i = 0; i < msgs.length; i++) {
          if (abort.signal.aborted) break;
          const r = await ctx.ingest(msgs[i], opts);
          if (r.duplicate) duplicates++;
          else imported++;
          if ((i + 1) % 50 === 0 || i === msgs.length - 1) {
            await ctx.update({ progress: { phase: "history", total, done: base + i + 1, startedAt: null, finishedAt: null } }).catch(() => {});
          }
        }
        return { imported, duplicates };
      },
      reloadChannel: async () => {
        const [c] = await db
          .select()
          .from(channels)
          .where(and(eq(channels.id, channel.id), eq(channels.workspaceId, channel.workspaceId)))
          .limit(1);
        return c ?? null;
      },
      fail: (error) => {
        void onFail(db, channel, error);
      },
    };
    return ctx;
  };

  const startRunning = async (db: Database, channel: ChannelRow) => {
    if (!isPersistentChannel(channel.type)) return;
    const type = channel.type;
    const abort = new AbortController();
    const entry: Running = { channelId: channel.id, workspaceId: channel.workspaceId, type, runtime: null, abort, stopping: false };
    running.set(channel.id, entry);
    logf("info", "starting", { channelId: channel.id, type });
    try {
      const factory = await connectorLoaders[type]();
      entry.runtime = await factory(makeContext(db, channel, abort));
      if (abort.signal.aborted) {
        await entry.runtime.stop().catch(() => {});
        return;
      }
    } catch (e) {
      await onFail(db, channel, e);
    }
  };

  /* ----------------------------- Commands ----------------------------- */

  const clearCommand = async (db: Database, s: ConnectorSessionRow) => {
    await db
      .update(connectorSessions)
      .set({ command: null, commandArg: null, commandAt: null })
      .where(and(eq(connectorSessions.channelId, s.channelId), s.commandAt ? eq(connectorSessions.commandAt, s.commandAt) : isNull(connectorSessions.commandAt)));
  };

  /** Executes the pending command if this instance is responsible for it. */
  const handleCommand = async (db: Database, channel: ChannelRow, s: ConnectorSessionRow) => {
    const cmd = s.command as ConnectionCommand;
    const mine = running.get(channel.id);
    if (s.commandAt && Date.now() - s.commandAt.getTime() > STALE_COMMAND_MS) {
      await clearCommand(db, s);
      return;
    }
    if (!mine && heldByOther(s)) return; // the lease holder will execute it
    switch (cmd) {
      case "connect":
        backoff.delete(channel.id);
        // A running connector may restart its login (Telegram: fresh QR code, or back to QR from the phone-number flow).
        if (mine?.runtime) await mine.runtime.command?.("connect", null).catch((e) => logf("warn", "command_failed", { channelId: channel.id, command: cmd, message: safeMessage(e) }));
        await clearCommand(db, s);
        return;
      case "disconnect":
        if (mine) await stopRunning(db, channel.id, "disconnect");
        await updateConnectorSession(db, channel, { state: "disconnected", qr: null, pairingCode: null, prompt: null, progress: null });
        await clearCommand(db, s);
        return;
      case "logout":
        if (mine) {
          await mine.runtime?.command?.("logout", null).catch((e) => logf("warn", "logout_failed", { channelId: channel.id, message: safeMessage(e) }));
          await stopRunning(db, channel.id, "logout");
        }
        await setAuth(db, channel.id, null);
        await kvStore(db, channel.id).clear();
        await updateConnectorSession(db, channel, { state: "logged_out", qr: null, pairingCode: null, prompt: null, account: null, progress: null, lastError: null });
        await db.update(connectorSessions).set({ cursor: {} }).where(eq(connectorSessions.channelId, channel.id));
        await clearCommand(db, s);
        return;
      case "resync":
      case "pair_code":
      case "password":
      case "phone_login":
      case "code":
        if (mine?.runtime) {
          await mine.runtime.command?.(cmd, s.commandArg ?? null).catch((e) => logf("warn", "command_failed", { channelId: channel.id, command: cmd, message: safeMessage(e) }));
          await clearCommand(db, s);
        }
        // Not running anywhere yet: keep the command; it runs once the connector has started.
        return;
    }
  };

  /* ------------------------------- Tick ------------------------------- */

  const tick = async () => {
    if (stopped) return;
    if (ticking) {
      again = true;
      return;
    }
    ticking = true;
    try {
      const db = await getDb();
      const rows = await db
        .select({ channel: channels, session: connectorSessions })
        .from(channels)
        .leftJoin(connectorSessions, eq(connectorSessions.channelId, channels.id))
        .where(inArray(channels.type, [...PERSISTENT_CHANNEL_TYPES]));
      const seen = new Set<string>();
      for (const row of rows) {
        const channel = row.channel;
        seen.add(channel.id);
        try {
          let s = row.session ?? (await ensureSession(db, channel));
          if (channel.status !== "active") {
            if (running.has(channel.id)) await stopRunning(db, channel.id, "paused");
            continue;
          }
          if (s.command) {
            await handleCommand(db, channel, s);
            s = (await db.select().from(connectorSessions).where(eq(connectorSessions.channelId, channel.id)).limit(1))[0] ?? s;
          }
          const desired = s.state !== "disconnected" && s.state !== "logged_out";
          if (!desired) {
            if (running.has(channel.id)) await stopRunning(db, channel.id, s.state);
            continue;
          }
          if (running.has(channel.id)) {
            if (!(await acquire(db, channel.id))) await stopRunning(db, channel.id, "lease_lost");
            continue;
          }
          const b = backoff.get(channel.id);
          if (b && b.nextAt > Date.now()) continue;
          if (heldByOther(s)) continue;
          if (await acquire(db, channel.id)) await startRunning(db, channel);
        } catch (e) {
          logf("error", "tick_channel_failed", { channelId: channel.id, message: safeMessage(e) });
        }
      }
      // Channels deleted while running.
      for (const id of [...running.keys()]) if (!seen.has(id)) await stopRunning(db, id, "deleted");
    } catch (e) {
      logf("error", "tick_failed", { message: safeMessage(e) });
    } finally {
      ticking = false;
      if (again && !stopped) {
        again = false;
        setTimeout(() => void tick(), 0);
      }
    }
  };

  interval = setInterval(() => void tick(), TICK_MS);
  interval.unref?.();
  setTimeout(() => void tick(), 500);
  void getDbState()
    .then((s) => s.listen(SYNC_CHANNEL, () => void tick()))
    .then((u) => {
      if (stopped) void u();
      else unlisten = u;
    })
    .catch((e) => logf("warn", "listen_failed", { message: safeMessage(e) }));

  const stop = async () => {
    stopped = true;
    if (interval) clearInterval(interval);
    await unlisten?.().catch(() => {});
    const db = await getDb();
    await Promise.all([...running.keys()].map((id) => stopRunning(db, id, "shutdown")));
    g.__inferaSync = undefined;
  };
  g.__inferaSync = { stop, workerId, running };
  logf("info", "manager_started");
  return g.__inferaSync;
}

export async function stopSyncManager() {
  await g.__inferaSync?.stop();
}
