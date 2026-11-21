"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { useInstall } from "@/components/install";
import { LazyQRCode } from "@/components/lazy-qr";
import { buttonClass } from "@/components/ui/button-class";
import { platformLabel, site, type Platform } from "@/lib/site";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "windows";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/mac os x|macintosh/.test(ua)) {
    // iPadOS reports itself as Mac — detect touch.
    if (typeof document !== "undefined" && "ontouchend" in document) return "ios";
    return "mac";
  }
  return "windows";
}

export function usePlatform() {
  const [platform, setPlatform] = useState<Platform>("windows");
  useEffect(() => setPlatform(detectPlatform()), []);
  return platform;
}

/**
 * Installs Infera for a platform. Uses a published store/installer link when
 * one is configured in lib/site.ts; otherwise installs the web app (PWA) —
 * a native install prompt where the browser supports it, step-by-step
 * instructions (or a QR code for another device) everywhere else.
 */
export function useDownload() {
  const { install } = useInstall();
  return (p: Platform) => {
    const href = site.downloads[p];
    if (href) {
      window.location.href = href;
      return;
    }
    void install(p);
  };
}

export function PlatformIcon({ platform, className = "size-4" }: { platform: Platform; className?: string }) {
  switch (platform) {
    case "windows":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <path d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z" />
        </svg>
      );
    case "mac":
    case "ios":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.5-1-2.5-3.9zM14 5.5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z" />
        </svg>
      );
    case "android":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <path d="M17.6 9.5 19.4 6.4a.4.4 0 0 0-.7-.4l-1.8 3.1A11 11 0 0 0 12 8c-1.8 0-3.4.4-4.9 1.1L5.3 6a.4.4 0 0 0-.7.4l1.8 3.1C3.6 11 1.8 13.8 1.5 17h21c-.3-3.2-2.1-6-4.9-7.5zM7 14.4a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm10 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
        </svg>
      );
  }
}

/** Hero download block: primary button matches the visitor's OS. */
export function HeroDownload() {
  const platform = usePlatform();
  const download = useDownload();
  const others = (Object.keys(platformLabel) as Platform[]).filter((p) => p !== platform);

  return (
    <div className="flex flex-col items-center gap-3 lg:items-start">
      <span className="text-xs font-medium tracking-wide text-muted uppercase">Or get started on your own</span>
      <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
        <button onClick={() => download(platform)} className={buttonClass("secondary", "md")}>
          <PlatformIcon platform={platform} />
          Download for {platformLabel[platform]}
          <Download className="size-3.5 text-muted transition group-hover:translate-y-0.5 group-hover:text-fg" />
        </button>
      </div>
      <div className="flex items-center gap-1 text-sm text-muted">
        <span className="mr-1">Also on</span>
        {others.map((p) => (
          <button
            key={p}
            onClick={() => download(p)}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition hover:bg-sunken hover:text-fg"
          >
            <PlatformIcon platform={p} className="size-3.5" />
            {platformLabel[p]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** QR card pointing phones to the install page. */
export function InstallQR({ size = 104, caption }: { size?: number; caption?: ReactNode }) {
  const [url, setUrl] = useState(`${site.url}/download`);
  useEffect(() => setUrl(`${window.location.origin}/download`), []);
  return (
    <div className="surface inline-flex items-center gap-4 rounded-2xl p-3 pr-5">
      <div className="rounded-xl bg-white p-2">
        <LazyQRCode value={url} size={size} level="M" bgColor="#ffffff" fgColor="#0b0b10" />
      </div>
      <div className="max-w-[11rem]">
        <p className="text-sm font-semibold">Want it on your phone too?</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{caption ?? "Scan to install on iPhone or Android."}</p>
      </div>
    </div>
  );
}
