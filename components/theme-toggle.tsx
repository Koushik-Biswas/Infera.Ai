"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePref } from "@/components/providers";

// CSS-only animation: this control sits in the navbar, footer and auth layout, so importing the
// animation library here would add ~50 KB (gzip) to every marketing, legal and sign-in page.
const SPRING = "[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]";

/** Compact icon button: flips between light and dark. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolved === "dark";

  const icon = (shown: boolean) =>
    `col-start-1 row-start-1 grid place-items-center transition-[opacity,translate,rotate] duration-300 ${SPRING} ${
      shown ? "translate-y-0 rotate-0 opacity-100" : "translate-y-3.5 -rotate-40 opacity-0"
    }`;

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={`relative grid size-9 place-items-center overflow-hidden rounded-full border border-line bg-elev/70 text-fg-soft transition hover:border-line-strong hover:text-fg ${className}`}
    >
      <span className="grid">
        <span aria-hidden className={icon(!dark)}>
          <Sun className="size-[17px]" />
        </span>
        <span aria-hidden className={icon(dark)}>
          <Moon className="size-[17px]" />
        </span>
      </span>
    </button>
  );
}

const OPTIONS: { value: ThemePref; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "system", icon: Monitor, label: "System" },
  { value: "dark", icon: Moon, label: "Dark" },
];
/** Button width (size-7 = 28px) + gap (gap-0.5 = 2px). */
const STEP_PX = 30;

/** Three-way segmented control: light / system / dark. */
export function ThemeSegmented() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const activeIndex = OPTIONS.findIndex((o) => o.value === theme);

  return (
    <div role="radiogroup" aria-label="Theme" className="relative inline-flex items-center gap-0.5 rounded-full border border-line bg-elev/70 p-0.5">
      {mounted && activeIndex >= 0 && (
        <span
          aria-hidden
          className="absolute top-0.5 left-0.5 size-7 rounded-full bg-sunken ring-1 ring-line transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: `translateX(${activeIndex * STEP_PX}px)` }}
        />
      )}
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`relative grid size-7 place-items-center rounded-full transition ${active ? "text-fg" : "text-muted hover:text-fg"}`}
          >
            <Icon className="relative size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
