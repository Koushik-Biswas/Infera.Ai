/**
 * Browser client for the Infera REST API (same-origin, cookie session), with a
 * small stale-while-revalidate cache built for instant navigation:
 *
 *   const { data, error, loading, validating, reload } = useApi<Page<RecordDTO>>(`/api/v1/collections/${id}/records`, { keepPreviousData: true });
 *   await api<RecordDTO>(`/api/v1/records/${id}`, { method: "PATCH", body: { values, expectedVersion } });
 *   invalidate("/api/v1/collections");   // refetch cached paths starting with this
 *   prefetchApi("/api/v1/review/count"); // warm the cache on hover/intent → the next page renders instantly
 *
 * Performance properties:
 *  - Cached data renders immediately; a background revalidation runs when it is older than `staleMs` (default 5 s).
 *  - Identical in-flight requests are de-duplicated.
 *  - Subscriptions are per path: an update re-renders only components using that path.
 *  - `keepPreviousData` keeps showing the last result while a new page/filter loads (no flash of skeletons).
 *  - `persist` mirrors small, frequently used responses to sessionStorage so a reload paints instantly.
 *  - Mounted paths revalidate when the tab regains focus or the network comes back.
 *
 * 401 responses redirect to /login (except on the auth pages themselves).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ApiErrorBody } from "@/lib/shared/types";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Opts = { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: { Accept: "application/json", ...(opts.body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}), ...opts.headers },
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new ApiClientError(0, "network", "Can't reach Infera. Check your connection.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as Partial<ApiErrorBody> | { error?: string } | null)?.error;
    const message = typeof err === "string" ? err : (err?.message ?? `Request failed (${res.status}).`);
    const code = typeof err === "object" && err?.code ? err.code : String(res.status);
    if (res.status === 401 && typeof window !== "undefined" && !/^\/(login|signup|invite)/.test(window.location.pathname)) {
      clearApiCache();
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new ApiClientError(res.status, code, message, typeof err === "object" ? err?.details : undefined);
  }
  return data as T;
}

/* ------------------------------ Cache ------------------------------ */

type Entry = { data?: unknown; error?: ApiClientError; at: number; inflight?: Promise<void> };

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const mounted = new Map<string, number>();
const persistKeys = new Set<string>();
const PERSIST_PREFIX = "infera:api:";
const PERSIST_MAX_CHARS = 200_000;
const DEFAULT_STALE_MS = 5_000;

const isBrowser = () => typeof window !== "undefined";

function emit(path: string) {
  const ls = listeners.get(path);
  if (ls) for (const l of ls) l();
}

function setEntry(path: string, entry: Entry) {
  cache.set(path, entry);
  emit(path);
}

function readPersisted(path: string): Entry | undefined {
  if (!isBrowser()) return undefined;
  try {
    const raw = sessionStorage.getItem(PERSIST_PREFIX + path);
    if (!raw) return undefined;
    const { data } = JSON.parse(raw) as { data: unknown };
    // at: 0 → considered stale, so it is shown instantly and revalidated right away.
    return { data, at: 0 };
  } catch {
    return undefined;
  }
}

function writePersisted(path: string, data: unknown) {
  if (!isBrowser() || !persistKeys.has(path)) return;
  try {
    const s = JSON.stringify({ data });
    if (s.length <= PERSIST_MAX_CHARS) sessionStorage.setItem(PERSIST_PREFIX + path, s);
  } catch {
    /* quota or private mode — ignore */
  }
}

function getEntry(path: string): Entry | undefined {
  let e = cache.get(path);
  if (!e && persistKeys.has(path)) {
    e = readPersisted(path);
    if (e) cache.set(path, e);
  }
  return e;
}

function load(path: string): Promise<void> {
  const entry = getEntry(path) ?? { at: 0 };
  if (entry.inflight) return entry.inflight;
  const inflight = api(path)
    .then((data) => {
      setEntry(path, { data, at: Date.now() });
      writePersisted(path, data);
    })
    .catch((error: unknown) => {
      const err = error instanceof ApiClientError ? error : new ApiClientError(0, "unknown", error instanceof Error ? error.message : String(error));
      setEntry(path, { data: cache.get(path)?.data, error: err, at: Date.now() });
    });
  // Emit so subscribers can show `validating` (load() is only called from effects/events, never during render).
  setEntry(path, { ...entry, inflight });
  return inflight;
}

/** Refetch every cached path starting with `prefix` (call after mutations). */
export function invalidate(prefix: string) {
  for (const key of [...cache.keys()]) {
    if (!key.startsWith(prefix)) continue;
    if (mounted.get(key)) void load(key);
    else {
      // Not on screen: just mark stale so the next mount refetches.
      const e = cache.get(key);
      if (e) cache.set(key, { ...e, at: 0 });
    }
  }
}

/** Replace cached data locally (optimistic updates). */
export function setCached<T>(path: string, updater: (prev: T | undefined) => T) {
  const e = getEntry(path);
  const data = updater(e?.data as T | undefined);
  setEntry(path, { ...(e ?? { at: Date.now() }), data, error: undefined });
  writePersisted(path, data);
}

/** Read cached data without subscribing (e.g. to seed a detail view from a list). */
export function peekCached<T>(path: string): T | undefined {
  return getEntry(path)?.data as T | undefined;
}

/**
 * Warm the cache for `path` (hover/focus/touch intent, or right after a mutation).
 * No-op when fresh data or a request is already there.
 */
export function prefetchApi(path: string | null | undefined, maxAgeMs = 10_000) {
  if (!path || !isBrowser()) return;
  const e = getEntry(path);
  if (e?.inflight || (e?.data !== undefined && Date.now() - e.at < maxAgeMs)) return;
  void load(path);
}

/** Forget everything (logout / workspace switch). */
export function clearApiCache() {
  cache.clear();
  if (!isBrowser()) return;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PERSIST_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
  for (const key of listeners.keys()) emit(key);
}

/* Revalidate on focus / reconnect (once per page). */
if (isBrowser()) {
  const revalidateMounted = () => {
    for (const [key, count] of mounted) {
      if (!count) continue;
      const e = cache.get(key);
      if (!e || Date.now() - e.at > DEFAULT_STALE_MS) void load(key);
    }
  };
  window.addEventListener("focus", revalidateMounted);
  window.addEventListener("online", revalidateMounted);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") revalidateMounted();
  });
}

/* ------------------------------ Hooks ------------------------------ */

export type UseApiOptions = {
  /** Poll while visible (ms). */
  refreshInterval?: number;
  /** Keep returning the previous path's data while a new path loads (pagination, filters, search). */
  keepPreviousData?: boolean;
  /** Mirror to sessionStorage for an instant first paint after reload. Small responses only. */
  persist?: boolean;
  /** Revalidate on mount when older than this (default 5 s). Use Infinity for data that rarely changes. */
  staleMs?: number;
};

export function useApi<T>(path: string | null, opts: UseApiOptions = {}) {
  if (path && opts.persist) persistKeys.add(path);

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!path) return () => {};
      let set = listeners.get(path);
      if (!set) listeners.set(path, (set = new Set()));
      set.add(cb);
      return () => {
        set.delete(cb);
        if (!set.size) listeners.delete(path);
      };
    },
    [path],
  );
  const entry = useSyncExternalStore(
    subscribe,
    () => (path ? getEntry(path) : undefined),
    () => undefined,
  );

  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  useEffect(() => {
    if (!path) return;
    mounted.set(path, (mounted.get(path) ?? 0) + 1);
    const e = getEntry(path);
    if (!e || (!e.inflight && Date.now() - e.at > staleMs)) void load(path);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (opts.refreshInterval) {
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void load(path);
      }, opts.refreshInterval);
    }
    return () => {
      if (timer) clearInterval(timer);
      const n = (mounted.get(path) ?? 1) - 1;
      if (n <= 0) mounted.delete(path);
      else mounted.set(path, n);
    };
  }, [path, opts.refreshInterval, staleMs]);

  const previous = useRef<unknown>(undefined);
  if (entry?.data !== undefined) previous.current = entry.data;

  const reload = useCallback(async () => {
    if (path) await load(path);
  }, [path]);

  const hasData = entry?.data !== undefined;
  const data = (hasData ? entry?.data : opts.keepPreviousData ? previous.current : undefined) as T | undefined;
  return {
    data,
    error: entry?.error,
    /** No data to show yet (first load). */
    loading: Boolean(path) && data === undefined && !entry?.error,
    /** A request is in flight (initial load or background revalidation). */
    validating: Boolean(entry?.inflight),
    /** Showing data from a previous path while the current one loads. */
    isPreviousData: !hasData && data !== undefined,
    reload,
  };
}

/** Run a mutation with pending/error state. */
export function useMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fnRef.current(...args);
    } catch (e) {
      setError(e instanceof ApiClientError ? e : new ApiClientError(0, "unknown", e instanceof Error ? e.message : String(e)));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);
  return { run, pending, error, clearError: () => setError(null) };
}

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** Debounced value — for search boxes so typing doesn't fire a request per keystroke. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
