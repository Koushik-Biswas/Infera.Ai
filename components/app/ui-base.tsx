"use client";

/** Motion-free UI helpers (shared by the offline app and the console). Animated Modal/Menu live in ./ui. */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Calendar,
  Contact,
  FolderOpen,
  Home,
  Link as LinkIcon,
  LifeBuoy,
  ListChecks,
  Package,
  ShoppingBag,
  Star,
  Table,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { statusTone } from "@/lib/app/templates";
import type { CellValue, Field } from "@/lib/app/types";

/* ------------------------------ Routing ----------------------------- */

export type Route = { path: string[]; query: URLSearchParams };

function parseHash(): Route {
  const raw = typeof window === "undefined" ? "" : window.location.hash.replace(/^#\/?/, "");
  const [p, q = ""] = raw.split("?");
  return { path: p.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>({ path: [], query: new URLSearchParams() });
  useEffect(() => {
    const on = () => setRoute(parseHash());
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function go(to: string, replace = false) {
  const h = "#/" + to.replace(/^[#/]+/, "");
  if (replace) history.replaceState(null, "", h);
  else history.pushState(null, "", h);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/* ----------------------------- Formatting --------------------------- */

export function money(n: number, currency = "INR") {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return String(n);
  }
}

export function shortDate(iso: string) {
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function chatTime(t: number) {
  const d = new Date(t);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function dayLabel(t: number) {
  const d = new Date(t);
  const days = Math.floor((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: days < 7 ? "long" : undefined, day: "numeric", month: "long", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export const clockTime = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function bytes(n?: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function displayValue(f: Field, v: CellValue, currency: string): string {
  if (v == null || v === "") return "";
  if (f.type === "currency" && typeof v === "number") return money(v, currency);
  if (f.type === "date") return shortDate(String(v));
  return String(v);
}

/* ------------------------------- Icons ------------------------------ */

export const collectionIcons: Record<string, LucideIcon> = {
  "shopping-bag": ShoppingBag,
  users: Users,
  wallet: Wallet,
  package: Package,
  "list-checks": ListChecks,
  "life-buoy": LifeBuoy,
  contact: Contact,
  "folder-open": FolderOpen,
  link: LinkIcon,
  table: Table,
  home: Home,
  calendar: Calendar,
  truck: Truck,
  star: Star,
};

export function CollectionIcon({ icon, className = "size-4" }: { icon: string; className?: string }) {
  const I = collectionIcons[icon] ?? Table;
  return <I className={className} />;
}

/* ------------------------------ Pieces ------------------------------ */

export function Status({ value, className = "" }: { value: string; className?: string }) {
  const t = statusTone(value);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${t.bg} ${className}`}>
      <span className={`size-1.5 rounded-full ${t.dot}`} aria-hidden />
      {value}
    </span>
  );
}

export function Avatar({ name, color, className = "size-10 text-sm" }: { name: string; color?: string; className?: string }) {
  const initials =
    name
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0])
      .join("")
      .toUpperCase() || "#";
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${className}`}
      style={{ background: color ? `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 70%, black))` : `hsl(${hue} 60% 50%)` }}
    >
      {initials}
    </span>
  );
}

export function IconBtn({ label, onClick, children, className = "", active }: { label: string; onClick?: () => void; children: ReactNode; className?: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid size-9 shrink-0 place-items-center rounded-full text-fg-soft transition hover:bg-sunken hover:text-fg ${active ? "bg-sunken text-fg" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition ${
        active ? "bg-fg text-bg" : "bg-sunken text-fg-soft ring-1 ring-line hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-brand/10 text-brand">{icon}</span>
      <p className="mt-4 text-base font-semibold">{title}</p>
      {body && <p className="mt-1.5 text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition ${on ? "bg-brand" : "bg-line-strong"}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

/** Renders the assistant's light markdown: **bold**, "- " bullets, paragraphs. */
export function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong> : part));
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        const bullets = lines.filter((l) => /^\s*[-•]\s/.test(l));
        if (bullets.length && bullets.length >= lines.length - 1) {
          const lead = lines.find((l) => !/^\s*[-•]\s/.test(l));
          return (
            <div key={i}>
              {lead && <p>{inline(lead)}</p>}
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {bullets.map((l, j) => (
                  <li key={j}>{inline(l.replace(/^\s*[-•]\s/, ""))}</li>
                ))}
              </ul>
            </div>
          );
        }
        return (
          <p key={i} className="whitespace-pre-line">
            {inline(b)}
          </p>
        );
      })}
    </div>
  );
}

export const inputCls =
  "h-10 w-full rounded-xl border border-line bg-elev px-3 text-sm outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-[var(--ring)]";
