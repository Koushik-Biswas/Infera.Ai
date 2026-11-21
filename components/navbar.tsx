"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeSegmented, ThemeToggle } from "@/components/theme-toggle";
import { useUI } from "@/components/providers";
import { buttonClass } from "@/components/ui/button-class";
import { navLinks } from "@/lib/site";

// Animations here are CSS-only: the navbar is on every marketing and legal page, and the animation
// library would add ~50 KB (gzip) of JavaScript to each of them.
const EASE = "ease-[cubic-bezier(0.22,1,0.36,1)]";

export function Navbar() {
  const { openDemo } = useUI();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>());
  // Sliding highlight behind the active link; `slide` is off for its first placement so it appears in place.
  const [pill, setPill] = useState<{ left: number; width: number; slide: boolean } | null>(null);

  useLayoutEffect(() => {
    const measure = (slide: boolean) => {
      const el = active ? linkRefs.current.get(active) : undefined;
      setPill((prev) => {
        if (!el || !el.offsetWidth) return null;
        if (prev && prev.left === el.offsetLeft && prev.width === el.offsetWidth) return prev; // unchanged: keep any running slide
        return { left: el.offsetLeft, width: el.offsetWidth, slide: slide && prev !== null };
      });
    };
    measure(true);
    // Re-measure without animating when the list's size changes (web font swap, breakpoint change).
    const list = listRef.current;
    if (!active || !list) return;
    const ro = new ResizeObserver(() => measure(false));
    ro.observe(list);
    return () => ro.disconnect();
  }, [active]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-spy: highlight the section currently in view.
  useEffect(() => {
    if (pathname !== "/") return;
    const els = navLinks.map((l) => document.getElementById(l.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div
        className={`transition-all duration-300 ${
          scrolled || open ? "glass border-b border-line" : "border-b border-transparent"
        }`}
      >
        <nav className="container-x flex h-16 items-center justify-between gap-6" aria-label="Primary">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="hidden rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted lg:inline">
              The intelligent inbox
            </span>
          </div>

          <ul ref={listRef} className="relative hidden items-center gap-1 md:flex">
            {pill && (
              <li
                aria-hidden
                className={`absolute inset-y-0 left-0 rounded-full bg-sunken ${pill.slide ? `transition-[translate,width] duration-300 ${EASE}` : ""}`}
                style={{ translate: `${pill.left}px 0`, width: pill.width }}
              />
            )}
            {navLinks.map((l) => (
              <li key={l.id}>
                <Link
                  ref={(el) => {
                    if (el) linkRefs.current.set(l.id, el);
                    else linkRefs.current.delete(l.id);
                  }}
                  href={l.href}
                  className={`relative block rounded-full px-3.5 py-2 text-sm transition-colors ${
                    active === l.id ? "text-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  <span className="relative">{l.label}</span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/app" className={buttonClass("ghost", "sm", "max-sm:hidden")}>
              Open app
            </Link>
            <Link href="/download" className={buttonClass("primary", "sm", "max-sm:hidden")}>
              Get the app
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="mobile-menu"
              className="grid size-9 place-items-center rounded-full border border-line md:hidden"
            >
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </nav>
      </div>

      <div
        id="mobile-menu"
        inert={!open}
        aria-hidden={!open}
        className={`overflow-hidden bg-bg/95 backdrop-blur-2xl transition-[height,opacity] duration-300 md:hidden ${EASE} ${
          open ? "h-[calc(100dvh-4rem)] border-b border-line opacity-100" : "h-0 opacity-0"
        }`}
      >
        <div className="container-x flex h-full flex-col gap-1 py-6">
          {navLinks.map((l, i) => (
            <div
              key={l.id}
              className={`transition-[opacity,translate] duration-300 ${EASE} ${open ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0"}`}
              style={{ transitionDelay: open ? `${40 * i + 50}ms` : "0ms" }}
            >
              <Link
                href={l.href}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between border-b border-line py-4 text-2xl font-medium tracking-tight"
              >
                {l.label}
                <ArrowRight className="size-5 text-muted" />
              </Link>
            </div>
          ))}
          <div className="mt-6 flex items-center justify-between">
            <span className="text-sm text-muted">Appearance</span>
            <ThemeSegmented />
          </div>
          <div className="mt-auto grid gap-3 pb-4">
            <button
              onClick={() => {
                setOpen(false);
                openDemo();
              }}
              className={buttonClass("secondary", "lg", "w-full")}
            >
              Get a demo
            </button>
            <Link href="/app" onClick={() => setOpen(false)} className={buttonClass("secondary", "lg", "w-full")}>
              Open app in browser
            </Link>
            <Link href="/download" onClick={() => setOpen(false)} className={buttonClass("primary", "lg", "w-full")}>
              Get the app
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
