"use client";

import { useEffect, useState } from "react";
import { Check, Download, QrCode, ScanLine, Sparkles } from "lucide-react";
import { InstallQR, PlatformIcon, useDownload, usePlatform } from "@/components/download-buttons";
import { useInstall } from "@/components/install";
import Link from "next/link";
import { ArrowRight, Globe } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { platformLabel, site, type Platform } from "@/lib/site";

const meta: Record<Platform, { req: string; kind: string }> = {
  windows: { req: "Windows 10 or later · Chrome or Edge", kind: "Desktop app" },
  mac: { req: "macOS 12 or later · Chrome, Edge or Safari 17+", kind: "Desktop app" },
  ios: { req: "iOS 16.4 or later · iPhone & iPad", kind: "Home Screen app" },
  android: { req: "Android 9 or later · Chrome", kind: "Android app" },
};

const steps = [
  { icon: Download, title: "Install Infera", body: "One click on desktop, Add to Home Screen on iPhone." },
  { icon: ScanLine, title: "Import your chats", body: "WhatsApp → Export chat → share or drop it into Infera." },
  { icon: Sparkles, title: "Ask for your first table", body: "“Find all orders from the last month.”" },
];

export function DownloadGrid() {
  const current = usePlatform();
  const [detected, setDetected] = useState(false);
  useEffect(() => setDetected(true), []);
  const download = useDownload();
  const { installed, standalone } = useInstall();
  const order: Platform[] = [current, ...(["windows", "mac", "ios", "android"] as Platform[]).filter((p) => p !== current)];

  return (
    <>
      <div className="mx-auto mt-14 grid max-w-5xl gap-4 sm:grid-cols-3">
        {order.map((p, i) => {
          const primary = i === 0;
          return (
            <div
              key={p}
              // Hidden until the device is detected (first effect), so the cards never visibly reorder.
              className={`relative flex flex-col rounded-3xl p-7 ${detected ? "card-in" : "opacity-0"} ${primary ? "surface-lg ring-gradient sm:col-span-3 sm:flex-row sm:items-center sm:gap-8" : "surface"}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span
                className={`grid shrink-0 place-items-center rounded-2xl ${primary ? "size-20 bg-fg text-bg" : "size-14 bg-sunken text-fg ring-1 ring-line"}`}
              >
                <PlatformIcon platform={p} className={primary ? "size-9" : "size-6"} />
              </span>
              <div className={`mt-5 flex-1 ${primary ? "sm:mt-0" : ""}`}>
                {primary && (
                  <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-brand/12 px-2 py-0.5 text-[11px] font-medium text-brand">
                    <Check className="size-3" /> Recommended for your device
                  </span>
                )}
                <h2 className={`${primary ? "text-2xl" : "text-xl"} font-semibold tracking-tight`}>Infera for {platformLabel[p]}</h2>
                <p className="mt-1 text-sm text-muted">
                  {meta[p].kind} · {meta[p].req}
                </p>
              </div>
              <button onClick={() => download(p)} className={buttonClass(primary ? "brand" : "secondary", primary ? "lg" : "md", primary ? "mt-6 sm:mt-0" : "mt-6 self-start")}>
                <Download className="size-4" />
                {primary && installed ? "Installed ✓" : `Install on ${platformLabel[p]}`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mx-auto mt-6 flex max-w-5xl flex-col items-center justify-between gap-4 rounded-3xl bg-brand/8 p-6 sm:flex-row">
        <div className="flex items-center gap-3">
          <Globe className="size-5 text-brand" />
          <div>
            <p className="text-sm font-semibold">{standalone ? "You're in the installed app" : "No install needed to try it"}</p>
            <p className="text-sm text-muted">The same app runs right in your browser — your data stays on your device.</p>
          </div>
        </div>
        <Link href="/app" className={buttonClass("primary", "md")}>
          Open Infera <ArrowRight className="size-4" />
        </Link>
      </div>

      <div className="mx-auto mt-6 flex max-w-5xl flex-col items-center justify-between gap-6 rounded-3xl border border-dashed border-line-strong p-6 sm:flex-row">
        <div className="flex items-center gap-3">
          <QrCode className="size-5 text-muted" />
          <p className="text-sm text-muted">On a computer? Scan with your phone to install the mobile app.</p>
        </div>
        <InstallQR size={88} />
      </div>

      <div className="mx-auto mt-20 max-w-5xl">
        <p className="text-center text-sm font-medium tracking-wider text-muted uppercase">Up and running in 60 seconds</p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="relative rounded-3xl border border-line p-6">
              <span className="font-mono text-xs text-muted">0{i + 1}</span>
              <s.icon className="mt-4 size-5 text-brand" />
              <p className="mt-3 font-semibold">{s.title}</p>
              <p className="mt-1 text-sm text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-center text-xs text-muted">Current version {site.version}</p>
      </div>
    </>
  );
}
