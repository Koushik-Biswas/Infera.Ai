"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import {
  ArrowUp,
  Calendar,
  CircleCheck,
  CornerDownLeft,
  Hash,
  IndianRupee,
  LoaderCircle,
  Package,
  Phone,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tag,
  User,
} from "lucide-react";
import { SectionHeading, Serif } from "@/components/ui/primitives";
import { LazyQRCode } from "@/components/lazy-qr";
import { Avatar, StatusBadge } from "@/components/ui/status-badge";
import { formatINR, orders } from "@/lib/data";
import { MaskedPhone } from "@/components/ui/masked-phone";

const STEP_MS = 7000;

const steps = [
  {
    n: "01",
    title: "Scan to connect",
    body: "Open Infera and scan a QR code to link WhatsApp — the same way WhatsApp Web works. No new number, no migration.",
  },
  {
    n: "02",
    title: "Organise your data with just a prompt",
    body: "Once connected, just ask: “Find all leads from my chats for the last month.” Infera reads every message, finds the leads, and saves them into a collection — a table you can use just like Excel.",
  },
  {
    n: "03",
    title: "Collection (a searchable table)",
    body: "Ask anything, like “Who asked about the blue running shoes?” Infera searches the collection it created — the way you'd search a sheet — and gives you a proper, cited answer.",
  },
];

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-20% 0px -20% 0px" });
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (!inView || paused) return;
    const t = setTimeout(() => {
      setActive((a) => (a + 1) % steps.length);
      setCycle((c) => c + 1);
    }, STEP_MS);
    return () => clearTimeout(t);
  }, [active, inView, paused, cycle]);

  const select = (i: number) => {
    setActive(i);
    setCycle((c) => c + 1);
  };

  return (
    <section id="how-it-works" className="relative scroll-mt-20 overflow-x-clip py-24 sm:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line-strong to-transparent" />
      <div className="container-x">
        <SectionHeading
          eyebrow="How Infera works"
          title={
            <>
              Set up in <Serif>60 seconds.</Serif> Works 24/7 in the background.
            </>
          }
          description="Link once, describe what you want to track, and let Infera keep it organised as new messages arrive."
        />

        <div
          ref={ref}
          className="mt-16 grid items-center gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <ol className="flex flex-col gap-3" role="tablist" aria-label="Steps">
            {steps.map((s, i) => {
              const on = i === active;
              return (
                <li key={s.n}>
                  <button
                    role="tab"
                    aria-selected={on}
                    onClick={() => select(i)}
                    className={`relative w-full overflow-hidden rounded-3xl border p-6 text-left transition-all duration-300 ${
                      on ? "surface border-line-strong" : "border-transparent hover:bg-elev/50"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <span
                        className={`font-mono text-sm tabular-nums transition-colors ${on ? "text-brand" : "text-muted"}`}
                      >
                        {s.n}
                      </span>
                      <div className="flex-1">
                        <h3 className={`text-lg font-semibold tracking-tight transition-colors ${on ? "text-fg" : "text-fg-soft"}`}>
                          {s.title}
                        </h3>
                        <AnimatePresence initial={false}>
                          {on && (
                            <motion.p
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                              className="overflow-hidden"
                            >
                              <span className="block pt-2 leading-relaxed text-muted">{s.body}</span>
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    {on && (
                      <span className="absolute inset-x-6 bottom-0 h-0.5 overflow-hidden rounded-full bg-line">
                        <motion.span
                          key={`${cycle}-${paused}`}
                          className="block h-full origin-left bg-gradient-to-r from-brand to-brand-2"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: paused || !inView ? 0 : 1 }}
                          transition={{ duration: paused || !inView ? 0 : STEP_MS / 1000, ease: "linear" }}
                        />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="relative">
            <div aria-hidden className="absolute -inset-8 -z-10 rounded-[48px] bg-[radial-gradient(50%_50%_at_50%_50%,var(--glow-a),transparent)] blur-2xl" />
            <div className="surface-lg ring-gradient relative h-[460px] overflow-hidden rounded-[28px] bg-grid sm:h-[480px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${active}-${cycle}`}
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.98 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-0 flex items-center justify-center p-5 sm:p-8"
                >
                  {active === 0 && <LinkFlow />}
                  {active === 1 && <PlanFlow />}
                  {active === 2 && <AskFlow />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */
function useSequence(durations: number[]) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (phase >= durations.length) return;
    const t = setTimeout(() => setPhase((p) => p + 1), durations[phase]);
    return () => clearTimeout(t);
  }, [phase, durations]);
  return phase;
}

function useTypewriter(text: string, start: boolean, speed = 32) {
  const [out, setOut] = useState("");
  useEffect(() => {
    if (!start) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setOut(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, start, speed]);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Step 1 — link WhatsApp                                             */
/* ------------------------------------------------------------------ */
const LINK_DURATIONS = [1200, 2400, 1400];

function LinkFlow() {
  const phase = useSequence(LINK_DURATIONS); // 0 allow · 1 scan · 2 connecting · 3 done
  const labels = ["Allow access", "Scan QR code", "Connecting", "Logged in"];

  return (
    <div className="w-full max-w-sm">
      <div className="mb-5 flex items-center justify-between gap-1">
        {labels.map((l, i) => (
          <div key={l} className="flex flex-1 flex-col items-center gap-2">
            <span
              className={`h-1 w-full rounded-full transition-colors duration-500 ${i <= phase ? "bg-brand-2" : "bg-line"}`}
            />
            <span className={`text-[10.5px] transition-colors ${i === phase || (phase > 3 && i === 3) ? "text-fg font-medium" : "text-muted"}`}>
              {l}
            </span>
          </div>
        ))}
      </div>

      <div className="surface rounded-3xl p-6">
        <AnimatePresence mode="wait">
          {phase === 0 && (
            <Pane key="allow">
              <span className="grid size-14 place-items-center rounded-2xl bg-brand/12 text-brand">
                <ShieldCheck className="size-7" />
              </span>
              <p className="mt-4 font-semibold">Link your WhatsApp</p>
              <p className="mt-1 text-sm text-muted">Choose which chats Infera can read. You can change this any time.</p>
              <span className="mt-5 inline-flex h-10 items-center rounded-full bg-fg px-5 text-sm font-medium text-bg">Allow access</span>
            </Pane>
          )}
          {phase === 1 && (
            <Pane key="qr">
              <div className="relative rounded-2xl bg-white p-3" style={{ ["--scan-h" as string]: "168px" }}>
                <LazyQRCode value="https://infera.ai/link/demo-session-7f3a9c" size={168} level="M" fgColor="#0b0b10" />
                <span className="animate-scan absolute inset-x-3 top-3 h-1 rounded-full bg-brand-2 shadow-[0_0_18px_4px_rgba(18,183,106,0.55)]" />
              </div>
              <p className="mt-4 text-sm text-muted">
                WhatsApp → <b className="text-fg">Linked devices</b> → Link a device
              </p>
            </Pane>
          )}
          {phase === 2 && (
            <Pane key="connecting">
              <div className="relative grid size-20 place-items-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-brand-2/20" />
                <span className="grid size-16 place-items-center rounded-full bg-brand-2/15 text-brand-2">
                  <LoaderCircle className="size-7 animate-spin" />
                </span>
              </div>
              <p className="mt-4 font-semibold">Connecting…</p>
              <p className="mt-1 text-sm text-muted">Securely syncing your chats and backfilling history</p>
            </Pane>
          )}
          {phase >= 3 && (
            <Pane key="done">
              <motion.span
                initial={{ scale: 0.5 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 15 }}
                className="grid size-16 place-items-center rounded-full bg-brand-2 text-white shadow-[0_10px_30px_-8px_var(--brand-2)]"
              >
                <CircleCheck className="size-8" />
              </motion.span>
              <p className="mt-4 font-semibold">Successfully logged in</p>
              <div className="mt-3 flex items-center gap-2 rounded-full bg-sunken px-3 py-1.5 text-xs text-fg-soft">
                <Smartphone className="size-3.5" /> <MaskedPhone phone="+91 9847• •••••" /> · 54 chats · 3 years of history
              </div>
            </Pane>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Pane({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className="flex min-h-[290px] flex-col items-center justify-center text-center"
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 2 — prompt → collection plan                                  */
/* ------------------------------------------------------------------ */
const PROMPT = "Find all orders from my chats for the last month";
const PLAN_DURATIONS = [PROMPT.length * 30 + 400, 1100, 2200, 900];
const fields = [
  { icon: User, label: "Customer", type: "Text" },
  { icon: Phone, label: "Phone", type: "Phone" },
  { icon: Package, label: "Purchase", type: "Text" },
  { icon: Hash, label: "Quantity", type: "Number" },
  { icon: IndianRupee, label: "Value", type: "Currency" },
  { icon: Tag, label: "Status", type: "Select" },
];

function PlanFlow() {
  const phase = useSequence(PLAN_DURATIONS); // 0 typing · 1 thinking · 2 plan · 3 accepting · 4 created
  const typed = useTypewriter(PROMPT, true, 30);

  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <div className="surface flex items-center gap-2 rounded-2xl p-2 pl-4">
        <Sparkles className="size-4 shrink-0 text-brand" />
        <p className="min-h-5 flex-1 truncate text-sm">
          {typed}
          {phase === 0 && <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-fg" />}
        </p>
        <span className={`grid size-8 place-items-center rounded-xl transition ${phase >= 1 ? "bg-fg text-bg" : "bg-sunken text-muted"}`}>
          <ArrowUp className="size-4" />
        </span>
      </div>

      <AnimatePresence mode="wait">
        {phase === 1 && (
          <motion.div key="think" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 px-2 text-sm">
            <LoaderCircle className="size-4 animate-spin text-brand" />
            <span className="shimmer-text font-medium">Reading 54 chats and designing a table…</span>
          </motion.div>
        )}
        {phase >= 2 && (
          <motion.div
            key="plan"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="surface overflow-hidden rounded-2xl"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Collection creation plan</p>
                <p className="mt-0.5 font-semibold">
                  Orders <span className="font-normal text-muted">· 6 fields</span>
                </p>
              </div>
              <span className="rounded-full bg-brand/12 px-2 py-0.5 text-[11px] font-medium text-brand">Auto-update on</span>
            </div>
            <ul className="grid grid-cols-2 gap-1.5 p-3">
              {fields.map((f, i) => (
                <motion.li
                  key={f.label}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.06 * i }}
                  className="flex items-center gap-2 rounded-xl bg-sunken/70 px-3 py-2 text-sm"
                >
                  <f.icon className="size-3.5 text-muted" />
                  <span className="font-medium">{f.label}</span>
                  <span className="ml-auto text-[10.5px] text-muted">{f.type}</span>
                </motion.li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
              <AnimatePresence mode="wait">
                {phase < 4 ? (
                  <motion.span key="hint" exit={{ opacity: 0 }} className="text-xs text-muted">
                    Sources: 9 chats · 3 groups · Oct 17 – Nov 17
                  </motion.span>
                ) : (
                  <motion.span key="ok" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-brand-2">
                    <CircleCheck className="size-3.5" /> Collection created · 24 orders found
                  </motion.span>
                )}
              </AnimatePresence>
              <motion.span
                animate={phase === 3 ? { scale: [1, 0.94, 1] } : {}}
                transition={{ duration: 0.4 }}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-xs font-semibold transition ${
                  phase >= 4 ? "bg-brand-2/15 text-emerald-700 dark:text-brand-2" : "bg-fg text-bg"
                }`}
              >
                {phase >= 4 ? "Accepted" : "Accept"}
                {phase < 4 && <CornerDownLeft className="size-3" />}
              </motion.span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 3 — ask the collection                                        */
/* ------------------------------------------------------------------ */
const QUESTION = "Who asked about the blue running shoes?";
const ASK_DURATIONS = [QUESTION.length * 30 + 300, 1000];

function AskFlow() {
  const phase = useSequence(ASK_DURATIONS);
  const typed = useTypewriter(QUESTION, true, 30);
  const matches = orders.filter((o) => o.purchase.toLowerCase().includes("blue running shoes"));

  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-fg px-4 py-2.5 text-sm text-bg">
          {typed}
          {phase === 0 && <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-bg" />}
        </div>
      </div>

      {phase === 1 && (
        <div className="flex items-center gap-2 px-1 text-sm">
          <LoaderCircle className="size-4 animate-spin text-brand" />
          <span className="shimmer-text font-medium">Searching Orders collection…</span>
        </div>
      )}

      {phase >= 2 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="surface rounded-2xl rounded-bl-md p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-brand">
            <Sparkles className="size-3.5" /> Infera
          </div>
          <p className="mt-2 text-sm leading-relaxed">
            <b>{matches.length} customers</b> asked about the blue running shoes this month. Rahul has already paid; Neha is waiting
            on a price for UK 7.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {matches.map((m, i) => (
              <motion.li
                key={m.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.1 }}
                className="flex items-center gap-2.5 rounded-xl bg-sunken/70 px-3 py-2 text-sm"
              >
                <Avatar name={m.customer} className="size-6 text-[9px]" />
                <span className="font-medium">{m.customer}</span>
                <span className="hidden text-xs text-muted sm:inline">{m.purchase.split("·")[1]}</span>
                <span className="ml-auto font-mono text-xs tabular-nums text-fg-soft">{formatINR(m.value)}</span>
                <StatusBadge status={m.status} />
              </motion.li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
            <Calendar className="size-3" /> Sources: 2 rows · linked to original messages
          </p>
        </motion.div>
      )}
    </div>
  );
}
