"use client";

/**
 * Cursor pagination on top of `useApi`: the first page is cached (instant when
 * revisiting, stays visible while filters change), further pages are appended
 * with "Load more".
 *
 *   const list = useCursorList<RecordDTO>(`/api/v1/collections/${id}/records${qs({ q })}`);
 *   list.items; list.hasMore; list.loadMore(); list.loadingMore;
 */
import { useState } from "react";
import type { Page } from "@/lib/shared/types";
import { ApiClientError, api, useApi } from "./api";

export type CursorListOptions<T> = {
  /** Stable key used to drop duplicates when pages overlap (default: `item.id`). */
  getKey?: (item: T) => string;
  /** Keep showing the previous list while a new path loads (default true). */
  keepPreviousData?: boolean;
  /** Poll the first page while visible (ms). */
  refreshInterval?: number;
  /** Mirror the first page to sessionStorage (small lists only). */
  persist?: boolean;
};

type Extra<T> = { path: string | null; pages: T[][]; cursor: string | null };

const defaultKey = (item: unknown): string => {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : JSON.stringify(item);
};

function withCursor(path: string, cursor: string) {
  return `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`;
}

/** Paginated list for endpoints returning `Page<T>` (`{ items, nextCursor }`). Pass `null` to skip. */
export function useCursorList<T>(path: string | null, opts: CursorListOptions<T> = {}) {
  const first = useApi<Page<T>>(path, { keepPreviousData: opts.keepPreviousData ?? true, refreshInterval: opts.refreshInterval, persist: opts.persist });
  const [extra, setExtra] = useState<Extra<T>>({ path, pages: [], cursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<ApiClientError | null>(null);

  // A new path (filter/search change) starts from its first page again.
  let state = extra;
  if (extra.path !== path) {
    state = { path, pages: [], cursor: null };
    setExtra(state);
    setLoadMoreError(null);
  }

  const nextCursor = state.pages.length ? state.cursor : (first.data?.nextCursor ?? null);
  const getKey = opts.getKey ?? defaultKey;

  const seen = new Set<string>();
  const items: T[] = [];
  for (const item of [...(first.data?.items ?? []), ...state.pages.flat()]) {
    const k = getKey(item);
    if (seen.has(k)) continue;
    seen.add(k);
    items.push(item);
  }

  async function loadMore() {
    if (!path || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await api<Page<T>>(withCursor(path, nextCursor));
      setExtra((s) => (s.path === path ? { path, pages: [...s.pages, page.items], cursor: page.nextCursor } : s));
    } catch (e) {
      setLoadMoreError(e instanceof ApiClientError ? e : new ApiClientError(0, "unknown", e instanceof Error ? e.message : String(e)));
    } finally {
      setLoadingMore(false);
    }
  }

  async function reload() {
    setExtra({ path, pages: [], cursor: null });
    await first.reload();
  }

  return {
    items,
    /** The raw first page. */
    data: first.data,
    loading: first.loading,
    error: first.error,
    validating: first.validating,
    isPreviousData: first.isPreviousData,
    hasMore: Boolean(nextCursor),
    loadMore,
    loadingMore,
    loadMoreError,
    reload,
  };
}
