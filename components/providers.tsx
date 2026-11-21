"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { CircleCheck, Info, X } from "lucide-react";
import { InstallProvider } from "@/components/install";
import { THEME_STORAGE_KEY as STORAGE_KEY } from "@/lib/init-scripts";

// Wrapped around every page (console included): keep it light. The demo form (and the animation
// library it uses) loads only when first opened; toasts animate with CSS.
const DemoModal = dynamic(() => import("@/components/demo-modal").then((m) => m.DemoModal), { ssr: false });

/* ------------------------------------------------------------------ */
/*  Theme                                                              */
/* ------------------------------------------------------------------ */
export type ThemePref = "light" | "dark" | "system";

type ThemeCtx = {
  theme: ThemePref;
  resolved: "light" | "dark";
  setTheme: (t: ThemePref) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeCtx | null>(null);
// The pre-paint theme script lives in lib/init-scripts.ts (a server-importable module).

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(dark: boolean) {
  const root = document.documentElement;
  // Disable transitions for one frame so every surface swaps in sync.
  root.classList.add("theme-switching");
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  requestAnimationFrame(() => root.classList.remove("theme-switching"));
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePref>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemePref | null) ?? "system";
    setThemeState(stored);
    setResolved(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme(mq.matches);
      setResolved(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: ThemePref) => {
    const dark = t === "dark" || (t === "system" && systemPrefersDark());
    localStorage.setItem(STORAGE_KEY, t);
    applyTheme(dark);
    setThemeState(t);
    setResolved(dark ? "dark" : "light");
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  const value = useMemo(() => ({ theme, resolved, setTheme, toggle }), [theme, resolved, setTheme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <Providers>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  UI: demo modal + toasts                                            */
/* ------------------------------------------------------------------ */
type Toast = { id: number; title: string; body?: string; tone?: "success" | "info"; leaving?: boolean };
const TOAST_EXIT_MS = 180;

type UICtx = {
  openDemo: () => void;
  toast: (t: Omit<Toast, "id">) => void;
};

const UIContext = createContext<UICtx | null>(null);

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside <Providers>");
  return ctx;
}

function UIProvider({ children }: { children: ReactNode }) {
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoUsed, setDemoUsed] = useState(false);
  if (demoOpen && !demoUsed) setDemoUsed(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  /** Fade out, then remove. */
  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), TOAST_EXIT_MS);
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  const openDemo = useCallback(() => setDemoOpen(true), []);

  // Allow deep links like /#demo to open the form.
  useEffect(() => {
    const check = () => {
      if (window.location.hash === "#demo") {
        setDemoOpen(true);
        history.replaceState(null, "", window.location.pathname);
      }
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  const value = useMemo(() => ({ openDemo, toast }), [openDemo, toast]);

  return (
    <UIContext.Provider value={value}>
      {children}
      {(demoUsed || demoOpen) && <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6"
      >
        {toasts.map((t) => (
            <div
              key={t.id}
              className={`surface-lg pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl p-4 transition-[opacity,translate,scale] duration-200 ease-out starting:translate-y-4 starting:scale-96 starting:opacity-0 ${
                t.leaving ? "translate-y-2 scale-98 opacity-0" : "translate-y-0 scale-100 opacity-100"
              }`}
            >
              {t.tone === "info" ? (
                <Info className="mt-0.5 size-5 shrink-0 text-brand" />
              ) : (
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-brand-2" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.body && <p className="mt-0.5 text-sm text-muted">{t.body}</p>}
              </div>
              <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-fg">
                <X className="size-4" />
              </button>
            </div>
          ))}
      </div>
    </UIContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <UIProvider>
        <InstallProvider>{children}</InstallProvider>
      </UIProvider>
    </ThemeProvider>
  );
}
