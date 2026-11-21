"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AudioLines,
  BriefcaseBusiness,
  Camera,
  Check,
  CircleCheck,
  FileText,
  Hash,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  Mail,
  MessageCircle,
  Send,
  ThumbsUp,
  Users,
} from "lucide-react";
import { Reveal, SectionHeading, Serif } from "@/components/ui/primitives";
import { useUI } from "@/components/providers";
import { HONEYPOT_FIELD, isValidEmail } from "@/lib/validation";

const channels = [
  { id: "instagram", name: "Instagram", icon: Camera, tint: "from-pink-500 to-orange-400" },
  { id: "facebook", name: "Facebook", icon: Users, tint: "from-blue-600 to-sky-500" },
  { id: "linkedin", name: "LinkedIn", icon: BriefcaseBusiness, tint: "from-sky-700 to-sky-500" },
  { id: "telegram", name: "Telegram", icon: Send, tint: "from-sky-500 to-cyan-400" },
  { id: "slack", name: "Slack", icon: Hash, tint: "from-fuchsia-600 to-amber-400" },
  { id: "gmail", name: "Gmail", icon: Mail, tint: "from-red-500 to-amber-400" },
] as const;

const VOTES_KEY = "infera-channel-votes";

export function WhatsNext() {
  return (
    <section id="whats-next" className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="container-x">
        <SectionHeading
          eyebrow="What's next"
          title={
            <>
              Starting where business <Serif>already happens.</Serif>
            </>
          }
          description="WhatsApp, Gmail and Slack were built for a world before AI. We're bringing the power of AI to the channels you already use — so you can do more with what you already love."
        />

        <div className="mt-16 grid gap-4 lg:grid-cols-5">
          {/* WhatsApp live */}
          <Reveal className="lg:col-span-2">
            <div className="surface relative flex h-full flex-col overflow-hidden rounded-3xl p-7">
              <div aria-hidden className="absolute -top-24 -right-24 size-64 rounded-full bg-[radial-gradient(closest-side,var(--glow-b),transparent)]" />
              <div className="flex items-center justify-between">
                <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-green-400 text-white shadow-[0_10px_24px_-10px_rgb(16,185,129)]">
                  <MessageCircle className="size-6" />
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-2/14 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-brand-2">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-2 opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-brand-2" />
                  </span>
                  Live now
                </span>
              </div>
              <h3 className="mt-6 text-2xl font-semibold tracking-tight">WhatsApp</h3>
              <p className="mt-2 leading-relaxed text-muted">
                Personal and Business accounts, DMs and groups. Messages, voice notes, photos and documents — backfilled and kept in sync.
              </p>
              <ul className="mt-6 grid grid-cols-2 gap-2 text-sm">
                {[
                  [MessageCircle, "Messages"],
                  [AudioLines, "Voice notes"],
                  [ImageIcon, "Photos"],
                  [FileText, "Documents"],
                ].map(([Icon, label]) => {
                  const I = Icon as typeof MessageCircle;
                  return (
                    <li key={label as string} className="flex items-center gap-2 rounded-xl bg-sunken/60 px-3 py-2">
                      <I className="size-4 text-brand-2" />
                      {label as string}
                    </li>
                  );
                })}
              </ul>
            </div>
          </Reveal>

          {/* Backup — actively building */}
          <Reveal delay={0.08} className="lg:col-span-3">
            <div className="relative flex h-full flex-col overflow-hidden rounded-3xl bg-[#0b0b12] p-7 text-white ring-1 ring-white/10 dark:bg-[#11111a]">
              <div aria-hidden className="absolute inset-0 opacity-70">
                <div className="absolute -bottom-32 -left-20 size-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(124,108,255,0.45),transparent)]" />
                <div className="absolute -top-20 right-0 size-[300px] rounded-full bg-[radial-gradient(closest-side,rgba(46,229,157,0.22),transparent)]" />
              </div>
              <div className="relative flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/90 ring-1 ring-white/15">
                  <LoaderCircle className="size-3 animate-spin" /> Actively building
                </span>
                <span className="text-xs text-white/50">What Infera will be</span>
              </div>
              <h3 className="relative mt-6 max-w-md text-3xl leading-tight font-semibold tracking-tight">
                The real backup of everything that runs your business.
              </h3>
              <p className="relative mt-3 max-w-lg leading-relaxed text-white/65">
                Lose your phone or a WhatsApp backup? Everything you need is already sorted and saved — automatically, in the background.
              </p>
              <ul className="relative mt-auto grid gap-2 pt-8 sm:grid-cols-2">
                {[
                  [Check, "Messages, voice notes, photos and files"],
                  [KeyRound, "Encrypted under a key only your devices hold"],
                ].map(([Icon, label]) => {
                  const I = Icon as typeof Check;
                  return (
                    <li key={label as string} className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 text-sm ring-1 ring-white/10">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
                        <I className="size-3.5" />
                      </span>
                      {label as string}
                    </li>
                  );
                })}
              </ul>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.12} className="mt-4">
          <ChannelVote />
        </Reveal>
      </div>
    </section>
  );
}

function ChannelVote() {
  const { toast } = useUI();
  const [selected, setSelected] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(VOTES_KEY) ?? "[]");
      if (Array.isArray(saved)) setSubmitted(saved);
    } catch {}
  }, []);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const honeypot = (e.currentTarget.elements.namedItem(HONEYPOT_FIELD) as HTMLInputElement | null)?.value ?? "";
    setError("");
    if (!selected.length) return setError("Pick at least one channel.");
    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail && !isValidEmail(cleanEmail)) return setError("That email doesn't look right.");
    setLoading(true);
    try {
      const res = await fetch("/api/channel-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: selected,
          email: cleanEmail || undefined,
          [HONEYPOT_FIELD]: honeypot,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not save your vote.");
      const all = Array.from(new Set([...submitted, ...selected]));
      localStorage.setItem(VOTES_KEY, JSON.stringify(all));
      setSubmitted(all);
      setSelected([]);
      setEmail("");
      toast({ title: "Thanks — vote counted", body: "That's how we prioritise. We'll let you know when it ships." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="surface rounded-3xl p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium tracking-wider text-muted uppercase">Channels in development</p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight">Need one of these sooner? Tell us which.</h3>
        </div>
        <p className="text-sm text-muted">Select all that apply — that&apos;s how we prioritise.</p>
      </div>

      <form onSubmit={submit} className="mt-6">
        <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {channels.map((c) => {
            const on = selected.includes(c.id);
            const voted = submitted.includes(c.id);
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => toggle(c.id)}
                aria-pressed={on}
                className={`group relative flex flex-col items-center gap-3 rounded-2xl border p-4 transition-all duration-200 ${
                  on ? "border-brand bg-brand/[0.06] ring-4 ring-[var(--ring)]" : "border-line bg-sunken/40 hover:-translate-y-0.5 hover:border-line-strong"
                }`}
              >
                <span className={`grid size-11 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-md ${c.tint}`}>
                  <c.icon className="size-5" />
                </span>
                <span className="text-sm font-medium">{c.name}</span>
                <span className="text-[10.5px] text-muted">{voted ? "You voted" : "In development"}</span>
                <AnimatePresence>
                  {(on || voted) && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      className={`absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full ${on ? "bg-brand text-white" : "bg-brand-2/20 text-brand-2"}`}
                    >
                      {on ? <Check className="size-3" /> : <ThumbsUp className="size-2.5" />}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (optional) — we'll tell you when it ships"
            aria-label="Email for launch updates"
            className="h-11 flex-1 rounded-full border border-line bg-sunken/60 px-5 text-sm outline-none transition placeholder:text-muted/80 focus:border-brand focus:bg-elev focus:ring-4 focus:ring-[var(--ring)]"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-fg px-6 text-sm font-semibold text-bg transition hover:opacity-90 disabled:opacity-60"
          >
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <CircleCheck className="size-4" />}
            {selected.length ? `Request ${selected.length} channel${selected.length > 1 ? "s" : ""}` : "Request channels"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </form>
    </div>
  );
}
