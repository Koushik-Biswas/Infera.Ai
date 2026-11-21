"use client";

/**
 * Interactive helpers: Tabs, CopyButton, TimeAgo, LoadMore, ErrorState.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { Check, CloudOff, Copy, Lock, RefreshCw, SearchX, TriangleAlert } from "lucide-react";
import { useUI } from "@/components/providers";
import { copyText } from "@/lib/client/browser";
import { errorMessage, errorStatus } from "@/lib/client/errors";
import { ApiClientError } from "@/lib/client/api";
import { formatDateTime, relativeTime } from "@/lib/client/format";
import { ConsoleNavLink } from "../nav-link";
import { Button, buttonCls, type ButtonSize } from "./form";
import { EmptyState } from "./surface";

/* -------------------------------- Tabs ------------------------------ */

/** One tab. Give it `href` for route tabs (rendered as links with `aria-current`), or omit for in-page tabs. */
export type TabItem<V extends string = string> = {
  id: V;
  label: ReactNode;
  count?: number | null;
  icon?: ReactNode;
  href?: string;
  /** API paths warmed on hover/focus (route tabs). */
  prefetchData?: string[];
  disabled?: boolean;
};

/**
 * Tabs in two styles: `underline` (page sections) or `pills` (segmented control, e.g. date ranges).
 * In-page tabs are a `tablist` with roving focus and arrow keys; route tabs (`href`) are a `nav` of links.
 */
export function Tabs<V extends string>({
  items,
  value,
  onChange,
  label,
  variant = "underline",
  size = "md",
  className = "",
}: {
  items: TabItem<V>[];
  value: V;
  onChange?: (v: V) => void;
  label: string;
  variant?: "underline" | "pills";
  size?: "sm" | "md";
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const isNav = items.some((t) => t.href);
  const pills = variant === "pills";
  const wrapCls = pills ? `inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-sunken p-0.5 ring-1 ring-line no-scrollbar` : `flex max-w-full items-center gap-4 overflow-x-auto border-b border-line no-scrollbar sm:gap-6`;
  const tabCls = (active: boolean) =>
    pills
      ? `inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 ${size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]"} ${
          active ? "bg-elev text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg"
        }`
      : `relative inline-flex shrink-0 items-center gap-1.5 pb-2.5 font-medium whitespace-nowrap transition-colors duration-150 ${size === "sm" ? "pt-1 text-[13px]" : "pt-1.5 text-sm"} ${
          active ? "text-fg after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand" : "text-muted hover:text-fg"
        }`;
  const inner = (t: TabItem<V>) => (
    <>
      {t.icon && <span className="[&>svg]:size-4" aria-hidden>{t.icon}</span>}
      {t.label}
      {t.count != null && <span className="rounded-full bg-sunken px-1.5 text-[11px] text-muted tabular-nums ring-1 ring-line">{t.count}</span>}
    </>
  );

  if (isNav) {
    return (
      <nav aria-label={label} className={`${wrapCls} ${className}`}>
        {items.map((t) => (
          <ConsoleNavLink key={t.id} href={t.href ?? "#"} prefetchData={t.prefetchData} activeOverride={t.id === value} pendingIndicator="pulse" className={() => tabCls(t.id === value)}>
            {inner(t)}
          </ConsoleNavLink>
        ))}
      </nav>
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const enabled = items.filter((t) => !t.disabled);
    const i = enabled.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % enabled.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange?.(enabled[next].id);
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${enabled[next].id}"]`)?.focus();
  }

  return (
    <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`${wrapCls} ${className}`}>
      {items.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange?.(t.id)}
            className={`${tabCls(active)} disabled:opacity-50`}
          >
            {inner(t)}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- CopyButton --------------------------- */

/**
 * Copies `value` to the clipboard and confirms inline ("Copied" + tick for 1.6 s, announced to screen readers).
 * `iconOnly` renders a compact round button.
 */
export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  size = "sm",
  variant = "secondary",
  iconOnly,
  className = "",
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  size?: ButtonSize;
  variant?: "secondary" | "ghost" | "primary";
  iconOnly?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const { toast } = useUI();
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    if (await copyText(value)) setCopied(true);
    else toast({ tone: "info", title: "Couldn't copy", body: "Select the text and copy it manually." });
  }

  const icon = copied ? <Check className="text-emerald-600 dark:text-emerald-400" /> : <Copy />;
  return (
    <>
      {iconOnly ? (
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? copiedLabel : label}
          title={copied ? copiedLabel : label}
          className={`grid shrink-0 place-items-center rounded-full text-muted transition-colors duration-150 hover:bg-sunken hover:text-fg ${size === "xs" ? "size-6 [&_svg]:size-3" : "size-8 [&_svg]:size-3.5"} ${className}`}
        >
          {icon}
        </button>
      ) : (
        <button type="button" onClick={copy} className={buttonCls(variant, size, className)}>
          {icon}
          {copied ? copiedLabel : label}
        </button>
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  );
}

/* ------------------------------ TimeAgo ----------------------------- */

// One shared 30-second clock for every TimeAgo on screen.
let clockNow = 0;
const clockSubs = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | undefined;
function subscribeClock(cb: () => void) {
  clockNow = Date.now();
  clockSubs.add(cb);
  if (!clockTimer) {
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const s of clockSubs) s();
    }, 30_000);
  }
  return () => {
    clockSubs.delete(cb);
    if (!clockSubs.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}
const clockSnapshot = () => clockNow || Date.now();
const clockServerSnapshot = () => 0;

/** The current time, ticking every 30 s (0 during server render/hydration). */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, clockSnapshot, clockServerSnapshot);
}

/** Relative time ("5m ago", "in 6d") in a `<time>` element with the full date as tooltip; updates live. */
export function TimeAgo({ date, className = "", fallback = "—" }: { date: string | number | Date | null | undefined; className?: string; fallback?: string }) {
  const now = useNow();
  if (date == null || date === "") return <span className={className}>{fallback}</span>;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return <span className={className}>{fallback}</span>;
  const full = formatDateTime(d);
  return (
    <time dateTime={d.toISOString()} title={full} className={`whitespace-nowrap ${className}`} suppressHydrationWarning>
      {now ? relativeTime(d, now) : full}
    </time>
  );
}

/* ------------------------------ LoadMore ---------------------------- */

/** "Load more" button for cursor lists (pairs with `useCursorList`). Renders nothing when there is nothing more. */
export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
  error,
  label = "Load more",
  className = "",
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => unknown;
  error?: unknown;
  label?: string;
  className?: string;
}) {
  if (!hasMore && !error) return null;
  return (
    <div className={`flex flex-col items-center gap-2 py-4 ${className}`}>
      {error ? <p className="text-xs text-rose-700 dark:text-rose-400">{errorMessage(error)}</p> : null}
      <Button size="sm" pending={loading} onClick={onLoadMore}>
        {error ? "Try again" : label}
      </Button>
    </div>
  );
}

/* ----------------------------- ErrorState --------------------------- */

/**
 * Error panel for failed loads, with a Retry button (pending while `retry` runs).
 * Handles offline, 403 (no access), 404 (not found / feature not available yet) and server errors.
 */
export function ErrorState({
  error,
  retry,
  title,
  compact,
  className = "",
}: {
  error: unknown;
  retry?: () => unknown;
  title?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const status = errorStatus(error);
  const code = error instanceof ApiClientError ? error.code : "";
  const notFound = status === 404;
  const heading =
    title ??
    (code === "network"
      ? "You're offline"
      : status === 403
        ? "You don't have access"
        : notFound
          ? code === "not_found"
            ? "Not found"
            : "Not available yet"
          : "Couldn't load this");
  const icon = code === "network" ? <CloudOff /> : status === 403 ? <Lock /> : notFound ? <SearchX /> : <TriangleAlert />;
  return (
    <div role="alert" className={className}>
      <EmptyState
        compact={compact}
        icon={icon}
        title={heading}
        body={errorMessage(error)}
        action={
          retry && status !== 403 && !(notFound && code === "not_found") ? (
            <Button size="sm" icon={<RefreshCw />} onClick={retry}>
              Try again
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
