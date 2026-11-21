"use client";

import Link from "next/link";
import { motion, type HTMLMotionProps } from "motion/react";
import type { ComponentProps, ReactNode } from "react";
import { buttonClass, type Size, type Variant } from "@/components/ui/button-class";

export { buttonClass };

/* ------------------------------------------------------------------ */
/*  Reveal-on-scroll                                                   */
/* ------------------------------------------------------------------ */
export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
  ...rest
}: { children: ReactNode; delay?: number; y?: number } & HTMLMotionProps<"div">) {
  return (
    <motion.div
      initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Buttons                                                            */
/* ------------------------------------------------------------------ */
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: { variant?: Variant; size?: Size } & ComponentProps<"button">) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: { variant?: Variant; size?: Size } & ComponentProps<typeof Link>) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/* ------------------------------------------------------------------ */
/*  Section header                                                     */
/* ------------------------------------------------------------------ */
export function Eyebrow({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-elev/70 px-3 py-1 text-xs font-medium tracking-wide text-fg-soft backdrop-blur">
      {icon ?? <span className="size-1.5 rounded-full bg-brand" />}
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
}) {
  return (
    <Reveal className={`flex flex-col gap-5 ${align === "center" ? "mx-auto max-w-2xl items-center text-center" : "max-w-xl items-start"}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.03em] text-balance sm:text-5xl">{title}</h2>
      {description && <p className="text-lg leading-relaxed text-muted text-pretty">{description}</p>}
    </Reveal>
  );
}

export function Serif({ children }: { children: ReactNode }) {
  return <span className="font-serif font-normal tracking-[-0.01em] italic">{children}</span>;
}
