"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { ArrowRight, AudioLines, FileText, Image as ImageIcon, MessageCircle } from "lucide-react";
import { useUI } from "@/components/providers";
import { Button, Serif } from "@/components/ui/primitives";
import { HeroDownload, InstallQR } from "@/components/download-buttons";
import { DesktopCollection } from "@/components/mockups/desktop-collection";
import { PhoneChats } from "@/components/mockups/phone-chats";

export function Hero() {
  const { openDemo } = useUI();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const yDesk = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const yPhone = useTransform(scrollYProgress, [0, 1], [0, -130]);
  const rotate = useTransform(scrollYProgress, [0, 1], [8, 0]);

  return (
    <section ref={ref} className="relative overflow-hidden pt-32 pb-20 sm:pt-40 lg:pb-28">
      {/* ambient background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-grid mask-fade-b absolute inset-0 opacity-70" />
        <div className="absolute top-[-12%] left-1/2 h-[620px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glow-a),transparent)] blur-2xl" />
        <div className="absolute top-[30%] right-[-10%] h-[420px] w-[520px] rounded-full bg-[radial-gradient(closest-side,var(--glow-b),transparent)] blur-2xl" />
      </div>

      <div className="container-x">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <a
            href="#whats-next"
            className="hero-in group inline-flex items-center gap-2 rounded-full border border-line bg-elev/70 py-1 pr-3 pl-1 text-xs text-fg-soft backdrop-blur transition hover:border-line-strong"
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-2/15 px-2 py-0.5 font-semibold text-emerald-700 dark:text-brand-2">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-2 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-brand-2" />
              </span>
              Live
            </span>
            WhatsApp is live<span className="hidden sm:inline"> — Gmail, Slack &amp; more coming</span>
            <ArrowRight className="size-3 transition group-hover:translate-x-0.5" />
          </a>

          <h1
            style={{ animationDelay: "60ms" }}
            className="hero-in mt-7 text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-[4.6rem]"
          >
            Create clean, structured data from your <Serif><span className="text-gradient pr-1">WhatsApp chats.</span></Serif>
          </h1>

          <p
            style={{ animationDelay: "150ms" }}
            className="hero-in mt-6 max-w-2xl text-lg leading-relaxed text-muted text-pretty sm:text-xl"
          >
            Stop copy-pasting from WhatsApp groups into Google Sheets. Infera reads your chats and turns every{" "}
            <Chip icon={<MessageCircle className="size-3.5" />}>message</Chip>,{" "}
            <Chip icon={<AudioLines className="size-3.5" />}>voice note</Chip> and{" "}
            <Chip icon={<FileText className="size-3.5" />}>attachment</Chip> into clean, structured rows — automatically, in the background.
          </p>

          <div style={{ animationDelay: "240ms" }} className="hero-in mt-9 flex flex-col items-center gap-6">
            <Button variant="brand" size="lg" onClick={openDemo} className="min-w-44">
              Get a demo
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
            <HeroDownload />
          </div>
        </div>

        {/* product visuals */}
        <div
          style={{ animationDelay: "340ms", animationDuration: "1.1s" }}
          className="hero-in relative mx-auto mt-16 max-w-5xl [perspective:2000px] sm:mt-20"
        >
          <motion.div style={{ y: yDesk, rotateX: rotate }} className="relative origin-top">
            <div aria-hidden className="absolute -inset-x-10 -top-10 bottom-0 -z-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_30%,var(--glow-a),transparent)] blur-2xl" />
            <DesktopCollection reserveRight />
          </motion.div>

          <motion.div style={{ y: yPhone }} className="absolute -right-2 -bottom-24 hidden md:block lg:-right-14">
            <div className="animate-float">
              <PhoneChats />
            </div>
          </motion.div>

          {/* floating extraction chip */}
          <div
            style={{ animationDelay: "1.1s" }}
            className="hero-in surface absolute -bottom-8 -left-4 hidden max-w-[260px] items-start gap-3 rounded-2xl p-3.5 text-left lg:-left-12 lg:flex"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/12 text-brand">
              <ImageIcon className="size-4" />
            </span>
            <div>
              <p className="text-xs font-semibold">Payment proof detected</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted">UPI screenshot from Rahul → Order #2 marked <b className="text-brand-2">Paid</b></p>
            </div>
          </div>
        </div>

        <div className="mt-20 flex justify-center md:mt-36">
          <InstallQR />
        </div>
      </div>
    </section>
  );
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex translate-y-[-1px] items-center gap-1 rounded-full border border-line bg-elev px-2 py-px align-middle text-[0.85em] font-medium text-fg">
      <span className="text-brand">{icon}</span>
      {children}
    </span>
  );
}
