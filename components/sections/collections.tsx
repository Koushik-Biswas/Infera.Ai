"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import {
  ArrowDownUp,
  AudioLines,
  ChevronDown,
  Download,
  Image as ImageIcon,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Table,
  Wand,
  X,
} from "lucide-react";
import { Reveal, SectionHeading, Serif } from "@/components/ui/primitives";
import { Avatar, StatusBadge } from "@/components/ui/status-badge";
import { useUI } from "@/components/providers";
import { formatDate, formatINR, incoming, orders as seed, type OrderRow, type OrderStatus } from "@/lib/data";
import { downloadFile, toCSV } from "@/lib/csv";
import { maskedPhoneText } from "@/lib/phone";
import { MaskedPhone } from "@/components/ui/masked-phone";

const STATUSES: (OrderStatus | "All")[] = ["All", "New", "Confirmed", "Pending", "Paid", "Shipped"];
const LIVE_MS = 4800;

type SortKey = "date" | "value" | "customer";

const features = [
  { icon: Wand, title: "Creates itself from your chats", body: "Describe what to track. Infera designs the columns and fills every row." },
  { icon: RefreshCw, title: "Updates automatically", body: "New messages, voice notes and payment screenshots update the right row." },
  { icon: Download, title: "Export with one click", body: "CSV that opens cleanly in Excel and Google Sheets — ₹, dates and all." },
];

export function Collections() {
  return (
    <section id="collections" className="relative scroll-mt-20 overflow-hidden py-24 sm:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-1/3 left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glow-b),transparent)] blur-3xl" />
      </div>
      <div className="container-x">
        <SectionHeading
          eyebrow="Collections"
          title={
            <>
              Introducing Collections, <Serif>a new form of Sheets.</Serif>
            </>
          }
          description="Collections organise, store and search the data extracted from your chats. It's a spreadsheet that updates itself whenever relevant messages arrive."
        />

        <div className="mx-auto mt-12 grid max-w-4xl gap-3 sm:grid-cols-3">
          {features.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.06} className="flex items-start gap-3 rounded-2xl p-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-elev text-brand ring-1 ring-line">
                <f.icon className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1} className="mt-12">
          <LiveCollection />
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Interactive collection                                             */
/* ------------------------------------------------------------------ */
function LiveCollection() {
  const { toast } = useUI();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-25% 0px -25% 0px" });

  const [rows, setRows] = useState<OrderRow[]>(seed);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<OrderStatus | "All">("All");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [feed, setFeed] = useState<{ id: number; from: string; message: string; kind: string; action: string }[]>([]);

  // Simulated background sync: each incoming message adds or updates a row.
  useEffect(() => {
    if (!live || !inView || cursor >= incoming.length) return;
    const t = setTimeout(() => {
      const evt = incoming[cursor];
      const targetId = evt.updates ?? evt.row.id;
      setRows((prev) =>
        evt.updates ? prev.map((r) => (r.id === evt.updates ? { ...evt.row, source: r.source } : r)) : [evt.row, ...prev],
      );
      setFeed((f) => [
        { id: Date.now(), from: evt.from, message: evt.message, kind: evt.kind, action: evt.updates ? `Updated → ${evt.row.status}` : "New row added" },
        ...f.slice(0, 3),
      ]);
      setFlash(targetId);
      setTimeout(() => setFlash((x) => (x === targetId ? null : x)), 2200);
      setCursor((c) => c + 1);
    }, LIVE_MS);
    return () => clearTimeout(t);
  }, [live, inView, cursor]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: rows.length };
    rows.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1));
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => status === "All" || r.status === status)
      .filter((r) => !q || [r.customer, r.purchase, r.phone, r.status, r.source.chat].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => {
        const k = sort.key;
        const av = a[k];
        const bv = b[k];
        return (av > bv ? 1 : av < bv ? -1 : 0) * sort.dir;
      });
  }, [rows, query, status, sort]);

  const total = visible.reduce((s, r) => s + r.value, 0);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "customer" ? 1 : -1 }));

  const exportCSV = () => {
    const csv = toCSV(
      visible.map((r) => ({ ...r, phone: maskedPhoneText(r.phone), source: r.source.chat })),
      [
        { key: "customer", label: "Customer" },
        { key: "phone", label: "Phone" },
        { key: "purchase", label: "Purchase" },
        { key: "qty", label: "Quantity" },
        { key: "value", label: "Value (INR)" },
        { key: "status", label: "Status" },
        { key: "date", label: "Date" },
        { key: "source", label: "Source chat" },
      ],
    );
    downloadFile(`infera-orders-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast({ title: "Exported to CSV", body: `${visible.length} rows downloaded — opens in Excel or Google Sheets.` });
  };

  const reset = () => {
    setRows(seed);
    setCursor(0);
    setFeed([]);
    setQuery("");
    setStatus("All");
    setLive(true);
  };

  return (
    <div ref={ref} className="grid gap-4 lg:grid-cols-[1fr_300px]">
      {/* table */}
      <div className="surface-lg overflow-hidden rounded-[24px]">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <span className="grid size-9 place-items-center rounded-xl bg-brand/12 text-brand">
            <Table className="size-4" />
          </span>
          <div className="mr-auto">
            <p className="font-semibold tracking-tight">Orders</p>
            <p className="text-xs text-muted">
              {visible.length} of {rows.length} rows · {formatINR(total)} total
            </p>
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customer, product, chat…"
              aria-label="Search collection"
              className="h-9 w-full rounded-xl border border-line bg-sunken/60 pr-8 pl-8 text-sm outline-none transition placeholder:text-muted/80 focus:border-brand focus:bg-elev focus:ring-4 focus:ring-[var(--ring)]"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-fg">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={exportCSV}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-fg px-3.5 text-sm font-medium text-bg transition hover:opacity-90 active:scale-[0.98]"
          >
            <Download className="size-3.5" /> Export
          </button>
        </div>

        <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b border-line px-4 py-2.5 sm:px-5">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                status === s ? "text-bg" : "text-muted hover:bg-sunken hover:text-fg"
              }`}
            >
              {status === s && (
                <motion.span layoutId="status-pill" className="absolute inset-0 rounded-full bg-fg" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
              )}
              <span className="relative">{s}</span>
              <span className={`relative tabular-nums ${status === s ? "text-bg/70" : "text-muted/70"}`}>{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="max-h-[560px] overflow-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 z-10 bg-elev/95 backdrop-blur">
              <tr className="border-b border-line text-left text-[11px] tracking-wide text-muted uppercase">
                <Th onClick={() => toggleSort("customer")} active={sort.key === "customer"} className="pl-5">
                  Customer
                </Th>
                <th className="px-3 py-2.5 font-medium">Purchase</th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <Th onClick={() => toggleSort("value")} active={sort.key === "value"} className="justify-end">
                  Value
                </Th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <Th onClick={() => toggleSort("date")} active={sort.key === "date"} className="justify-end pr-5">
                  Date
                </Th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                  <Fragment key={r.id}>
                    <motion.tr
                      layout="position"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45 }}
                      onClick={() => setExpanded((e) => (e === r.id ? null : r.id))}
                      className={`cursor-pointer border-b border-line/70 transition-colors duration-700 ${
                        flash === r.id ? "bg-brand-2/12" : "hover:bg-sunken/50"
                      }`}
                    >
                      <td className="py-2.5 pr-3 pl-5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={r.customer} className="size-7 text-[10px]" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{r.customer}</p>
                            <p className="truncate text-[11px] text-muted">
                              <MaskedPhone phone={r.phone} />
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2.5 text-fg-soft">{r.purchase}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-fg-soft">{r.qty}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[13px] tabular-nums">{formatINR(r.value)}</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="py-2.5 pr-5 pl-3 text-right whitespace-nowrap text-muted">{formatDate(r.date)}</td>
                      <td className="pr-3">
                        <ChevronDown className={`size-4 text-muted transition-transform ${expanded === r.id ? "rotate-180" : ""}`} />
                      </td>
                    </motion.tr>
                    {expanded === r.id && (
                      <tr className="border-b border-line/70 bg-sunken/40">
                        <td colSpan={7} className="px-5 py-3">
                          <SourceMessage row={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-14 text-center text-sm text-muted">
                    No rows match “{query}”. Try another name, product or status.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* live sync panel */}
      <aside className="surface flex flex-col overflow-hidden rounded-[24px]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              {live && cursor < incoming.length && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-2 opacity-75" />
              )}
              <span className={`relative inline-flex size-2 rounded-full ${live ? "bg-brand-2" : "bg-muted"}`} />
            </span>
            <p className="text-sm font-semibold">Background sync</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setLive((v) => !v)}
              disabled={cursor >= incoming.length}
              aria-label={live ? "Pause live sync" : "Resume live sync"}
              className="grid size-7 place-items-center rounded-lg text-muted transition hover:bg-sunken hover:text-fg disabled:opacity-40"
            >
              {live ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </button>
            <button onClick={reset} aria-label="Reset demo" className="grid size-7 place-items-center rounded-lg text-muted transition hover:bg-sunken hover:text-fg">
              <RotateCcw className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-3">
          <AnimatePresence initial={false}>
            {feed.map((f) => (
              <motion.div
                key={f.id}
                layout
                initial={{ opacity: 0, y: -14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                className="rounded-2xl border border-line bg-sunken/50 p-3"
              >
                <div className="flex items-center gap-2">
                  <Avatar name={f.from} className="size-6 text-[9px]" />
                  <p className="truncate text-xs font-semibold">{f.from}</p>
                  <KindIcon kind={f.kind} />
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-fg-soft">{f.message}</p>
                <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-brand-2/12 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-brand-2">
                  <Sparkles className="size-3" /> {f.action}
                </p>
              </motion.div>
            ))}
          </AnimatePresence>

          {feed.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <MessageCircle className="size-6 text-muted" />
              <p className="text-sm font-medium">Listening for new messages…</p>
              <p className="text-xs text-muted">Watch rows appear and update as chats come in. Click any row to see its source message.</p>
            </div>
          )}

          {cursor >= incoming.length && (
            <button onClick={reset} className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-line py-2 text-xs font-medium text-muted transition hover:text-fg">
              <RotateCcw className="size-3" /> Replay demo
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  className?: string;
}) {
  return (
    <th className="px-3 py-2.5 font-medium">
      <button onClick={onClick} className={`flex w-full items-center gap-1 uppercase transition hover:text-fg ${active ? "text-fg" : ""} ${className}`}>
        {children}
        <ArrowDownUp className={`size-3 ${active ? "opacity-100" : "opacity-40"}`} />
      </button>
    </th>
  );
}

function KindIcon({ kind }: { kind: string }) {
  const cls = "ml-auto size-3.5 text-muted";
  if (kind === "voice") return <AudioLines className={cls} aria-label="Voice note" />;
  if (kind === "image") return <ImageIcon className={cls} aria-label="Image" />;
  return <MessageCircle className={cls} aria-label="Text message" />;
}

function SourceMessage({ row }: { row: OrderRow }) {
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-start gap-3">
      <span className="mt-0.5 text-[11px] font-medium tracking-wide text-muted uppercase">Source</span>
      <div className="max-w-xl flex-1 rounded-2xl rounded-tl-md bg-elev px-3.5 py-2.5 ring-1 ring-line">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
          <KindIconInline kind={row.source.kind} />
          {row.source.chat} · {formatDate(row.date)}
        </div>
        <p className="text-sm">{row.source.text}</p>
      </div>
      <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted">
        <Sparkles className="size-3 text-brand" /> Extracted with 97% confidence
      </span>
    </motion.div>
  );
}

function KindIconInline({ kind }: { kind: string }) {
  if (kind === "voice") return <AudioLines className="size-3" />;
  if (kind === "image") return <ImageIcon className="size-3" />;
  return <MessageCircle className="size-3" />;
}
