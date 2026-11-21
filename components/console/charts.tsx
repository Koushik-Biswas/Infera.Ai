"use client";

/**
 * Hand-built, accessible charts for the console (SVG + CSS, light/dark).
 * Load through next/dynamic so they stay out of route bundles.
 *
 * Colours follow the validated dataviz reference palette (run against the
 * console surfaces #ffffff / #0e0e14): series blue + orange (CVD ΔE ≥ 24),
 * a single-hue ordinal blue ramp for priorities. Text always wears text
 * tokens; marks carry the colour.
 */
import { useEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Table2, LineChart } from "lucide-react";
import { PRIORITIES, type Priority } from "@/lib/shared/types";
import { PRIORITY_LABELS, formatNumber, formatPercent } from "@/lib/client/format";

/** CSS custom properties for chart colours, light + dark (applied on each chart root). */
const VIZ_VARS =
  "[--viz-1:#2a78d6] [--viz-2:#eb6834] dark:[--viz-1:#3987e5] dark:[--viz-2:#d95926] " +
  "[--viz-p-low:#86b6ef] [--viz-p-medium:#3987e5] [--viz-p-high:#1c5cab] [--viz-p-urgent:#0d366b] " +
  "dark:[--viz-p-low:#184f95] dark:[--viz-p-medium:#256abf] dark:[--viz-p-high:#5598e7] dark:[--viz-p-urgent:#9ec5f4]";

/** Width of an element, tracked with ResizeObserver (0 until measured). */
function useElementWidth<T extends HTMLElement>() {
  // Callback ref: re-observes when the element remounts (e.g. after the table view).
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/** Clean integer tick step (1, 2, 5 × 10ⁿ) for counts. */
function niceStep(max: number, count = 4) {
  if (max <= 0) return 1;
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  return Math.max(1, Math.round(step));
}

const dayLabel = (d: string) => {
  const date = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/* --------------------------- Activity chart --------------------------- */

export type DailyPoint = { date: string; messages: number; records: number };

const SERIES = [
  { key: "messages" as const, label: "Messages", color: "var(--viz-1)" },
  { key: "records" as const, label: "Records", color: "var(--viz-2)" },
];

/**
 * Messages and records per day: two 2px lines on one axis, crosshair + tooltip on hover and keyboard
 * (←/→), legend with totals, and a table view toggle. Fixed 256px tall (matches its loading skeleton).
 */
export function ActivityChart({ data, dimmed }: { data: DailyPoint[]; dimmed?: boolean }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");

  const height = 220;
  const m = { top: 10, right: 12, bottom: 26, left: 40 };
  const w = Math.max(0, width - m.left - m.right);
  const h = height - m.top - m.bottom;
  const n = data.length;
  const max = Math.max(0, ...data.map((d) => Math.max(d.messages, d.records)));
  const step = niceStep(max);
  const yMax = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= yMax; v += step) ticks.push(v);
  const x = (i: number) => m.left + (n <= 1 ? w / 2 : (i * w) / (n - 1));
  const y = (v: number) => m.top + h - (v / yMax) * h;
  const totals = { messages: data.reduce((s, d) => s + d.messages, 0), records: data.reduce((s, d) => s + d.records, 0) };

  const labelCount = Math.max(2, Math.min(n, Math.floor(w / 72)));
  const labelIdx = n <= 1 ? [0] : [...new Set(Array.from({ length: labelCount }, (_, k) => Math.round((k * (n - 1)) / (labelCount - 1))))];

  const path = (key: "messages" | "records") => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const area = n > 1 ? `${path("messages")} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : "";

  function onMove(e: PointerEvent<SVGRectElement>) {
    if (n === 0) return;
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = n <= 1 ? 0 : Math.round(((px - m.left) / w) * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, i)));
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!n) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive((cur) => {
        const c = cur ?? n - 1;
        if (e.key === "Home") return 0;
        if (e.key === "End") return n - 1;
        return Math.max(0, Math.min(n - 1, c + (e.key === "ArrowRight" ? 1 : -1)));
      });
    } else if (e.key === "Escape") setActive(null);
  }

  const a = active != null ? data[active] : null;
  const tipLeft = active != null ? x(active) : 0;
  const tipOnLeft = active != null && tipLeft > width / 2;
  const empty = max === 0;

  return (
    <div className={`flex flex-col gap-3 ${VIZ_VARS}`}>
      <div className="flex h-6 items-center justify-between gap-3">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="Legend">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
              <span className="text-fg-soft">{s.label}</span>
              <span className="font-medium text-fg tabular-nums">{formatNumber(totals[s.key])}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
          className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs text-muted transition-colors duration-150 hover:bg-sunken hover:text-fg"
          aria-pressed={view === "table"}
        >
          {view === "chart" ? <Table2 className="size-3.5" aria-hidden /> : <LineChart className="size-3.5" aria-hidden />}
          {view === "chart" ? "Table" : "Chart"}
        </button>
      </div>

      {view === "table" ? (
        <div className="h-[220px] overflow-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">Messages and records per day</caption>
            <thead className="sticky top-0 bg-elev">
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Date
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Messages
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Records
                </th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5 text-fg-soft">{dayLabel(d.date)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(d.messages)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(d.records)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={ref}
          role="group"
          tabIndex={0}
          aria-label={`Messages and records per day over ${n} days. Totals: ${formatNumber(totals.messages)} messages, ${formatNumber(totals.records)} records. Use the left and right arrow keys to read each day.`}
          onKeyDown={onKey}
          onFocus={() => setActive((c) => c ?? (n ? n - 1 : null))}
          onBlur={() => setActive(null)}
          className={`relative h-[220px] rounded-lg transition-opacity duration-150 ${dimmed ? "opacity-60" : ""}`}
        >
          {width > 0 && (
            <svg width={width} height={height} className="block overflow-visible" aria-hidden>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={m.left} x2={m.left + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--border-strong)" : "var(--border)"} strokeWidth={1} shapeRendering="crispEdges" />
                  <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                    {formatNumber(t, { compact: true })}
                  </text>
                </g>
              ))}
              {labelIdx.map((i) => (
                <text key={i} x={x(i)} y={height - 6} textAnchor={n <= 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-muted text-[11px]">
                  {data[i] ? dayLabel(data[i].date) : ""}
                </text>
              ))}
              {area && <path d={area} fill="var(--viz-1)" opacity={0.1} />}
              {n > 0 &&
                SERIES.map((s) => <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
              {n === 1 &&
                SERIES.map((s) => <circle key={s.key} cx={x(0)} cy={y(data[0][s.key])} r={4} fill={s.color} stroke="var(--bg-elev)" strokeWidth={2} />)}
              {active != null && a && (
                <g>
                  <line x1={x(active)} x2={x(active)} y1={m.top} y2={m.top + h} stroke="var(--border-strong)" strokeWidth={1} shapeRendering="crispEdges" />
                  {SERIES.map((s) => (
                    <circle key={s.key} cx={x(active)} cy={y(a[s.key])} r={4} fill={s.color} stroke="var(--bg-elev)" strokeWidth={2} />
                  ))}
                </g>
              )}
              <rect x={m.left} y={m.top} width={w} height={h} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setActive(null)} />
            </svg>
          )}
          {empty && width > 0 && <p className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-sm text-muted">No messages in this period yet.</p>}
          {a && active != null && (
            <div
              className="surface-lg pointer-events-none absolute top-2 z-10 min-w-36 rounded-xl px-3 py-2 text-xs"
              style={{ left: tipLeft, transform: tipOnLeft ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
            >
              <p className="mb-1 font-medium text-muted">{dayLabel(a.date)}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="flex items-center gap-2">
                  <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                  <span className="font-semibold text-fg tabular-nums">{formatNumber(a[s.key])}</span>
                  <span className="text-muted">{s.label.toLowerCase()}</span>
                </p>
              ))}
            </div>
          )}
          <p className="sr-only" aria-live="polite">
            {a ? `${dayLabel(a.date)}: ${a.messages} messages, ${a.records} records` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Bar list ------------------------------ */

export type BarItem = { key: string; label: string; value: number; icon?: ReactNode };

/**
 * Ranked horizontal bars (single series → one colour). Thin 10px bars, 4px rounded data end, square at the
 * baseline, value printed at the tip. Every value is visible, so no tooltip gates information.
 */
export function BarList({ items, label, limit = 8, dimmed }: { items: BarItem[]; label: string; limit?: number; dimmed?: boolean }) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  if (rest.length) shown.push({ key: "__other", label: `Other (${rest.length})`, value: rest.reduce((s, r) => s + r.value, 0) });
  const max = Math.max(1, ...shown.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <ul aria-label={label} className={`flex flex-col gap-1 transition-opacity duration-150 ${VIZ_VARS} ${dimmed ? "opacity-60" : ""}`}>
      {shown.map((it) => {
        const pct = it.value / max;
        return (
          <li
            key={it.key}
            className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-center gap-3 rounded-lg px-1.5 py-1 hover:bg-sunken/70"
            title={`${it.label}: ${formatNumber(it.value)} (${formatPercent(total ? it.value / total : 0)})`}
          >
            <span className="flex min-w-0 items-center gap-2 text-[13px] text-fg-soft">
              {it.icon}
              <span className="truncate">{it.label}</span>
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="h-2.5 shrink-0 rounded-r-[4px]" style={{ width: it.value > 0 ? `max(3px, calc(${pct.toFixed(4)} * (100% - 3.5rem)))` : 0, background: "var(--viz-1)" }} />
              <span className="text-xs font-medium text-fg tabular-nums">{formatNumber(it.value)}</span>
              <span className="sr-only">{`, ${formatPercent(total ? it.value / total : 0)} of total`}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* --------------------------- Priority split --------------------------- */

const PRIORITY_FILL: Record<Priority, { fill: string; ink: string }> = {
  low: { fill: "var(--viz-p-low)", ink: "text-[#0b0b0b] dark:text-white" },
  medium: { fill: "var(--viz-p-medium)", ink: "text-white" },
  high: { fill: "var(--viz-p-high)", ink: "text-white dark:text-[#0b0b0b]" },
  urgent: { fill: "var(--viz-p-urgent)", ink: "text-white dark:text-[#0b0b0b]" },
};

/**
 * Part-to-whole split of message priorities as a tall (28px) segmented bar with an ordinal single-hue ramp
 * (low → urgent), shares printed inside segments wide enough to hold them, and a legend with counts.
 */
export function PrioritySplit({ data, dimmed }: { data: { priority: Priority; count: number }[]; dimmed?: boolean }) {
  const counts = PRIORITIES.map((p) => ({ priority: p, count: data.find((d) => d.priority === p)?.count ?? 0 }));
  const total = counts.reduce((s, c) => s + c.count, 0);
  const summary = counts.map((c) => `${PRIORITY_LABELS[c.priority]} ${c.count} (${formatPercent(total ? c.count / total : 0)})`).join(", ");
  const [barRef, barWidth] = useElementWidth<HTMLDivElement>();
  const visible = counts.filter((c) => c.count > 0);
  const usable = Math.max(0, barWidth - 2 * (visible.length - 1));
  return (
    <div className={`flex flex-col gap-3 transition-opacity duration-150 ${VIZ_VARS} ${dimmed ? "opacity-60" : ""}`}>
      <div ref={barRef} role="img" aria-label={total ? `Priority split: ${summary}` : "No classified messages yet"} className="flex h-7 w-full gap-[2px]">
        {total === 0 ? (
          <div className="grid flex-1 place-items-center rounded-[4px] bg-sunken text-xs text-muted">No classified messages yet</div>
        ) : (
          visible.map((c) => {
              const share = c.count / total;
              const s = PRIORITY_FILL[c.priority];
              return (
                <div
                  key={c.priority}
                  title={`${PRIORITY_LABELS[c.priority]}: ${formatNumber(c.count)} (${formatPercent(share)})`}
                  className={`flex min-w-[3px] items-center rounded-[4px] px-2 text-[11px] font-medium ${s.ink}`}
                  style={{ flexGrow: c.count, flexBasis: 0, background: s.fill }}
                >
                  {/* Only print the share when it fits with padding (measured); otherwise legend + tooltip carry it. */}
                  {share * usable >= 46 && <span className="whitespace-nowrap tabular-nums">{formatPercent(share)}</span>}
                </div>
              );
            })
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-label="Priority legend">
        {counts.map((c) => (
          <li key={c.priority} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: PRIORITY_FILL[c.priority].fill }} />
            <span className="text-fg-soft">{PRIORITY_LABELS[c.priority]}</span>
            <span className="font-medium text-fg tabular-nums">{formatNumber(c.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
