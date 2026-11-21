/**
 * Realtime updates for the console.
 *
 *   publishRealtime(tx, { type, workspaceId, data })   — inside the write's transaction
 *        → pg_notify('infera_rt', …)  (delivered on COMMIT, to every server instance)
 *        → hub (one LISTEN per process) → subscribers for that workspace
 *        → GET /api/v1/stream (Server-Sent Events) → browser → cache invalidation
 *
 * Payloads carry ids only — never message text or personal data — and are
 * re-checked against the subscriber's workspace before delivery.
 */
import { sql } from "drizzle-orm";
import type { RealtimeEvent } from "@/lib/shared/types";
import { getDbState, type Database, type Unlisten } from "../db";

export const REALTIME_CHANNEL = "infera_rt";
/** Postgres NOTIFY payloads must stay under 8000 bytes. */
const MAX_PAYLOAD = 7000;

export async function publishRealtime(db: Database, e: Omit<RealtimeEvent, "at"> & { at?: string }): Promise<void> {
  const event: RealtimeEvent = { ...e, at: e.at ?? new Date().toISOString() };
  const payload = JSON.stringify(event);
  if (payload.length > MAX_PAYLOAD) return;
  await db.execute(sql`select pg_notify(${REALTIME_CHANNEL}, ${payload})`);
}

type Subscriber = (e: RealtimeEvent) => void;

const g = globalThis as unknown as {
  __inferaRealtime?: { subs: Map<string, Set<Subscriber>>; unlisten: Promise<Unlisten> | null };
};

function hub() {
  g.__inferaRealtime ??= { subs: new Map(), unlisten: null };
  return g.__inferaRealtime;
}

function dispatch(payload: string) {
  let e: RealtimeEvent;
  try {
    e = JSON.parse(payload) as RealtimeEvent;
  } catch {
    return;
  }
  if (!e || typeof e.workspaceId !== "string" || typeof e.type !== "string") return;
  for (const cb of hub().subs.get(e.workspaceId) ?? []) {
    try {
      cb(e);
    } catch {
      /* one slow/broken subscriber never affects others */
    }
  }
}

/** Subscribe to realtime events of one workspace. Returns an unsubscribe function. */
export async function subscribeRealtime(workspaceId: string, cb: Subscriber): Promise<() => void> {
  const h = hub();
  let set = h.subs.get(workspaceId);
  if (!set) h.subs.set(workspaceId, (set = new Set()));
  set.add(cb);
  if (!h.unlisten) {
    h.unlisten = getDbState()
      .then((s) => s.listen(REALTIME_CHANNEL, dispatch))
      .catch((err) => {
        h.unlisten = null;
        throw err;
      });
  }
  await h.unlisten;
  return () => {
    set.delete(cb);
    if (!set.size) h.subs.delete(workspaceId);
  };
}

/** Number of live subscribers in this process (health/diagnostics). */
export function realtimeSubscriberCount(): number {
  let n = 0;
  for (const s of hub().subs.values()) n += s.size;
  return n;
}
