/**
 * Live updates in the browser: one shared EventSource per tab on
 * /api/v1/stream, which refreshes cached API data the moment something
 * changes on the server (new message, record update, review, channel status).
 *
 *   useRealtime();                                  // mount once (console shell) — auto cache invalidation
 *   useRealtimeEvent((e) => { ... }, ["message.received"]);  // react to specific events (toasts, highlights)
 *   const live = useRealtimeStatus();               // "connecting" | "live" | "offline" for a status dot
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { RealtimeEvent } from "@/lib/shared/types";
import { invalidate } from "./api";

type Status = "connecting" | "live" | "offline";
type Handler = (e: RealtimeEvent) => void;

const EVENT_TYPES = [
  "message.received",
  "message.processed",
  "record.created",
  "record.updated",
  "record.status_changed",
  "record.deleted",
  "review.created",
  "review.resolved",
  "channel.status",
  "job.progress",
] as const;

/** Which cached API paths each event makes stale. */
const INVALIDATES: Record<string, string[]> = {
  "message.received": ["/api/v1/conversations", "/api/v1/events", "/api/v1/analytics", "/api/v1/contacts"],
  "message.processed": ["/api/v1/conversations", "/api/v1/events", "/api/v1/messages", "/api/v1/analytics"],
  "record.created": ["/api/v1/collections", "/api/v1/records", "/api/v1/analytics"],
  "record.updated": ["/api/v1/collections", "/api/v1/records"],
  "record.status_changed": ["/api/v1/collections", "/api/v1/records", "/api/v1/analytics"],
  "record.deleted": ["/api/v1/collections", "/api/v1/records", "/api/v1/analytics"],
  "review.created": ["/api/v1/review", "/api/v1/notifications"],
  "review.resolved": ["/api/v1/review", "/api/v1/events"],
  // Sync progress (history imports emit no message.received): refresh chats too.
  "channel.status": ["/api/v1/channels", "/api/v1/conversations"],
};

let source: EventSource | null = null;
let refs = 0;
let status: Status = "offline";
const handlers = new Set<Handler>();
const statusListeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Set<string>();

function setStatus(s: Status) {
  if (status === s) return;
  status = s;
  for (const l of statusListeners) l();
}

/** Coalesce bursts (e.g. 50 messages from a history sync) into one refetch per path every 300 ms. */
function scheduleInvalidate(paths: string[]) {
  for (const p of paths) pending.add(p);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const list = [...pending];
    pending.clear();
    for (const p of list) invalidate(p);
  }, 300);
}

function open() {
  if (source || typeof window === "undefined" || typeof EventSource === "undefined") return;
  setStatus("connecting");
  const es = new EventSource("/api/v1/stream");
  source = es;
  es.addEventListener("ready", () => setStatus("live"));
  es.onerror = () => {
    // EventSource reconnects by itself (retry: 3000). 401s end the stream: stop trying.
    setStatus(es.readyState === EventSource.CLOSED ? "offline" : "connecting");
  };
  for (const type of EVENT_TYPES) {
    es.addEventListener(type, (msg) => {
      let e: RealtimeEvent;
      try {
        e = JSON.parse((msg as MessageEvent<string>).data) as RealtimeEvent;
      } catch {
        return;
      }
      const paths = INVALIDATES[e.type];
      if (paths) scheduleInvalidate(e.type === "channel.status" && e.data.channelId ? [...paths] : paths);
      for (const h of handlers) {
        try {
          h(e);
        } catch {
          /* ignore handler errors */
        }
      }
    });
  }
}

function close() {
  source?.close();
  source = null;
  setStatus("offline");
}

/** Keep the live connection open while mounted (ref-counted across components). */
export function useRealtime() {
  useEffect(() => {
    refs++;
    open();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !source) open();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      refs--;
      if (refs <= 0) {
        refs = 0;
        close();
      }
    };
  }, []);
}

/** Run `handler` for live events (optionally only the given types). Does not open the connection by itself. */
export function useRealtimeEvent(handler: Handler, types?: readonly RealtimeEvent["type"][]) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const key = types?.join(",") ?? "";
  useEffect(() => {
    const allow = key ? new Set(key.split(",")) : null;
    const h: Handler = (e) => {
      if (!allow || allow.has(e.type)) ref.current(e);
    };
    handlers.add(h);
    return () => {
      handlers.delete(h);
    };
  }, [key]);
}

export function useRealtimeStatus(): Status {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    () => status,
    () => "offline",
  );
}
