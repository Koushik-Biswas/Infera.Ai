"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Cloud, Database, Download, HardDrive, Lock, Monitor, RotateCcw, Sparkles, Trash2, Upload, User } from "lucide-react";
import { useUI } from "@/components/providers";
import { useInstall } from "@/components/install";
import { ThemeSegmented } from "@/components/theme-toggle";
import { buttonClass } from "@/components/ui/button-class";
import { saveBlob } from "@/lib/app/export";
import { site } from "@/lib/site";
import { useStore } from "../store";
import { bytes, go, inputCls, Toggle } from "../ui";

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="surface rounded-2xl">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
        <span className="text-brand [&>svg]:size-4">{icon}</span>
        {title}
      </h2>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function Item({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function SettingsView() {
  const store = useStore();
  const { settings, updateSettings, cloudAvailable, chats, messages, collections, rows } = store;
  const { toast } = useUI();
  const { install, standalone, installed } = useInstall();
  const [usage, setUsage] = useState<number | null>(null);
  const restore = useRef<HTMLInputElement>(null);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(e.usage ?? null));
    navigator.storage?.persist?.().catch(() => {});
  }, [messages.length]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6 md:px-8">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

        <Section title="Profile" icon={<User />}>
          <Item label="Your name" hint="Used to greet you and to recognise your messages in imported chats.">
            <input defaultValue={settings.userName} onBlur={(e) => updateSettings({ userName: e.target.value.trim() })} placeholder="e.g. Andrews" className={`${inputCls} h-9 max-w-52`} />
          </Item>
          <Item label="Currency" hint="How amounts are shown in collections and exports.">
            <select value={settings.currency} onChange={(e) => updateSettings({ currency: e.target.value })} className={`${inputCls} h-9 w-28`}>
              {["INR", "USD", "AED", "EUR", "GBP", "SGD", "AUD", "CAD"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Item>
          <Item label="Appearance">
            <ThemeSegmented />
          </Item>
        </Section>

        <Section title="AI" icon={<Sparkles />}>
          <Item
            label="Cloud AI (Claude)"
            hint={
              cloudAvailable ? (
                <>Smarter answers and custom collections. Only the messages needed for each request are sent, over HTTPS, and they aren&apos;t stored by Infera. Off = everything stays on this device.</>
              ) : (
                <>Not set up on this server. The on-device engine handles everything. (Admins: set ANTHROPIC_API_KEY on the server to enable.)</>
              )
            }
          >
            <Toggle
              label="Cloud AI"
              on={settings.cloudAI && cloudAvailable}
              onChange={(v) => {
                if (!cloudAvailable) return toast({ tone: "info", title: "Cloud AI isn't available on this server" });
                updateSettings({ cloudAI: v });
              }}
            />
          </Item>
          <Item label="Engine in use" hint={settings.cloudAI && cloudAvailable ? "Claude for answers, plans and custom collections; templates still run on-device for speed." : "On-device: private, instant, works offline."}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-xs ring-1 ring-line">
              {settings.cloudAI && cloudAvailable ? <Cloud className="size-3.5 text-brand" /> : <Lock className="size-3.5 text-brand-2" />}
              {settings.cloudAI && cloudAvailable ? "Claude" : "On-device"}
            </span>
          </Item>
        </Section>

        <Section title="App" icon={<Monitor />}>
          <Item label={standalone ? "Installed" : "Install Infera"} hint={standalone ? "You're using the installed app." : "Get Infera on your home screen, Dock or Start menu. Works offline."}>
            {standalone || installed ? (
              <span className="text-sm text-brand-2">✓ Installed</span>
            ) : (
              <button onClick={() => install()} className={buttonClass("brand", "sm")}>
                <Download className="size-3.5" /> Install
              </button>
            )}
          </Item>
          <Item label="Other devices" hint="Get the app for Windows, Mac, iPhone and Android.">
            <Link href="/download" className={buttonClass("secondary", "sm")}>
              Download page
            </Link>
          </Item>
        </Section>

        <Section title="Your data" icon={<Database />}>
          <Item
            label="Stored on this device"
            hint={`${chats.length} chats · ${messages.length.toLocaleString()} messages · ${collections.length} collections · ${rows.length} rows${usage ? ` · ${bytes(usage)}` : ""}`}
          >
            <HardDrive className="size-4 text-muted" />
          </Item>
          <Item label="Import WhatsApp chats">
            <button onClick={() => go("settings?import=1")} className={buttonClass("secondary", "sm")}>
              <Upload className="size-3.5" /> Import
            </button>
          </Item>
          <Item label="Sample workspace" hint="Load a boutique's chats to try every feature.">
            <button
              onClick={async () => {
                await store.loadSample();
                toast({ title: "Sample workspace loaded" });
              }}
              className={buttonClass("secondary", "sm")}
            >
              <RotateCcw className="size-3.5" /> Load sample
            </button>
          </Item>
          <Item label="Backup" hint="Everything, including media, in one file. Restore it on any device.">
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const blob = await store.exportBackup();
                  saveBlob(`infera-backup-${new Date().toISOString().slice(0, 10)}.json`, blob);
                }}
                className={buttonClass("secondary", "sm")}
              >
                <Download className="size-3.5" /> Export
              </button>
              <button onClick={() => restore.current?.click()} className={buttonClass("secondary", "sm")}>
                <Upload className="size-3.5" /> Restore
              </button>
              <input
                ref={restore}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f || !confirm("Restoring replaces everything currently on this device. Continue?")) return;
                  try {
                    await store.restoreBackup(f);
                    toast({ title: "Backup restored" });
                  } catch (err) {
                    toast({ tone: "info", title: "Couldn't restore", body: err instanceof Error ? err.message : undefined });
                  }
                }}
              />
            </div>
          </Item>
          <Item label="Delete all data" hint="Removes every chat, file and collection from this device. This can't be undone.">
            <button
              onClick={async () => {
                if (!confirm("Delete all Infera data on this device?")) return;
                await store.resetAll();
                toast({ title: "All data deleted" });
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-rose-600 ring-1 ring-rose-500/30 hover:bg-rose-500/10 dark:text-rose-400"
            >
              <Trash2 className="size-3.5" /> Delete
            </button>
          </Item>
        </Section>

        <p className="pb-6 text-center text-xs text-muted">
          {site.name} {site.version} ·{" "}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link href="/support" className="underline">
            Support
          </Link>
        </p>
      </div>
    </div>
  );
}
