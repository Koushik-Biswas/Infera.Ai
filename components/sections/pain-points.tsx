"use client";

import { ArrowDown, FileSpreadsheet, MessagesSquare, Search, Upload } from "lucide-react";
import { Reveal, SectionHeading, Serif } from "@/components/ui/primitives";

const pains = [
  {
    icon: Search,
    title: "Digging through old WhatsApp chats",
    body: "Scrolling for a lead, a customer or a payment buried somewhere in thousands of messages.",
    visual: <SearchVisual />,
  },
  {
    icon: FileSpreadsheet,
    title: "Organising chats into Excel or Sheets",
    body: "Copying leads, payments and vendor details from WhatsApp into spreadsheets or other tools — by hand, every day.",
    visual: <SheetVisual />,
  },
  {
    icon: Upload,
    title: "Exporting your chats",
    body: "Exporting chat data and pasting it into an AI assistant like ChatGPT, just to understand what's actually going on.",
    visual: <ExportVisual />,
  },
];

export function PainPoints() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="container-x">
        <SectionHeading
          eyebrow="Sound familiar?"
          title={
            <>
              Is your business information <Serif>buried</Serif> in WhatsApp DMs and groups?
            </>
          }
        />

        <div className="mt-16 grid gap-4 md:grid-cols-3">
          {pains.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.08}>
              <article className="surface group relative flex h-full flex-col overflow-hidden rounded-3xl p-6 transition-transform duration-300 hover:-translate-y-1">
                <div className="relative mb-6 h-40 overflow-hidden rounded-2xl border border-line bg-sunken/70">{p.visual}</div>
                <span className="grid size-10 place-items-center rounded-xl bg-sunken text-fg-soft ring-1 ring-line">
                  <p.icon className="size-[18px]" />
                </span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight">{p.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{p.body}</p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1} className="mt-16 flex flex-col items-center gap-4 text-center">
          <span className="grid size-10 place-items-center rounded-full border border-line text-muted">
            <ArrowDown className="size-4" />
          </span>
          <p className="max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Infera turns your chats into records you can actually{" "}
            <span className="text-gradient">search, share and chat with.</span>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function SearchVisual() {
  const lines = [72, 48, 85, 60, 40, 78, 55, 66, 44, 80];
  return (
    <div className="absolute inset-0 p-4">
      <div className="flex flex-col gap-2 transition-transform duration-[2500ms] ease-linear group-hover:-translate-y-24">
        {lines.concat(lines).map((w, i) => (
          <div key={i} className={`flex ${i % 3 === 0 ? "justify-end" : ""}`}>
            <span
              className={`h-5 rounded-lg ${i % 3 === 0 ? "bg-brand-2/25" : "bg-elev ring-1 ring-line"}`}
              style={{ width: `${w}%` }}
            />
          </div>
        ))}
      </div>
      <div className="absolute right-3 bottom-3 left-3 flex items-center gap-2 rounded-xl bg-elev px-3 py-2 text-xs text-muted ring-1 ring-line">
        <Search className="size-3.5" /> “that guy who wanted 40 bottles…”
        <span className="ml-auto h-3.5 w-px animate-pulse bg-fg" />
      </div>
    </div>
  );
}

function SheetVisual() {
  return (
    <div className="absolute inset-0 grid grid-cols-[1fr_auto_1.2fr] items-center gap-2 p-4">
      <div className="flex flex-col gap-1.5">
        {[80, 60, 90, 50].map((w, i) => (
          <span key={i} className="h-4 rounded-md bg-elev ring-1 ring-line" style={{ width: `${w}%` }} />
        ))}
      </div>
      <span className="text-[10px] font-mono text-muted transition group-hover:text-brand">⌘C → ⌘V</span>
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md bg-line ring-1 ring-line">
        {Array.from({ length: 15 }).map((_, i) => (
          <span key={i} className={`h-4 ${i < 3 ? "bg-sunken" : "bg-elev"} ${i === 7 ? "bg-amber-500/25" : ""}`} />
        ))}
      </div>
    </div>
  );
}

function ExportVisual() {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-3 p-4">
      <div className="flex w-24 flex-col items-center gap-1.5 rounded-xl bg-elev p-3 ring-1 ring-line">
        <MessagesSquare className="size-5 text-brand-2" />
        <span className="font-mono text-[9px] text-muted">chat_export.txt</span>
        <span className="text-[9px] text-muted">4.2 MB</span>
      </div>
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 0.2}s` }} />
        ))}
      </div>
      <div className="w-28 rounded-xl bg-elev p-3 ring-1 ring-line">
        <span className="block h-2 w-3/4 rounded bg-sunken" />
        <span className="mt-1.5 block h-2 w-full rounded bg-sunken" />
        <span className="mt-1.5 block h-2 w-1/2 rounded bg-sunken" />
        <span className="mt-2 block text-[9px] text-red-500">Context too long…</span>
      </div>
    </div>
  );
}
