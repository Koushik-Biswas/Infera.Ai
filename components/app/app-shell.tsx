"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Download, FolderClosed, MessageCircle, Plus, Search, Settings2, Sparkles } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { useUI } from "@/components/providers";
import { useInstall } from "@/components/install";
import { ThemeToggle } from "@/components/theme-toggle";
import { StoreProvider, useStore } from "./store";
import { CollectionIcon, go, useHashRoute, type Route } from "./ui";
import { AssistantView } from "./views/assistant";

// The default tab (Infera AI) ships with the page; the other views — and the import dialog with its
// zip parser — are separate chunks, prefetched once the app is idle so switching tabs stays instant.
const ChatsView = dynamic(() => import("./views/chats").then((m) => m.ChatsView), { ssr: false, loading: () => <Loading /> });
const CollectionsView = dynamic(() => import("./views/collections").then((m) => m.CollectionsView), { ssr: false, loading: () => <Loading /> });
const SearchView = dynamic(() => import("./views/search").then((m) => m.SearchView), { ssr: false, loading: () => <Loading /> });
const SettingsView = dynamic(() => import("./views/settings").then((m) => m.SettingsView), { ssr: false, loading: () => <Loading /> });
const ImportDialog = dynamic(() => import("./views/import").then((m) => m.ImportDialog), { ssr: false });

function prefetchViews() {
  void import("./views/chats");
  void import("./views/collections");
  void import("./views/search");
  void import("./views/settings");
  void import("./views/import");
}

const tabs = [
  { id: "ai", label: "Infera AI", icon: Sparkles },
  { id: "chats", label: "Chats", icon: MessageCircle },
  { id: "collections", label: "Collections", icon: FolderClosed },
  { id: "search", label: "Search", icon: Search },
] as const;

export function InferaApp() {
  const { toast } = useUI();
  const onError = useCallback((title: string, body?: string) => toast({ tone: "info", title, body }), [toast]);
  return (
    <StoreProvider onError={onError}>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const route = useHashRoute();
  const { ready } = useStore();
  const tab = route.path[0] ?? "ai";

  // Lock page scroll: each pane scrolls on its own, like a native app.
  useEffect(() => {
    document.documentElement.classList.add("app-mode");
    return () => document.documentElement.classList.remove("app-mode");
  }, []);

  const detail = (tab === "chats" || tab === "collections") && Boolean(route.path[1]);
  const importOpen = route.query.get("import") !== null;
  // Mounted on first open, then kept so its close animation can play.
  const [importUsed, setImportUsed] = useState(false);
  if (importOpen && !importUsed) setImportUsed(true);

  useEffect(() => {
    if (!ready) return;
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(prefetchViews, { timeout: 3000 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(prefetchViews, 1500);
    return () => clearTimeout(t);
  }, [ready]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <Sidebar tab={tab} />
      <main id="main" className="relative flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">{ready ? <View tab={tab} route={route} /> : <Loading />}</div>
        {!detail && <BottomNav tab={tab} />}
      </main>
      {(importUsed || importOpen) && (
        <ImportDialog open={importOpen} shared={route.query.get("import") === "shared"} onClose={() => go(route.path.join("/") || "chats", true)} />
      )}
    </div>
  );
}

function View({ tab, route }: { tab: string; route: Route }) {
  switch (tab) {
    case "chats":
      return <ChatsView route={route} />;
    case "collections":
      return <CollectionsView route={route} />;
    case "search":
      return <SearchView route={route} />;
    case "settings":
      return <SettingsView />;
    default:
      return <AssistantView route={route} />;
  }
}

function Loading() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-3 text-muted">
        <LogoMark className="size-10 animate-pulse" />
        <span className="text-sm">Opening your workspace…</span>
      </div>
    </div>
  );
}

function Sidebar({ tab }: { tab: string }) {
  const { collections, chats, rows, settings } = useStore();
  const { install, standalone, installed } = useInstall();
  const unread = chats.reduce((s, c) => s + (c.unread ? 1 : 0), 0);
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-elev/60 md:flex">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2" title="Infera website">
          <LogoMark className="size-7" />
          <span className="font-semibold tracking-tight">
            Infera<span className="text-muted">.Ai</span>
          </span>
        </Link>
        <ThemeToggle />
      </div>
      <nav className="flex flex-col gap-0.5 px-2" aria-label="App">
        {tabs.map((t) => (
          <NavItem key={t.id} active={tab === t.id} onClick={() => go(t.id)} icon={<t.icon className="size-4" />} label={t.label} badge={t.id === "chats" && unread ? unread : undefined} />
        ))}
      </nav>
      <div className="mt-6 flex items-center justify-between px-4">
        <span className="text-xs font-medium tracking-wider text-muted uppercase">Collections</span>
        <button onClick={() => go("ai?new=collection")} aria-label="New collection" className="rounded-md p-1 text-muted hover:bg-sunken hover:text-fg">
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {collections.length === 0 && <p className="px-2 py-2 text-xs text-muted">Ask Infera AI to create your first collection.</p>}
        {collections.map((c) => (
          <NavItem
            key={c.id}
            small
            active={false}
            onClick={() => go(`collections/${c.id}`)}
            icon={<CollectionIcon icon={c.icon} className="size-3.5" />}
            label={c.name}
            badge={rows.filter((r) => r.collectionId === c.id).length}
            muted
          />
        ))}
      </div>
      <div className="border-t border-line p-2">
        {!standalone && !installed && (
          <button onClick={() => install()} className="mb-1 flex w-full items-center gap-3 rounded-xl bg-brand/10 px-3 py-2.5 text-sm font-medium text-brand transition hover:bg-brand/15">
            <Download className="size-4" /> Install the app
          </button>
        )}
        <NavItem active={tab === "settings"} onClick={() => go("settings")} icon={<Settings2 className="size-4" />} label={settings.userName ? `${settings.userName} · Settings` : "Settings"} />
      </div>
    </aside>
  );
}

function NavItem({ active, onClick, icon, label, badge, small, muted }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; badge?: number; small?: boolean; muted?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-3 text-left transition ${small ? "py-1.5 text-[13px]" : "py-2 text-sm"} ${
        active ? "bg-sunken font-medium text-fg" : muted ? "text-fg-soft hover:bg-sunken hover:text-fg" : "text-fg-soft hover:bg-sunken hover:text-fg"
      }`}
    >
      <span className={active ? "text-brand" : "text-muted"}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <span className="rounded-full bg-sunken px-1.5 text-[11px] text-muted tabular-nums ring-1 ring-line">{badge}</span> : null}
    </button>
  );
}

function BottomNav({ tab }: { tab: string }) {
  return (
    <nav className="glass flex shrink-0 justify-around border-t border-line px-2 pt-1.5 pb-[max(env(safe-area-inset-bottom),0.5rem)] md:hidden" aria-label="App">
      {tabs.map((t) => {
        const active = tab === t.id || (t.id === "ai" && !tabs.some((x) => x.id === tab) && tab !== "settings");
        return (
          <button key={t.id} onClick={() => go(t.id)} aria-current={active ? "page" : undefined} className="flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px]">
            <span className={`grid h-7 w-14 place-items-center rounded-full transition ${active ? "bg-brand/12 text-brand" : "text-muted"}`}>
              <t.icon className="size-[18px]" />
            </span>
            <span className={active ? "font-medium text-fg" : "text-muted"}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
