/**
 * Layout surfaces for console pages. No hooks — usable from server components
 * (e.g. `loading.tsx`) and client components alike.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

/* ------------------------------- Page ------------------------------- */

/**
 * Page container: centred, padded column for a console page. Wrap every page (and its `loading.tsx`) in it.
 * - `width="default"` (max 72rem) for forms, settings and dashboards;
 * - `width="wide"` (max 100rem) for big tables;
 * - `width="full"` removes padding and max width (split panes like the inbox — size them with `h-[calc(100dvh-…)]`).
 */
export function Page({ children, width = "default", className = "" }: { children: ReactNode; width?: "default" | "wide" | "full"; className?: string }) {
  const w = width === "full" ? "w-full" : `mx-auto w-full px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8 ${width === "wide" ? "max-w-[100rem]" : "max-w-6xl"}`;
  return <div className={`${w} ${className}`}>{children}</div>;
}

/** One breadcrumb: a label and an optional link. */
export type Crumb = { label: ReactNode; href?: string };

/**
 * Page title row: optional breadcrumbs, `<h1>` title, description, meta line and right-aligned actions
 * (actions wrap below the title on small screens).
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  meta,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-6 ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted">
            {breadcrumbs.map((c, i) => (
              <li key={i} className="flex min-w-0 items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />}
                {c.href ? (
                  <Link href={c.href} className="truncate rounded transition-colors duration-150 hover:text-fg">
                    {c.label}
                  </Link>
                ) : (
                  <span className="truncate text-fg-soft" aria-current={i === breadcrumbs.length - 1 ? "page" : undefined}>
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/* ------------------------------- Card ------------------------------- */

/**
 * Elevated surface with an optional header (`title` as `<h2>`, `description`, `actions`) and `footer`.
 * `padded={false}` lets tables run edge to edge.
 */
export function Card({
  title,
  description,
  actions,
  children,
  footer,
  padded = true,
  className = "",
  bodyClassName = "",
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  padded?: boolean;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const hasHeader = title || description || actions;
  return (
    <section id={id} className={`surface min-w-0 overflow-hidden rounded-2xl ${className}`}>
      {hasHeader && (
        <div className={`flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-5 ${padded ? "" : "pb-3"}`}>
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-[15px] font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className={`${padded ? `px-4 pb-4 sm:px-5 ${hasHeader ? "pt-3" : "pt-4"}` : ""} ${bodyClassName}`}>{children}</div>}
      {footer && <div className="border-t border-line bg-sunken/40 px-4 py-3 sm:px-5">{footer}</div>}
    </section>
  );
}

/* ----------------------------- StatCard ----------------------------- */

/** Change vs a previous period: `value` is a fraction (0.12 = +12%). `goodWhen` picks the colour direction. */
export type StatDelta = { value: number; label?: string; goodWhen?: "up" | "down" };

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const w = 100;
  const h = 28;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 2 - (v / max) * (h - 4)] as const);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-7 w-24 overflow-visible" aria-hidden>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="text-muted/60" />
      <circle cx={last[0]} cy={last[1]} r={2.5} className="fill-brand" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * KPI tile: sentence-case `label`, big `value`, optional `delta` (signed %, coloured by direction × goodWhen),
 * `hint` line, `icon`, 12-ish point `trend` sparkline, and `href` to make the whole tile a link.
 */
export function StatCard({
  label,
  value,
  delta,
  hint,
  icon,
  href,
  trend,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: StatDelta | null;
  hint?: ReactNode;
  icon?: ReactNode;
  href?: string;
  trend?: number[];
  className?: string;
}) {
  const up = delta ? delta.value >= 0 : false;
  const good = delta ? (delta.goodWhen === "down" ? !up : up) : false;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-medium text-muted">{label}</p>
        {icon && <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-sunken text-muted [&>svg]:size-4">{icon}</span>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="truncate text-2xl font-semibold tracking-tight text-fg">{value}</p>
        {trend && <Sparkline values={trend} />}
      </div>
      {(delta || hint) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          {delta && (
            <span className={`inline-flex items-center gap-0.5 font-medium ${good ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
              {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
              {`${up ? "+" : "−"}${Math.abs(Math.round(delta.value * 100))}%`}
              {delta.label && <span className="font-normal text-muted">{delta.label}</span>}
            </span>
          )}
          {hint && <span className="truncate">{hint}</span>}
        </div>
      )}
    </>
  );
  const cls = `surface block min-w-0 rounded-2xl p-4 ${className}`;
  return href ? (
    <Link href={href} className={`${cls} transition-[border-color,box-shadow] duration-150 hover:border-line-strong`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/* ----------------------------- KeyValue ----------------------------- */

/** Definition list of label/value pairs in 1–3 columns. */
export function KeyValue({
  items,
  columns = 1,
  className = "",
}: {
  items: { label: ReactNode; value: ReactNode; hint?: ReactNode }[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const cols = columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "";
  return (
    <dl className={`grid gap-x-6 gap-y-3 ${cols} ${className}`}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium text-muted">{it.label}</dt>
          <dd className="mt-0.5 text-sm break-words text-fg">{it.value}</dd>
          {it.hint && <dd className="mt-0.5 text-xs text-muted">{it.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/* ---------------------------- EmptyState ---------------------------- */

/** Friendly empty state: icon, title, body and an optional call to action. `compact` for use inside cards/tables. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  compact,
  className = "",
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`mx-auto flex max-w-md flex-col items-center text-center ${compact ? "px-4 py-8" : "px-6 py-14"} ${className}`}>
      {icon && <span className={`grid place-items-center rounded-2xl bg-brand/10 text-brand ${compact ? "size-10 [&>svg]:size-5" : "size-12 [&>svg]:size-6"}`}>{icon}</span>}
      <p className={`${icon ? "mt-3" : ""} text-[15px] font-semibold text-fg`}>{title}</p>
      {body && <div className="mt-1 text-sm text-muted">{body}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/* ------------------------------ Callout ----------------------------- */

const calloutTone = {
  info: { cls: "border-sky-500/25 bg-sky-500/8", icon: <Info className="text-sky-600 dark:text-sky-400" /> },
  brand: { cls: "border-brand/25 bg-brand/8", icon: <Info className="text-brand" /> },
  success: { cls: "border-emerald-500/25 bg-emerald-500/8", icon: <CircleCheck className="text-emerald-600 dark:text-emerald-400" /> },
  warning: { cls: "border-amber-500/30 bg-amber-500/10", icon: <TriangleAlert className="text-amber-600 dark:text-amber-400" /> },
  danger: { cls: "border-rose-500/30 bg-rose-500/8", icon: <CircleAlert className="text-rose-600 dark:text-rose-400" /> },
} as const;

/** Inline notice with a tone icon (info / brand / success / warning / danger), optional title and action. */
export function Callout({
  tone = "info",
  title,
  children,
  action,
  icon,
  className = "",
}: {
  tone?: keyof typeof calloutTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  const t = calloutTone[tone];
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "note"} className={`flex flex-wrap items-start gap-3 rounded-xl border px-3.5 py-3 text-sm ${t.cls} ${className}`}>
      <span className="mt-0.5 shrink-0 [&>svg]:size-4" aria-hidden>
        {icon ?? t.icon}
      </span>
      <div className="min-w-0 flex-1 basis-48">
        {title && <p className="font-medium text-fg">{title}</p>}
        {children && <div className={`text-fg-soft ${title ? "mt-0.5" : ""}`}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/* ------------------------------ Spinner ----------------------------- */

/** Small inline spinner (inherits text colour). `label` is announced to screen readers. */
export function Spinner({ className = "size-4", label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center">
      <span aria-hidden className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Keyboard key hint, e.g. `<Kbd>/</Kbd>`. */
export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <kbd className={`inline-grid min-w-5 place-items-center rounded-md border border-line bg-sunken px-1 font-sans text-[11px] leading-5 text-muted ${className}`}>{children}</kbd>;
}
