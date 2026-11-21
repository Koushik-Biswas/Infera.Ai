"use client";

/**
 * DataTable: semantic, responsive table with clickable rows, intent prefetch,
 * skeleton rows while loading and a dimmed state while a new page/filter loads.
 */
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "./skeleton";

/** Column definition for `DataTable`. */
export type Column<T> = {
  /** Unique key (also used for React keys). */
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  /** Width class for the column, e.g. "w-40". */
  width?: string;
  /** Extra classes for body cells. */
  className?: string;
  headerClassName?: string;
  /** Hide on small screens. */
  hideBelow?: "sm" | "md" | "lg";
  /** Visually hide the header text (still read by screen readers), e.g. for action columns. */
  srHeader?: boolean;
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  /** Row activation (click / Enter). Clicks on links, buttons and inputs inside the row are ignored. */
  onRowClick?: (row: T, e: MouseEvent | KeyboardEvent) => void;
  /** Hover/focus intent — prefetch the detail view (`prefetchApi(detailPath)`). */
  onRowIntent?: (row: T) => void;
  /** Navigate to this URL on activation (Ctrl/⌘-click opens a new tab); the route is prefetched on intent. */
  rowHref?: (row: T) => string | null | undefined;
  /** Show skeleton rows (first load). */
  loading?: boolean;
  skeletonRows?: number;
  /** Rendered in place of the body when `rows` is empty. */
  empty?: ReactNode;
  /** Fade the rows (e.g. `isPreviousData` while a new filter loads). */
  dimmed?: boolean;
  /** Accessible caption (visually hidden). */
  caption?: string;
  rowClassName?: (row: T) => string;
  /** Highlights the row with this key (`aria-current`). */
  selectedKey?: string | null;
  dense?: boolean;
  className?: string;
};

const hideCls = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;
const alignCls = { left: "text-left", right: "text-right", center: "text-center" } as const;

function fromInteractive(e: MouseEvent | KeyboardEvent) {
  const target = e.target as HTMLElement;
  const hit = target.closest("a,button,input,select,textarea,label,summary,[role=menuitem],[data-row-stop]");
  return Boolean(hit && hit !== e.currentTarget && (e.currentTarget as HTMLElement).contains(hit));
}

/** Data table. Wrap it in `<Card padded={false}>` for the standard framed look. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  onRowIntent,
  rowHref,
  loading,
  skeletonRows = 6,
  empty,
  dimmed,
  caption,
  rowClassName,
  selectedKey,
  dense,
  className = "",
}: DataTableProps<T>) {
  const router = useRouter();
  const clickable = Boolean(onRowClick || rowHref);
  const pad = dense ? "px-3 py-2" : "px-4 py-3";

  function activate(row: T, e: MouseEvent | KeyboardEvent) {
    if (fromInteractive(e)) return;
    const href = rowHref?.(row);
    if (href) {
      if ("metaKey" in e && (e.metaKey || e.ctrlKey)) window.open(href, "_blank", "noopener");
      else router.push(href);
    }
    onRowClick?.(row, e);
  }

  function intent(row: T) {
    onRowIntent?.(row);
    const href = rowHref?.(row);
    if (href) router.prefetch(href);
  }

  const showSkeleton = loading && !rows?.length;
  const isEmpty = !showSkeleton && rows !== undefined && rows.length === 0;

  return (
    <div className={`w-full overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`${pad} py-2.5 text-xs font-medium whitespace-nowrap text-muted ${alignCls[c.align ?? "left"]} ${c.width ?? ""} ${c.hideBelow ? hideCls[c.hideBelow] : ""} ${c.headerClassName ?? ""}`}
              >
                {c.srHeader ? <span className="sr-only">{c.header}</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={`transition-opacity duration-150 ${dimmed ? "opacity-60" : ""}`} aria-busy={dimmed || showSkeleton || undefined}>
          {showSkeleton &&
            Array.from({ length: skeletonRows }, (_, r) => (
              <tr key={`s${r}`} className="border-b border-line last:border-0" aria-hidden>
                {columns.map((c, i) => (
                  <td key={c.key} className={`${pad} ${c.hideBelow ? hideCls[c.hideBelow] : ""}`}>
                    <Skeleton className={`h-3.5 ${i === 0 ? "w-3/4" : (r + i) % 2 ? "w-1/2" : "w-2/3"}`} />
                  </td>
                ))}
              </tr>
            ))}
          {isEmpty && (
            <tr>
              <td colSpan={columns.length}>{empty ?? <p className="px-4 py-10 text-center text-sm text-muted">Nothing here yet.</p>}</td>
            </tr>
          )}
          {!showSkeleton &&
            rows?.map((row, i) => {
              const key = rowKey(row);
              const selected = selectedKey != null && selectedKey === key;
              return (
                <tr
                  key={key}
                  tabIndex={clickable ? 0 : undefined}
                  aria-current={selected || undefined}
                  onClick={clickable ? (e) => activate(row, e) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                            e.preventDefault();
                            activate(row, e);
                          }
                        }
                      : undefined
                  }
                  onMouseEnter={onRowIntent || rowHref ? () => intent(row) : undefined}
                  onFocus={onRowIntent || rowHref ? () => intent(row) : undefined}
                  className={`border-b border-line transition-colors duration-100 last:border-0 ${clickable ? "cursor-pointer outline-none hover:bg-sunken/70 focus-visible:bg-sunken focus-visible:shadow-[inset_2px_0_0_var(--brand)]" : ""} ${
                    selected ? "bg-brand/6 shadow-[inset_2px_0_0_var(--brand)]" : ""
                  } ${rowClassName?.(row) ?? ""}`}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`${pad} align-middle ${alignCls[c.align ?? "left"]} ${c.hideBelow ? hideCls[c.hideBelow] : ""} ${c.className ?? ""}`}>
                      {c.cell(row, i)}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
