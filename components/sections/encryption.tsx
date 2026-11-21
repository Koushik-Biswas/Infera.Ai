"use client";

import { useEffect, useRef, useState } from "react";
import { Cloud, EyeOff, KeyRound, Laptop, ListChecks, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { Reveal, SectionHeading, Serif } from "@/components/ui/primitives";

const points = [
  { icon: Lock, title: "Encrypted before it leaves", body: "Messages are encrypted before they're stored in the cloud." },
  { icon: KeyRound, title: "Keys live on your devices", body: "Content is only decrypted on devices you've signed in to." },
  { icon: ListChecks, title: "You choose what's read", body: "Pick the chats and groups that matter. Exclude anything personal." },
  { icon: EyeOff, title: "Never sold, never trained on", body: "Your chats power your tables — nothing else. Delete everything any time." },
];

const HEX = "0123456789abcdef";
function randomCipher(len: number) {
  let s = "";
  for (let i = 0; i < len; i++) s += HEX[Math.floor(Math.random() * 16)];
  return s;
}

export function Encryption() {
  return (
    <section id="encryption" className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="container-x">
        <div className="surface-lg relative overflow-hidden rounded-[32px] px-6 py-16 sm:px-12 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="bg-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(70%_60%_at_50%_40%,black,transparent)]" />
            <div className="absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glow-a),transparent)] blur-2xl" />
          </div>

          <div className="relative">
            <SectionHeading
              eyebrow="Encryption"
              title={
                <>
                  All your chats, <Serif>encrypted.</Serif>
                </>
              }
              description="Your messages are securely stored in the cloud and only decrypted on your device."
            />

            <Reveal delay={0.1} className="mx-auto mt-14 max-w-3xl">
              <EncryptionDiagram />
            </Reveal>

            <div className="mx-auto mt-14 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {points.map((p, i) => (
                <Reveal key={p.title} delay={0.05 * i}>
                  <div className="h-full rounded-2xl border border-line bg-sunken/40 p-5">
                    <p.icon className="size-5 text-brand" />
                    <p className="mt-3 font-semibold tracking-tight">{p.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{p.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EncryptionDiagram() {
  const [cipher, setCipher] = useState<string[]>(["", "", "", ""]);
  const ref = useRef<HTMLDivElement>(null);
  // Scrambles ~7×/s, but only while on screen and the tab is visible (it used to re-render forever,
  // even scrolled away). Reduced motion: one static frame.
  useEffect(() => {
    const tick = () => setCipher([randomCipher(18), randomCipher(18), randomCipher(18), randomCipher(18)]);
    tick();
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let id: ReturnType<typeof setInterval> | undefined;
    let inView = false;
    const sync = () => {
      const run = inView && document.visibilityState === "visible";
      if (run && !id) id = setInterval(tick, 140);
      else if (!run && id) {
        clearInterval(id);
        id = undefined;
      }
    };
    const io = new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      if (id) clearInterval(id);
    };
  }, []);

  return (
    <div ref={ref} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:grid-cols-[1fr_1.3fr_1fr] sm:gap-4">
      <Device icon={<Smartphone className="size-6" />} label="Your phone" plain="“12 kurtis, deliver next week”" />

      <div className="relative flex flex-col items-center">
        {/* connection lines */}
        <div aria-hidden className="absolute top-1/2 right-full left-[-100%] hidden h-px -translate-y-1/2 sm:block" />
        <div className="relative w-full">
          <Wire />
          <div className="relative z-10 mx-auto flex w-[150px] flex-col items-center gap-3 rounded-3xl border border-line bg-elev p-4 shadow-xl sm:w-full sm:max-w-[230px]">
            <span className="grid size-12 place-items-center rounded-2xl bg-sunken text-fg-soft ring-1 ring-line">
              <Cloud className="size-6" />
            </span>
            <p className="text-xs font-semibold">Infera cloud</p>
            <div className="w-full space-y-1 rounded-xl bg-sunken/80 p-2 font-mono text-[9.5px] leading-tight text-muted sm:text-[10.5px]">
              {cipher.map((c, i) => (
                <p key={i} className="truncate">
                  {c || " "}
                </p>
              ))}
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-brand/12 px-2 py-0.5 text-[10px] font-medium text-brand">
              <Lock className="size-3" /> Encrypted at rest
            </span>
          </div>
        </div>
      </div>

      <Device icon={<Laptop className="size-6" />} label="Your desktop" plain="Orders → Fathima · 12 · Confirmed" />
    </div>
  );
}

function Device({ icon, label, plain }: { icon: React.ReactNode; label: string; plain: string }) {
  return (
    <div className="relative z-10 flex flex-col items-center gap-3 text-center">
      <div className="relative grid size-16 place-items-center rounded-3xl border border-line bg-elev text-fg shadow-lg sm:size-20">
        {icon}
        <span className="absolute -right-2 -bottom-2 grid size-7 place-items-center rounded-full bg-brand-2 text-white shadow-[0_6px_16px_-4px_var(--brand-2)]">
          <KeyRound className="size-3.5" />
        </span>
      </div>
      <p className="text-sm font-semibold">{label}</p>
      <p className="hidden max-w-[12rem] rounded-xl border border-line bg-elev/70 px-2.5 py-1.5 text-[11px] text-fg-soft sm:block">
        <ShieldCheck className="mr-1 inline size-3 -translate-y-px text-brand-2" />
        {plain}
      </p>
    </div>
  );
}

function Wire() {
  return (
    <div aria-hidden className="absolute inset-x-[-40%] top-1/2 -z-0 h-px -translate-y-1/2 sm:inset-x-[-55%]">
      <div className="h-px w-full bg-[repeating-linear-gradient(90deg,var(--border-strong)_0_6px,transparent_6px_12px)]" />
      {/* Each dot rides a full-width track that slides by its own width: a transform-only (GPU) animation,
          instead of animating `left`, which re-laid out the page every frame. */}
      {[0, 1].map((i) => (
        <span
          key={i}
          className="wire-run absolute inset-0"
          style={i ? { animationDirection: "reverse", animationDelay: "1.6s" } : undefined}
        >
          <span className="absolute top-1/2 left-0 size-2 -translate-y-1/2 rounded-full bg-brand shadow-[0_0_12px_2px_var(--brand)]" />
        </span>
      ))}
    </div>
  );
}
