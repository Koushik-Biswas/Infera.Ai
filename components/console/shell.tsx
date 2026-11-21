"use client";

/**
 * Console chrome: collapsible sidebar (desktop), top bar + drawer + bottom
 * nav (mobile), workspace switcher, notifications, user menu and the "/"
 * search shortcut. Pages render inside `<main id="main">`.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Cable,
  FlaskConical,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { LogoMark } from "@/components/logo";
import { useApi } from "@/lib/client/api";
import type { Role } from "@/lib/shared/types";
import { useSession } from "./session";
import { ConsoleNavLink, LinkPendingDot } from "./nav-link";
import { NOTIFICATIONS_PATH, NotificationsButton, REVIEW_COUNT_PATH, ThemeButton, UserMenu, WorkspaceSwitcher } from "./shell-widgets";
import { Button, IconButton } from "./kit/form";
import { Drawer } from "./kit/overlay";
import { Callout, Kbd } from "./kit/surface";

/* -------------------------------- Nav -------------------------------- */

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** API paths the destination reads first — warmed on hover/focus/touch. */
  data?: string[];
  minRole?: Role;
  badge?: "review";
  hotkey?: string;
};

/** Sidebar sections. `data` paths must match the first `useApi` path of each page so the warm-up is a cache hit. */
export const CONSOLE_NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { href: "/console", label: "Overview", icon: LayoutDashboard, data: ["/api/v1/analytics?days=30", "/api/v1/events?limit=10"] },
      { href: "/console/inbox", label: "Inbox", icon: Inbox, data: ["/api/v1/conversations"] },
      { href: "/console/collections", label: "Collections", icon: FolderKanban, data: ["/api/v1/collections"] },
      { href: "/console/review", label: "Review", icon: ListChecks, data: ["/api/v1/review?status=open"], badge: "review" },
      { href: "/console/search", label: "Search", icon: Search, hotkey: "/" },
      { href: "/console/assistant", label: "Assistant", icon: Sparkles, data: ["/api/v1/assistant/threads"] },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/console/automations", label: "Automations", icon: Workflow, data: ["/api/v1/automations"] },
      { href: "/console/channels", label: "Channels", icon: Cable, data: ["/api/v1/channels"] },
      { href: "/console/playground", label: "Playground", icon: FlaskConical, data: ["/api/v1/collections"] },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/console/audit", label: "Audit log", icon: ScrollText, data: ["/api/v1/audit"], minRole: "admin" },
      { href: "/console/settings", label: "Settings", icon: Settings, data: ["/api/v1/workspace"] },
    ],
  },
];

/** Open review count for badges (polled every 30 s, persisted for instant paint). */
export function useReviewCount(): number {
  const { data } = useApi<{ open: number }>(REVIEW_COUNT_PATH, { refreshInterval: 30_000, persist: true });
  return typeof data?.open === "number" ? data.open : 0;
}

function CountBadge({ n, collapsed }: { n: number; collapsed?: boolean }) {
  if (!n) return null;
  const text = n > 99 ? "99+" : String(n);
  if (collapsed) {
    return (
      <span aria-hidden className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-none font-semibold text-white">
        {text}
      </span>
    );
  }
  return <span className="ml-auto rounded-full bg-brand/12 px-1.5 text-[11px] leading-5 font-medium text-brand tabular-nums">{text}</span>;
}

function SidebarNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { can, ready } = useSession();
  const reviews = useReviewCount();
  return (
    <nav aria-label="Console" className="flex flex-col gap-4">
      {CONSOLE_NAV.map((section) => {
        const items = section.items.filter((i) => !i.minRole || (ready && can(i.minRole)));
        if (!items.length) return null;
        return (
          <div key={section.label}>
            {collapsed ? <div className="mx-3 mb-2 h-px bg-line first:hidden" aria-hidden /> : <p className="px-3 pb-1 text-[11px] font-medium tracking-wider text-muted uppercase">{section.label}</p>}
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const badge = item.badge === "review" ? reviews : 0;
                return (
                  <li key={item.href}>
                    <ConsoleNavLink
                      href={item.href}
                      prefetchData={item.data}
                      pendingIndicator="none"
                      onClick={onNavigate}
                      title={collapsed ? item.label : undefined}
                      className={({ active }) =>
                        `relative flex items-center gap-3 rounded-xl text-sm transition-colors duration-150 ${collapsed ? "justify-center px-0 py-2" : "px-3 py-2"} ${
                          active ? "bg-sunken font-medium text-fg" : "text-fg-soft hover:bg-sunken hover:text-fg"
                        }`
                      }
                    >
                      {({ active }) => (
                        <>
                          <item.icon className={`size-4 shrink-0 ${active ? "text-brand" : "text-muted"}`} aria-hidden />
                          {collapsed ? (
                            <span className="sr-only">
                              {item.label}
                              {badge ? `, ${badge} open` : ""}
                            </span>
                          ) : (
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          )}
                          {!collapsed && item.hotkey && !badge && <Kbd className="ml-auto">{item.hotkey}</Kbd>}
                          <CountBadge n={badge} collapsed={collapsed} />
                          {!collapsed && <span className="sr-only">{badge ? `, ${badge} open` : ""}</span>}
                          <LinkPendingDot className={collapsed ? "absolute bottom-1 left-1/2 -translate-x-1/2" : ""} />
                        </>
                      )}
                    </ConsoleNavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/* ------------------------- Sidebar collapse state --------------------- */

const COLLAPSE_KEY = "infera:console:sidebar";
const collapseSubs = new Set<() => void>();
function subscribeCollapse(cb: () => void) {
  collapseSubs.add(cb);
  const onStorage = (e: StorageEvent) => e.key === COLLAPSE_KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    collapseSubs.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  } catch {
    /* private mode */
  }
  for (const cb of collapseSubs) cb();
}

/* -------------------------------- Shell ------------------------------- */

function DesktopSidebar() {
  const collapsed = useSyncExternalStore(subscribeCollapse, readCollapsed, () => false);
  return (
    <aside
      className={`sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-line bg-elev/60 transition-[width] duration-150 md:flex ${collapsed ? "w-[4.25rem]" : "w-60"}`}
      aria-label="Sidebar"
    >
      <div className={`flex h-14 shrink-0 items-center gap-2 ${collapsed ? "justify-center px-2" : "justify-between pr-2 pl-4"}`}>
        {!collapsed && (
          <Link href="/console" className="flex min-w-0 items-center gap-2 rounded-lg" aria-label="Infera console home">
            <LogoMark className="size-7 shrink-0" />
            <span className="truncate font-semibold tracking-tight">
              Infera<span className="text-muted">.Ai</span>
            </span>
          </Link>
        )}
        <IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => writeCollapsed(!collapsed)} aria-expanded={!collapsed}>
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </IconButton>
      </div>
      <div className="shrink-0 px-2 pb-3">
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-3">
        <SidebarNav collapsed={collapsed} />
      </div>
      <div className={`shrink-0 border-t border-line p-2 ${collapsed ? "flex flex-col items-center gap-1" : "flex flex-col gap-1"}`}>
        <div className={`flex items-center ${collapsed ? "flex-col gap-1" : "gap-1 px-1"}`}>
          <NotificationsButton placement={collapsed ? "right-end" : "top-start"} />
          <ThemeButton />
        </div>
        <UserMenu collapsed={collapsed} placement="top-start" />
      </div>
    </aside>
  );
}

function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const reviews = useReviewCount();
  const items = [CONSOLE_NAV[0].items[0], CONSOLE_NAV[0].items[1], CONSOLE_NAV[0].items[3], CONSOLE_NAV[0].items[2]];
  return (
    <nav aria-label="Primary" className="glass fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line px-1 pt-1.5 pb-[max(env(safe-area-inset-bottom),0.4rem)] md:hidden">
      {items.map((item) => (
        <ConsoleNavLink key={item.href} href={item.href} prefetchData={item.data} pendingIndicator="pulse" className="flex flex-1 flex-col items-center gap-0.5 py-0.5 text-[11px]">
          {({ active }) => (
            <span className="flex flex-col items-center gap-0.5">
              <span className={`relative grid h-7 w-12 place-items-center rounded-full transition-colors duration-150 ${active ? "bg-brand/12 text-brand" : "text-muted"}`}>
                <item.icon className="size-[18px]" aria-hidden />
                {item.badge === "review" && reviews > 0 && (
                  <span className="absolute -top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-none font-semibold text-white">
                    {reviews > 99 ? "99+" : reviews}
                    <span className="sr-only"> open</span>
                  </span>
                )}
              </span>
              <span className={active ? "font-medium text-fg" : "text-muted"}>{item.label}</span>
            </span>
          )}
        </ConsoleNavLink>
      ))}
      <button type="button" onClick={onMore} className="flex flex-1 flex-col items-center gap-0.5 py-0.5 text-[11px]">
        <span className="grid h-7 w-12 place-items-center rounded-full text-muted">
          <MenuIcon className="size-[18px]" aria-hidden />
        </span>
        <span className="text-muted">More</span>
      </button>
    </nav>
  );
}

function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  const { workspace } = useSession();
  return (
    <header className="glass sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-line px-2 md:hidden">
      <IconButton label="Open menu" onClick={onMenu}>
        <MenuIcon />
      </IconButton>
      <Link href="/console" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1" aria-label="Console home">
        <LogoMark className="size-7 shrink-0" />
        <span className="truncate text-sm font-semibold">{workspace?.name ?? "Infera"}</span>
      </Link>
      <Link href="/console/search" aria-label="Search" title="Search" className="grid size-9 place-items-center rounded-full text-fg-soft hover:bg-sunken hover:text-fg">
        <Search className="size-[18px]" aria-hidden />
      </Link>
      <NotificationsButton placement="bottom-end" />
      <UserMenu compact placement="bottom-end" />
    </header>
  );
}

/** "/" anywhere (outside inputs and dialogs) opens search; on the search page it focuses the search box. */
function useSearchHotkey() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      if (pathname === "/console/search") window.dispatchEvent(new CustomEvent("infera:focus-search"));
      else router.push("/console/search");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);
}

/** The console frame. Mount inside `<SessionProvider>`. */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { error, me, refresh } = useSession();
  const [drawer, setDrawer] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setDrawer(false);
  }
  useSearchHotkey();

  return (
    <div className="min-h-dvh bg-bg text-fg md:flex">
      <DesktopSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar onMenu={() => setDrawer(true)} />
        {error && !me && error.status !== 401 && (
          <div className="px-4 pt-4 sm:px-6 lg:px-8">
            <Callout
              tone="danger"
              title="Couldn't load your account"
              action={
                <Button size="sm" onClick={refresh}>
                  Try again
                </Button>
              }
            >
              {error.code === "network" ? "You seem to be offline." : error.message}
            </Callout>
          </div>
        )}
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 pb-20 outline-none md:pb-0">
          {children}
        </main>
      </div>
      <MobileBottomNav onMore={() => setDrawer(true)} />
      <Drawer open={drawer} onClose={() => setDrawer(false)} side="left" width="sm" title="Infera console">
        <div className="-mx-3 -mt-2 flex flex-col gap-4">
          <WorkspaceSwitcher placement="bottom-start" />
          <SidebarNav onNavigate={() => setDrawer(false)} />
          <div className="flex items-center gap-1 border-t border-line px-1 pt-3">
            <ThemeButton />
            <span className="text-sm text-muted">Theme</span>
          </div>
        </div>
      </Drawer>
    </div>
  );
}

/** Kept for pages that want to re-use the notifications cache key. */
export { NOTIFICATIONS_PATH, REVIEW_COUNT_PATH };
