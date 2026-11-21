"use client";

/**
 * Install instructions dialog (animated, with a QR code for other devices).
 * Loaded on demand by <InstallProvider> the first time it is opened, so motion and
 * qrcode.react stay out of every page's initial JavaScript.
 */
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowRight, Check, MonitorDown, MoreVertical, PlusSquare, Share, SquarePlus, X } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import type { Platform } from "@/lib/site";
import type { Browser } from "./install";

/* ------------------------------------------------------------------ */

const label: Record<Platform, string> = { windows: "Windows", mac: "Mac", ios: "iPhone & iPad", android: "Android" };

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand/12 text-xs font-semibold text-brand">{n}</span>
      <span className="pt-0.5 text-sm leading-relaxed text-fg-soft">{children}</span>
    </li>
  );
}

const K = ({ children }: { children: ReactNode }) => (
  <span className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-line bg-sunken px-1.5 py-0.5 align-middle text-[12px] font-medium text-fg">{children}</span>
);

function stepsFor(target: Platform, browser: Browser, sameDevice: boolean): ReactNode[] {
  if (!sameDevice) {
    return [
      <>Scan the QR code with your {target === "ios" ? "iPhone or iPad camera" : target === "android" ? "Android phone" : "computer's phone"} — it opens Infera.</>,
      target === "ios" ? (
        <>
          In Safari, tap <K><Share className="size-3" /> Share</K> then <K><PlusSquare className="size-3" /> Add to Home Screen</K>.
        </>
      ) : target === "android" ? (
        <>
          Tap <K>Install</K> when Chrome offers it, or <K><MoreVertical className="size-3" /></K> → <K>Install app</K>.
        </>
      ) : (
        <>
          Open this page on your {label[target]} in Chrome or Edge and click <K><MonitorDown className="size-3" /> Install</K> in the address bar.
        </>
      ),
      <>Infera opens like any other app — no sign-up needed, and your data stays on that device.</>,
    ];
  }
  if (target === "ios")
    return [
      browser === "safari" ? <>You&apos;re in Safari — perfect.</> : <>Open this page in <strong>Safari</strong>.</>,
      <>
        Tap <K><Share className="size-3" /> Share</K> at the bottom of the screen.
      </>,
      <>
        Scroll and tap <K><SquarePlus className="size-3" /> Add to Home Screen</K>, then <K>Add</K>.
      </>,
    ];
  if (target === "android")
    return [
      browser === "firefox" ? <>Open this page in <strong>Chrome</strong>.</> : <>You&apos;re in a supported browser.</>,
      <>
        Tap <K><MoreVertical className="size-3" /></K> → <K>Install app</K> (or <K>Add to Home screen</K>).
      </>,
      <>Find Infera in your app drawer. It opens full-screen and works offline.</>,
    ];
  if (target === "mac" && browser === "safari")
    return [
      <>
        In the menu bar choose <K>File</K> → <K>Add to Dock…</K>
      </>,
      <>Click <K>Add</K>. Infera now lives in your Dock and Launchpad.</>,
    ];
  if (browser === "firefox")
    return [
      <>Firefox can&apos;t install web apps. Open this page in <strong>Chrome</strong> or <strong>Edge</strong> to install.</>,
      <>Or keep using Infera right here in your browser — everything works the same.</>,
    ];
  return [
    <>
      Click the <K><MonitorDown className="size-3" /> Install</K> icon at the right of the address bar.
    </>,
    <>
      Or open the browser menu <K><MoreVertical className="size-3" /></K> → <K>Cast, save and share</K> → <K>Install page as app</K>.
    </>,
    <>Infera gets its own window, Start menu / Dock entry and works offline.</>,
  ];
}

export function InstallGuide({ target, env, onClose }: { target: Platform | null; env: { platform: Platform; browser: Browser }; onClose: () => void }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const mobileTarget = target === "ios" || target === "android";
  const sameDevice = target === env.platform || (!mobileTarget && (env.platform === "windows" || env.platform === "mac"));
  return (
    <AnimatePresence>
      {target && (
        <motion.div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Install Infera on ${label[target]}`}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="surface-lg relative w-full max-w-md rounded-t-3xl p-6 sm:rounded-3xl"
          >
            <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 rounded-full p-1.5 text-muted hover:bg-sunken hover:text-fg">
              <X className="size-4" />
            </button>
            <p className="text-xs font-medium tracking-wider text-brand uppercase">Install Infera</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Get Infera on {label[target]}</h2>
            {!sameDevice && origin && (
              <div className="mt-5 flex items-center gap-4 rounded-2xl border border-line bg-sunken/60 p-3">
                <div className="rounded-xl bg-white p-2">
                  <QRCodeSVG value={`${origin}/app`} size={104} level="M" />
                </div>
                <p className="text-sm text-muted">Point your phone&apos;s camera here to open Infera.</p>
              </div>
            )}
            <ol className="mt-5 space-y-3">
              {stepsFor(target, env.browser, sameDevice).map((s, i) => (
                <Step key={i} n={i + 1}>
                  {s}
                </Step>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href="/app" className={buttonClass("brand", "md", "flex-1")}>
                Open Infera now <ArrowRight className="size-4" />
              </a>
              <button onClick={onClose} className={buttonClass("secondary", "md")}>
                <Check className="size-4" /> Done
              </button>
            </div>
            <p className="mt-4 text-xs text-muted">Installed Infera is the same app as the web version — your chats and collections are stored privately on the device.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
