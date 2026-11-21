/**
 * Skeletons for console loading states. No hooks — render them straight from
 * `loading.tsx` files. Shapes mirror the real components (PageHeader, Card,
 * StatCard, DataTable) so nothing shifts when data arrives.
 */
import type { ReactNode } from "react";
import { Page } from "./surface";

/** A pulsing placeholder block. Size it with classes (`h-4 w-32`, `size-8 rounded-full`, …). */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-md bg-line ${className}`} />;
}

/** Several lines of placeholder text; the last line is shorter. */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-3.5 ${i === lines - 1 && lines > 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </span>
  );
}

/** Placeholder for `PageHeader` (title, description, optional action buttons). */
export function PageHeaderSkeleton({ actions = 1, breadcrumbs = false }: { actions?: number; breadcrumbs?: boolean }) {
  return (
    <div className="mb-6" aria-hidden>
      {breadcrumbs && <Skeleton className="mb-3 h-3.5 w-40" />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-2.5 h-4 w-full max-w-md" />
        </div>
        {actions > 0 && (
          <div className="flex gap-2">
            {Array.from({ length: actions }, (_, i) => (
              <Skeleton key={i} className="h-9 w-28 rounded-full" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Table rows placeholder (use inside a `Card padded={false}` or on its own). */
export function TableSkeleton({ rows = 8, columns = 4, header = true }: { rows?: number; columns?: number; header?: boolean }) {
  const widths = ["w-2/3", "w-1/2", "w-3/4", "w-1/3", "w-2/5", "w-1/2"];
  return (
    <div aria-hidden className="w-full">
      {header && (
        <div className="flex gap-4 border-b border-line px-4 py-3">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className={c === 0 ? "flex-[2]" : "flex-1"}>
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      )}
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className={c === 0 ? "flex flex-[2] items-center gap-3" : "flex-1"}>
              {c === 0 && <Skeleton className="size-8 shrink-0 rounded-full" />}
              <Skeleton className={`h-3.5 ${widths[(r + c) % widths.length]}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a grid of `StatCard`s. */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="surface rounded-2xl p-4">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-3 h-7 w-20" />
          <Skeleton className="mt-2 h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a `Card` with a title and `lines` of content (or a block of `height`). */
export function CardSkeleton({ lines = 4, height, className = "" }: { lines?: number; height?: string; className?: string }) {
  return (
    <div aria-hidden className={`surface rounded-2xl p-4 sm:p-5 ${className}`}>
      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-2 h-3 w-56 max-w-full" />
      <div className="mt-4">{height ? <Skeleton className={`${height} w-full rounded-xl`} /> : <SkeletonText lines={lines} />}</div>
    </div>
  );
}

/** Placeholder for a settings-style form: labelled fields in cards. */
export function FormSkeleton({ sections = 2, fields = 3 }: { sections?: number; fields?: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      {Array.from({ length: sections }, (_, s) => (
        <div key={s} className="surface rounded-2xl p-4 sm:p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-64 max-w-full" />
          <div className="mt-5 flex flex-col gap-4">
            {Array.from({ length: fields }, (_, f) => (
              <div key={f}>
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="mt-2 h-10 w-full max-w-md rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Whole-page skeletons, wrapped in `Page`:
 * - `table` — header + toolbar + table card (lists);
 * - `cards` — header + grid of cards;
 * - `detail` — header with breadcrumbs + main column + side column;
 * - `dashboard` — header + KPI tiles + chart cards;
 * - `form` — header + form sections (settings);
 * Set `bare` to skip the `Page` wrapper and header (e.g. under a layout that already renders them).
 */
export function PageSkeleton({ variant = "table", bare = false, rows = 8 }: { variant?: "table" | "cards" | "detail" | "dashboard" | "form"; bare?: boolean; rows?: number }) {
  let body: ReactNode;
  switch (variant) {
    case "cards":
      body = (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <CardSkeleton key={i} lines={3} />
          ))}
        </div>
      );
      break;
    case "detail":
      body = (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-4">
            <CardSkeleton lines={6} />
            <CardSkeleton height="h-48" />
          </div>
          <div className="flex flex-col gap-4">
            <CardSkeleton lines={4} />
            <CardSkeleton lines={3} />
          </div>
        </div>
      );
      break;
    case "dashboard":
      body = (
        <div className="flex flex-col gap-4">
          <StatGridSkeleton count={6} />
          <div className="grid gap-4 lg:grid-cols-3">
            <CardSkeleton height="h-64" className="lg:col-span-2" />
            <CardSkeleton lines={7} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <CardSkeleton lines={6} />
            <CardSkeleton lines={6} />
          </div>
        </div>
      );
      break;
    case "form":
      body = <FormSkeleton />;
      break;
    default:
      body = (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" aria-hidden>
            <Skeleton className="h-9 w-full max-w-xs rounded-xl" />
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-full" />
          </div>
          <div className="surface overflow-hidden rounded-2xl">
            <TableSkeleton rows={rows} />
          </div>
        </div>
      );
  }
  if (bare) {
    return (
      <div role="status" aria-label="Loading">
        {body}
      </div>
    );
  }
  return (
    <Page>
      <div role="status" aria-label="Loading">
        <PageHeaderSkeleton breadcrumbs={variant === "detail"} actions={variant === "form" ? 0 : 1} />
        {body}
      </div>
    </Page>
  );
}
