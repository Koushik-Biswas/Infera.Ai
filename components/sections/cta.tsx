"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useUI } from "@/components/providers";
import { Reveal, Serif, buttonClass } from "@/components/ui/primitives";
import { LogoMark } from "@/components/logo";

export function CTA() {
  const { openDemo } = useUI();
  return (
    <section className="relative py-16 sm:py-24">
      <div className="container-x">
        <Reveal>
          <div className="relative overflow-hidden rounded-[36px] bg-[#0a0a10] px-6 py-20 text-center text-white ring-1 ring-white/10 sm:px-16">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 opacity-[0.15] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(60%_70%_at_50%_100%,black,transparent)]" />
              <div className="absolute -bottom-40 left-1/2 h-[420px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(124,108,255,0.55),transparent)] blur-2xl" />
              <div className="absolute -bottom-24 left-[30%] h-[260px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(46,229,157,0.3),transparent)] blur-2xl" />
            </div>
            <div className="relative mx-auto flex max-w-2xl flex-col items-center">
              <LogoMark className="size-14 drop-shadow-[0_10px_30px_rgba(124,108,255,0.5)]" />
              <h2 className="mt-8 text-4xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-6xl">
                Your first table in <Serif>60 seconds.</Serif>
              </h2>
              <p className="mt-5 text-lg text-white/65">
                Link WhatsApp, describe what you track, and let Infera do the copy-pasting forever. First week free.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <button onClick={openDemo} className={buttonClass("primary", "lg", "!bg-white !text-[#0a0a10] hover:!bg-white/90")}>
                  Get a demo
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </button>
                <Link href="/download" className={buttonClass("ghost", "lg", "!text-white ring-1 ring-white/20 hover:!bg-white/10")}>
                  Get the app
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
