"use client";

/**
 * Collapsible JSON tree with copy. Heavy-ish — import it through `JsonView`
 * from the kit (next/dynamic), not directly.
 */
import { useState, type ReactNode } from "react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { CopyButton } from "./misc";

const PAGE = 100;

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-muted">null</span>;
  if (value === undefined) return <span className="text-muted">undefined</span>;
  if (typeof value === "string") return <span className="break-all text-emerald-700 dark:text-emerald-400">&quot;{value}&quot;</span>;
  if (typeof value === "number") return <span className="text-sky-700 dark:text-sky-400">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="text-violet-700 dark:text-violet-400">{String(value)}</span>;
  return <span className="text-fg">{String(value)}</span>;
}

function Node({ name, value, depth, openDepth, last }: { name: ReactNode; value: unknown; depth: number; openDepth: number; last: boolean }) {
  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < openDepth);
  const [limit, setLimit] = useState(PAGE);
  const comma = last ? "" : ",";
  const key =
    name !== null ? (
      <>
        <span className="text-fg-soft">{name}</span>
        <span className="text-muted">: </span>
      </>
    ) : null;

  if (!isObj) {
    return (
      <div className="pl-4">
        {key}
        <Primitive value={value} />
        <span className="text-muted">{comma}</span>
      </div>
    );
  }

  const entries: [string, unknown][] = isArr ? (value as unknown[]).map((v, i) => [String(i), v]) : Object.entries(value as Record<string, unknown>);
  const [o, c] = isArr ? ["[", "]"] : ["{", "}"];
  if (!entries.length) {
    return (
      <div className="pl-4">
        {key}
        <span className="text-muted">
          {o}
          {c}
          {comma}
        </span>
      </div>
    );
  }
  const shown = entries.slice(0, limit);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group -ml-0.5 inline-flex items-start rounded text-left hover:bg-sunken"
      >
        <ChevronRight className={`mt-[3px] size-3.5 shrink-0 text-muted transition-transform duration-100 ${open ? "rotate-90" : ""}`} aria-hidden />
        <span>
          {key}
          <span className="text-muted">{o}</span>
          {!open && (
            <span className="text-muted">
              {" "}
              {isArr ? `${entries.length} item${entries.length === 1 ? "" : "s"}` : `${entries.length} key${entries.length === 1 ? "" : "s"}`} {c}
              {comma}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="ml-[7px] border-l border-line pl-1">
          {shown.map(([k, v], i) => (
            <Node key={k} name={isArr ? null : JSON.stringify(k)} value={v} depth={depth + 1} openDepth={openDepth} last={i === entries.length - 1} />
          ))}
          {entries.length > limit && (
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="ml-4 rounded px-1 text-brand hover:underline">
              Show {Math.min(PAGE, entries.length - limit)} more of {entries.length - limit}…
            </button>
          )}
        </div>
      )}
      {open && (
        <div className="pl-4">
          <span className="text-muted">
            {c}
            {comma}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * JSON tree viewer: expandable objects/arrays (first `openDepth` levels open), typed colours,
 * expand/collapse all, copy as pretty JSON. Long arrays render 100 entries at a time.
 */
export function JsonViewer({ value, openDepth = 2, maxHeight = "max-h-[28rem]", label = "JSON", className = "" }: { value: unknown; openDepth?: number; maxHeight?: string; label?: string; className?: string }) {
  const [depth, setDepth] = useState(openDepth);
  const [version, setVersion] = useState(0);
  let text = "";
  try {
    text = JSON.stringify(value, null, 2) ?? "undefined";
  } catch {
    text = String(value);
  }
  const setAll = (d: number) => {
    setDepth(d);
    setVersion((v) => v + 1);
  };
  return (
    <div className={`overflow-hidden rounded-xl border border-line bg-sunken/50 ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="text-xs font-medium text-muted">{label}</span>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => setAll(99)} aria-label="Expand all" title="Expand all" className="grid size-7 place-items-center rounded-full text-muted hover:bg-sunken hover:text-fg">
            <ChevronsUpDown className="size-3.5" />
          </button>
          <button type="button" onClick={() => setAll(1)} aria-label="Collapse all" title="Collapse all" className="grid size-7 place-items-center rounded-full text-muted hover:bg-sunken hover:text-fg">
            <ChevronsDownUp className="size-3.5" />
          </button>
          <CopyButton value={text} iconOnly label="Copy JSON" size="xs" />
        </div>
      </div>
      <div className={`overflow-auto px-2 py-2 font-mono text-[12px] leading-5 ${maxHeight}`}>
        <div key={version} className="-ml-3.5 min-w-max">
          <Node name={null} value={value} depth={0} openDepth={depth} last />
        </div>
      </div>
    </div>
  );
}
