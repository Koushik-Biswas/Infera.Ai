"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { Platform } from "@/lib/site";

// The instructions dialog (motion + QR code) loads only when first opened.
const InstallGuide = dynamic(() => import("./install-guide").then((m) => m.InstallGuide), { ssr: false });

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

declare global {
  interface Window {
    __bip?: BIPEvent | null;
  }
}

// The <head> script that catches an early install prompt lives in lib/init-scripts.ts.

export type Browser = "chrome" | "edge" | "safari" | "firefox" | "samsung" | "other";

function detect(): { platform: Platform; browser: Browser; standalone: boolean } {
  const ua = navigator.userAgent;
  const l = ua.toLowerCase();
  let platform: Platform = "windows";
  if (/iphone|ipad|ipod/.test(l) || (/macintosh/.test(l) && "ontouchend" in document)) platform = "ios";
  else if (/android/.test(l)) platform = "android";
  else if (/mac os x|macintosh/.test(l)) platform = "mac";
  let browser: Browser = "other";
  if (/samsungbrowser/.test(l)) browser = "samsung";
  else if (/edg\//.test(l)) browser = "edge";
  else if (/firefox|fxios/.test(l)) browser = "firefox";
  else if (/crios|chrome|chromium/.test(l)) browser = platform === "ios" ? "safari" : "chrome"; // all iOS browsers are WebKit
  else if (/safari/.test(l)) browser = "safari";
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return { platform, browser, standalone };
}

type InstallCtx = {
  platform: Platform;
  browser: Browser;
  standalone: boolean;
  canPrompt: boolean;
  installed: boolean;
  /** Installs on this device if possible, otherwise opens step-by-step instructions. */
  install: (target?: Platform) => Promise<void>;
};

const Ctx = createContext<InstallCtx | null>(null);

export function useInstall() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useInstall must be used inside <InstallProvider>");
  return c;
}

export function InstallProvider({ children }: { children: ReactNode }) {
  const [env, setEnv] = useState({ platform: "windows" as Platform, browser: "other" as Browser, standalone: false });
  const [bip, setBip] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [guide, setGuide] = useState<Platform | null>(null);
  const guideUsed = useGuideUsed(guide);

  useEffect(() => {
    setEnv(detect());
    setBip(window.__bip ?? null);
    const onBip = () => setBip(window.__bip ?? null);
    const onInstalled = () => {
      setInstalled(true);
      setBip(null);
      window.__bip = null;
    };
    window.addEventListener("infera-bip", onBip);
    window.addEventListener("appinstalled", onInstalled);
    const secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if ("serviceWorker" in navigator && secure && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    return () => {
      window.removeEventListener("infera-bip", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(
    async (target?: Platform) => {
      const t = target ?? env.platform;
      if (env.standalone) {
        window.location.href = "/app";
        return;
      }
      if (t === env.platform && bip) {
        await bip.prompt();
        const choice = await bip.userChoice;
        window.__bip = null;
        setBip(null);
        if (choice.outcome === "accepted") setInstalled(true);
        return;
      }
      setGuide(t);
    },
    [bip, env],
  );

  const value = useMemo(() => ({ ...env, canPrompt: Boolean(bip), installed, install }), [env, bip, installed, install]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Mounted from the first open on, so its close animation can play. */}
      {guideUsed && <InstallGuide target={guide} env={env} onClose={() => setGuide(null)} />}
    </Ctx.Provider>
  );
}

/** True once the guide has been opened at least once. */
function useGuideUsed(guide: Platform | null): boolean {
  const [used, setUsed] = useState(false);
  if (guide && !used) setUsed(true);
  return used || Boolean(guide);
}
