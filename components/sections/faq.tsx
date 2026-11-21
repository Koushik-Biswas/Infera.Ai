"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import { Reveal, SectionHeading, Serif } from "@/components/ui/primitives";
import { useUI } from "@/components/providers";
import { faqs } from "@/lib/faqs";


export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  const { openDemo } = useUI();

  return (
    <section id="faq" className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="container-x grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading
            align="left"
            eyebrow="FAQ"
            title={
              <>
                Questions, <Serif>answered.</Serif>
              </>
            }
            description={
              <>
                Can&apos;t find what you&apos;re looking for?{" "}
                <button onClick={openDemo} className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                  Talk to our team
                </button>
                .
              </>
            }
          />
        </div>

        <Reveal>
          <ul className="divide-y divide-line border-y border-line">
            {faqs.map((f, i) => {
              const isOpen = open === i;
              return (
                <li key={f.q}>
                  <h3>
                    <button
                      onClick={() => setOpen(isOpen ? null : i)}
                      aria-expanded={isOpen}
                      aria-controls={`faq-${i}`}
                      className="group flex w-full items-center justify-between gap-6 py-6 text-left"
                    >
                      <span className={`text-lg font-medium tracking-tight transition-colors ${isOpen ? "text-fg" : "text-fg-soft group-hover:text-fg"}`}>
                        {f.q}
                      </span>
                      <span
                        className={`grid size-8 shrink-0 place-items-center rounded-full border transition-all duration-300 ${
                          isOpen ? "rotate-45 border-fg bg-fg text-bg" : "border-line text-muted group-hover:border-line-strong group-hover:text-fg"
                        }`}
                      >
                        <Plus className="size-4" />
                      </span>
                    </button>
                  </h3>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        id={`faq-${i}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="max-w-2xl pr-12 pb-6 leading-relaxed text-muted">{f.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
