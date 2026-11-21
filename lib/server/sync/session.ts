/**
 * connector_sessions helpers shared by the sync manager, connectors, webhook
 * channels (e.g. WhatsApp coexistence history progress) and the connection API.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { isPersistentChannel, type ConnectionCommand, type ConnectionDTO } from "@/lib/shared/types";
import type { Database } from "../db";
import { channels, connectorKv, connectorSessions, type ChannelRow, type ConnectorSessionRow } from "../db/schema";
import { decryptJson, encryptJson } from "../crypto";
import { publishRealtime } from "../realtime";
import { workerEnabled } from "../env";
import type { KvStore, SessionPatch } from "./types";

export const SYNC_CHANNEL = "infera_sync";

/** Persistent connectors run only where the sync manager runs (long-running server). */
export const syncEnabled = () => process.env.INFERA_SYNC !== "off" && workerEnabled();

export async function ensureSession(db: Database, channel: Pick<ChannelRow, "id" | "workspaceId">): Promise<ConnectorSessionRow> {
  await db.insert(connectorSessions).values({ channelId: channel.id, workspaceId: channel.workspaceId }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(connectorSessions)
    .where(and(eq(connectorSessions.channelId, channel.id), eq(connectorSessions.workspaceId, channel.workspaceId)))
    .limit(1);
  return row;
}

/** Update state and publish a live `channel.status` event (delivered on commit). */
export async function updateConnectorSession(db: Database, channel: Pick<ChannelRow, "id" | "workspaceId">, patch: SessionPatch): Promise<void> {
  await ensureSession(db, channel);
  const lastError = patch.lastError === undefined ? undefined : patch.lastError === null ? null : patch.lastError.slice(0, 500);
  await db
    .update(connectorSessions)
    .set({ ...patch, ...(lastError !== undefined ? { lastError } : {}), updatedAt: new Date() })
    .where(eq(connectorSessions.channelId, channel.id));
  await publishRealtime(db, { type: "channel.status", workspaceId: channel.workspaceId, data: { channelId: channel.id, state: patch.state } });
}

/** Queue a command for whichever instance holds the connection, and wake the managers. */
export async function sendConnectionCommand(db: Database, channel: Pick<ChannelRow, "id" | "workspaceId">, command: ConnectionCommand, arg: string | null = null) {
  await ensureSession(db, channel);
  await db
    .update(connectorSessions)
    .set({ command, commandArg: arg, commandAt: new Date(), updatedAt: new Date(), ...(command === "connect" ? { state: "connecting" as const, lastError: null } : {}) })
    .where(eq(connectorSessions.channelId, channel.id));
  await db.execute(sql`select pg_notify(${SYNC_CHANNEL}, ${channel.id})`);
  await publishRealtime(db, { type: "channel.status", workspaceId: channel.workspaceId, data: { channelId: channel.id, state: command === "connect" ? "connecting" : undefined } });
}

export async function getAuth<T>(db: Database, channelId: string): Promise<T | null> {
  const [row] = await db.select({ authEnc: connectorSessions.authEnc }).from(connectorSessions).where(eq(connectorSessions.channelId, channelId)).limit(1);
  return decryptJson<T>(row?.authEnc ?? null);
}

export async function setAuth(db: Database, channelId: string, value: unknown | null) {
  await db
    .update(connectorSessions)
    .set({ authEnc: value === null ? null : encryptJson(value), updatedAt: new Date() })
    .where(eq(connectorSessions.channelId, channelId));
}

export function kvStore(db: Database, channelId: string): KvStore {
  const enc = (v: unknown) => encryptJson(v);
  return {
    async get<T>(key: string) {
      const [r] = await db
        .select({ v: connectorKv.valueEnc })
        .from(connectorKv)
        .where(and(eq(connectorKv.channelId, channelId), eq(connectorKv.key, key)))
        .limit(1);
      return r ? decryptJson<T>(r.v) : null;
    },
    async getMany<T>(keys: string[]) {
      if (!keys.length) return {} as Record<string, T>;
      const rows = await db
        .select({ k: connectorKv.key, v: connectorKv.valueEnc })
        .from(connectorKv)
        .where(and(eq(connectorKv.channelId, channelId), inArray(connectorKv.key, keys)));
      const out: Record<string, T> = {};
      for (const r of rows) {
        const v = decryptJson<T>(r.v);
        if (v !== null) out[r.k] = v;
      }
      return out;
    },
    async set(key, value) {
      if (value === null || value === undefined) {
        await db.delete(connectorKv).where(and(eq(connectorKv.channelId, channelId), eq(connectorKv.key, key)));
        return;
      }
      await db
        .insert(connectorKv)
        .values({ channelId, key, valueEnc: enc(value) })
        .onConflictDoUpdate({ target: [connectorKv.channelId, connectorKv.key], set: { valueEnc: enc(value), updatedAt: new Date() } });
    },
    async setMany(entries) {
      const all = Object.entries(entries);
      if (!all.length) return;
      // Batched: linked-device connectors write hundreds of Signal keys at once (pre-key upload).
      const dels = all.filter(([, v]) => v === null || v === undefined).map(([k]) => k);
      const ups = all.filter(([, v]) => v !== null && v !== undefined).map(([key, v]) => ({ channelId, key, valueEnc: enc(v) }));
      await db.transaction(async (tx) => {
        for (let i = 0; i < dels.length; i += 500) {
          await tx.delete(connectorKv).where(and(eq(connectorKv.channelId, channelId), inArray(connectorKv.key, dels.slice(i, i + 500))));
        }
        for (let i = 0; i < ups.length; i += 200) {
          await tx
            .insert(connectorKv)
            .values(ups.slice(i, i + 200))
            .onConflictDoUpdate({ target: [connectorKv.channelId, connectorKv.key], set: { valueEnc: sql`excluded.value_enc`, updatedAt: new Date() } });
        }
      });
    },
    async clear(prefix) {
      await db
        .delete(connectorKv)
        .where(and(eq(connectorKv.channelId, channelId), prefix ? sql`${connectorKv.key} like ${prefix.replace(/[%_\\]/g, "\\$&") + "%"}` : undefined));
    },
  };
}

export function toConnectionDTO(channel: ChannelRow, s: ConnectorSessionRow | null): ConnectionDTO {
  const persistent = isPersistentChannel(channel.type);
  const now = Date.now();
  const live = Boolean(s?.leaseUntil && s.leaseUntil.getTime() > now);
  // Webhook channels are "connected" while active; their history progress (if any) lives in the session row.
  const state = persistent ? (s?.state ?? "disconnected") : channel.status === "active" ? (s?.state === "syncing" ? "syncing" : "connected") : channel.status === "error" ? "error" : "disconnected";
  const qrValid = s?.qr && (!s.qrExpiresAt || s.qrExpiresAt.getTime() > now);
  return {
    channelId: channel.id,
    type: channel.type,
    state,
    qr: qrValid ? s!.qr : null,
    qrExpiresAt: qrValid && s?.qrExpiresAt ? s.qrExpiresAt.toISOString() : null,
    pairingCode: s?.pairingCode ?? null,
    prompt: persistent ? (s?.prompt ?? null) : null,
    account: s?.account ?? null,
    progress: s?.progress ?? null,
    lastConnectedAt: s?.lastConnectedAt?.toISOString() ?? null,
    lastSyncAt: (s?.lastSyncAt ?? channel.lastEventAt)?.toISOString() ?? null,
    lastError: s?.lastError ?? channel.lastError ?? null,
    live: persistent ? live : channel.status === "active",
    syncAvailable: persistent ? syncEnabled() : true,
    realtime: persistent ? "persistent" : "webhook",
  };
}

export async function getConnection(db: Database, workspaceId: string, channelId: string): Promise<ConnectionDTO | null> {
  const [row] = await db
    .select({ channel: channels, session: connectorSessions })
    .from(channels)
    .leftJoin(connectorSessions, eq(connectorSessions.channelId, channels.id))
    .where(and(eq(channels.id, channelId), eq(channels.workspaceId, workspaceId)))
    .limit(1);
  return row ? toConnectionDTO(row.channel, row.session) : null;
}
