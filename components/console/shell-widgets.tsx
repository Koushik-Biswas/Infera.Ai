"use client";

/**
 * Shell widgets: workspace switcher, notifications bell, user menu, theme
 * button, and the "new workspace" / "change password" dialogs.
 */
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, CheckCheck, ChevronsUpDown, KeyRound, LogOut, Monitor, Moon, Plus, Settings, Smartphone, Sun } from "lucide-react";
import { useTheme, useUI } from "@/components/providers";
import { Avatar } from "@/components/app/ui-base";
import { api, invalidate, setCached, useApi } from "@/lib/client/api";
import { errorMessage, fieldErrors, isNotFound } from "@/lib/client/errors";
import { ROLE_LABELS } from "@/lib/client/format";
import type { NotificationDTO } from "@/lib/shared/types";
import { useSession } from "./session";
import { Button, IconButton, TextField } from "./kit/form";
import { Dialog, Menu, MenuItem, MenuLabel, MenuSeparator, Popover, type Placement } from "./kit/overlay";
import { Callout, Spinner } from "./kit/surface";
import { Skeleton } from "./kit/skeleton";
import { TimeAgo } from "./kit/misc";

/** Unread notifications for the current user (shared cache key with any page that lists them). */
export const NOTIFICATIONS_PATH = "/api/v1/notifications?unread=1";
/** Open review items count (sidebar badge, overview). */
export const REVIEW_COUNT_PATH = "/api/v1/review/count";

/* ------------------------- Workspace switcher ------------------------ */

function WorkspaceTile({ name, className = "size-8 text-sm" }: { name: string; className?: string }) {
  const initial = (name.trim()[0] ?? "#").toUpperCase();
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-lg bg-[linear-gradient(135deg,var(--brand),color-mix(in_oklab,var(--brand)_55%,var(--brand-2)))] font-semibold text-white ${className}`}>
      {initial}
    </span>
  );
}

/** Workspace switcher: current workspace + role; lists the user's workspaces; "New workspace…". */
export function WorkspaceSwitcher({ collapsed, placement = "bottom-start" }: { collapsed?: boolean; placement?: Placement }) {
  const { me, workspace, role, switchWorkspace, can } = useSession();
  const { toast } = useUI();
  const [switching, setSwitching] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (!me) {
    return (
      <div className={`flex items-center gap-2.5 rounded-xl p-1.5 ${collapsed ? "justify-center" : ""}`} aria-hidden>
        <Skeleton className="size-8 rounded-lg" />
        {!collapsed && (
          <span className="flex-1">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="mt-1.5 h-3 w-14" />
          </span>
        )}
      </div>
    );
  }

  async function choose(id: string, name: string) {
    if (id === workspace?.id) return;
    setSwitching(id);
    try {
      await switchWorkspace(id);
      toast({ title: `Switched to ${name}` });
    } catch (e) {
      toast({ tone: "info", title: "Couldn't switch workspace", body: errorMessage(e) });
    } finally {
      setSwitching(null);
    }
  }

  const name = workspace?.name ?? "No workspace";
  return (
    <>
      <Menu
        label="Workspaces"
        placement={collapsed ? "right-start" : placement}
        panelClassName="w-72"
        trigger={({ props }) => (
          <button
            type="button"
            {...props}
            title={collapsed ? `${name} — switch workspace` : undefined}
            className={`flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left transition-colors duration-150 hover:bg-sunken ${collapsed ? "justify-center" : ""}`}
          >
            <WorkspaceTile name={name} />
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">{name}</span>
                  <span className="block truncate text-xs text-muted">{role ? ROLE_LABELS[role] : " "}</span>
                </span>
                {switching ? <Spinner className="size-3.5 text-muted" label="Switching workspace" /> : <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />}
              </>
            )}
            {collapsed && <span className="sr-only">{`${name}, switch workspace`}</span>}
          </button>
        )}
      >
        <MenuLabel>Workspaces</MenuLabel>
        <div className="max-h-72 overflow-y-auto">
          {me.workspaces.map((w) => (
            <MenuItem key={w.id} icon={<WorkspaceTile name={w.name} className="size-5 rounded-md text-[10px]" />} description={ROLE_LABELS[w.role]} checked={w.id === workspace?.id} onSelect={() => void choose(w.id, w.name)}>
              {w.name}
            </MenuItem>
          ))}
        </div>
        <MenuSeparator />
        <MenuItem icon={<Plus />} onSelect={() => setCreating(true)}>
          New workspace…
        </MenuItem>
        {can("admin") && (
          <MenuItem icon={<Settings />} href="/console/settings">
            Workspace settings
          </MenuItem>
        )}
      </Menu>
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

/** Dialog: create a workspace (POST /api/workspaces) and switch to it. */
export function NewWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createWorkspace } = useSession();
  const { toast } = useUI();
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const ws = await createWorkspace(name);
      toast({ title: "Workspace created", body: `You're now in ${ws.name}.` });
      setName("");
      onClose();
      router.push("/console");
    } catch (err) {
      setError(fieldErrors(err).name ?? errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!pending}
      title="New workspace"
      description="A separate space with its own channels, collections, members and settings. You'll be its owner."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="new-workspace-form" variant="primary" size="sm" pending={pending} disabled={!name.trim()}>
            Create workspace
          </Button>
        </>
      }
    >
      <form id="new-workspace-form" onSubmit={submit}>
        <TextField label="Workspace name" placeholder="e.g. Acme Traders" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoComplete="organization" error={error} />
      </form>
    </Dialog>
  );
}

/* ---------------------------- Notifications --------------------------- */

/** Bell with unread count; the panel lists unread notifications with "mark read" and "mark all read". */
export function NotificationsButton({ placement = "bottom-end", className = "" }: { placement?: Placement; className?: string }) {
  const router = useRouter();
  const { toast } = useUI();
  const { data, error, loading } = useApi<{ items: NotificationDTO[] }>(NOTIFICATIONS_PATH, { refreshInterval: 60_000 });
  const unavailable = Boolean(error && isNotFound(error) && !data);
  const items = (data?.items ?? []).filter((n) => !n.readAt);
  const count = items.length;

  async function markRead(ids: string[] | "all") {
    let previous: { items: NotificationDTO[] } | undefined;
    setCached<{ items: NotificationDTO[] }>(NOTIFICATIONS_PATH, (prev) => {
      previous = prev;
      return { ...(prev ?? { items: [] }), items: ids === "all" ? [] : (prev?.items ?? []).filter((n) => !ids.includes(n.id)) };
    });
    try {
      await api("/api/v1/notifications/read", { body: ids === "all" ? { all: true } : { ids } });
    } catch (e) {
      if (previous) setCached(NOTIFICATIONS_PATH, () => previous as { items: NotificationDTO[] });
      toast({ tone: "info", title: "Couldn't update notifications", body: errorMessage(e) });
    } finally {
      invalidate("/api/v1/notifications");
    }
  }

  return (
    <Popover
      label="Notifications"
      placement={placement}
      className={className}
      panelClassName="w-[min(22rem,calc(100vw-1.5rem))] p-0"
      trigger={({ props }) => (
        <button
          type="button"
          {...props}
          aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
          title="Notifications"
          className="relative grid size-9 shrink-0 place-items-center rounded-full text-fg-soft transition-colors duration-150 hover:bg-sunken hover:text-fg"
        >
          <Bell className="size-[18px]" aria-hidden />
          {count > 0 && (
            <span aria-hidden className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] leading-none font-semibold text-white ring-2 ring-elev">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="flex max-h-[min(28rem,70dvh)] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold text-fg">Notifications</p>
            {count > 0 && (
              <Button size="xs" variant="ghost" icon={<CheckCheck />} onClick={() => markRead("all")}>
                Mark all read
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {loading ? (
              <div className="flex flex-col gap-3 p-3" aria-hidden>
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            ) : unavailable ? (
              <p className="flex items-center gap-2 px-3 py-6 text-sm text-muted">
                <BellOff className="size-4 shrink-0" aria-hidden /> Notifications aren&apos;t available on this server yet.
              </p>
            ) : error && !data ? (
              <div className="p-2">
                <Callout tone="danger">{errorMessage(error)}</Callout>
              </div>
            ) : count === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">You&apos;re all caught up.</p>
            ) : (
              <ul className="flex flex-col">
                {items.slice(0, 30).map((n) => (
                  <li key={n.id} className="group flex items-start gap-2 rounded-xl px-2.5 py-2 hover:bg-sunken">
                    <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        void markRead([n.id]);
                        if (n.link && n.link.startsWith("/") && !n.link.startsWith("//")) {
                          close();
                          router.push(n.link);
                        }
                      }}
                    >
                      <span className="block text-sm font-medium text-fg">{n.title}</span>
                      {n.body && <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{n.body}</span>}
                      <TimeAgo date={n.createdAt} className="mt-0.5 block text-xs text-muted" />
                    </button>
                    <IconButton size="sm" label="Mark as read" onClick={() => void markRead([n.id])} className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100">
                      <CheckCheck />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Popover>
  );
}

/* ------------------------------ User menu ----------------------------- */

/** Quick light/dark toggle (CSS only). */
export function ThemeButton() {
  const { resolved, toggle } = useTheme();
  const dark = resolved === "dark";
  return (
    <IconButton label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggle}>
      {dark ? <Moon /> : <Sun />}
    </IconButton>
  );
}

/** Avatar + name; menu with change password, on-device app, theme and log out. */
export function UserMenu({ collapsed, placement = "top-start", compact }: { collapsed?: boolean; placement?: Placement; compact?: boolean }) {
  const { me, logout, can } = useSession();
  const { theme, setTheme } = useTheme();
  const [pwOpen, setPwOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  if (!me) {
    return (
      <div className="flex items-center gap-2.5 p-1.5" aria-hidden>
        <Skeleton className="size-8 rounded-full" />
        {!collapsed && !compact && <Skeleton className="h-3.5 w-24" />}
      </div>
    );
  }
  const iconOnly = collapsed || compact;
  return (
    <>
      <Menu
        label="Account"
        placement={collapsed ? "right-end" : placement}
        panelClassName="w-64"
        trigger={({ props }) => (
          <button
            type="button"
            {...props}
            title={iconOnly ? `${me.user.name} — account` : undefined}
            className={`flex min-w-0 items-center gap-2.5 rounded-xl p-1.5 text-left transition-colors duration-150 hover:bg-sunken ${iconOnly ? "" : "w-full"}`}
          >
            <Avatar name={me.user.name || me.user.email} className="size-8 text-xs" />
            {!iconOnly && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{me.user.name}</span>
                <span className="block truncate text-xs text-muted">{me.user.email}</span>
              </span>
            )}
            {iconOnly && <span className="sr-only">Account menu</span>}
            {leaving && <Spinner className="size-3.5 text-muted" label="Signing out" />}
          </button>
        )}
      >
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-semibold text-fg">{me.user.name}</p>
          <p className="truncate text-xs text-muted">{me.user.email}</p>
        </div>
        <MenuSeparator />
        {can("admin") && (
          <MenuItem icon={<Settings />} href="/console/settings">
            Workspace settings
          </MenuItem>
        )}
        {!me.autoLogin && (
          <MenuItem icon={<KeyRound />} onSelect={() => setPwOpen(true)}>
            Change password
          </MenuItem>
        )}
        <MenuItem icon={<Smartphone />} href="/offline" description="Private, works offline">
          On-device app
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        <MenuItem icon={<Sun />} checked={theme === "light"} onSelect={() => setTheme("light")}>
          Light
        </MenuItem>
        <MenuItem icon={<Moon />} checked={theme === "dark"} onSelect={() => setTheme("dark")}>
          Dark
        </MenuItem>
        <MenuItem icon={<Monitor />} checked={theme === "system"} onSelect={() => setTheme("system")}>
          System
        </MenuItem>
        {!me.autoLogin && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={<LogOut />}
              danger
              onSelect={() => {
                setLeaving(true);
                void logout();
              }}
            >
              Log out
            </MenuItem>
          </>
        )}
      </Menu>
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}

/** Dialog: change password (POST /api/auth/password); other sessions are signed out. */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useUI();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string; form?: string }>({});
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setErrors({});
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const local: typeof errors = {};
    if (next.length < 10) local.next = "Use at least 10 characters.";
    if (confirm !== next) local.confirm = "The passwords don't match.";
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setPending(true);
    setErrors({});
    try {
      const r = await api<{ ok: boolean; revokedSessions: number }>("/api/auth/password", { body: { currentPassword: current, newPassword: next } });
      toast({
        title: "Password changed",
        body: r.revokedSessions ? `Signed out ${r.revokedSessions} other session${r.revokedSessions === 1 ? "" : "s"}.` : "You're still signed in here.",
      });
      onClose();
    } catch (err) {
      const f = fieldErrors(err);
      const code = (err as { code?: string })?.code;
      if (code === "invalid_password") setErrors({ current: "Your current password is incorrect." });
      else if (f.newPassword || f.currentPassword) setErrors({ next: f.newPassword, current: f.currentPassword });
      else setErrors({ form: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!pending}
      title="Change password"
      description="Other devices signed in to your account will be signed out."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="change-password-form" variant="primary" size="sm" pending={pending} disabled={!current || !next || !confirm}>
            Change password
          </Button>
        </>
      }
    >
      <form id="change-password-form" onSubmit={submit} className="flex flex-col gap-4">
        <input type="text" name="username" autoComplete="username" className="hidden" readOnly aria-hidden tabIndex={-1} />
        <TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.current} required />
        <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={errors.next} hint="At least 10 characters. A short phrase is easier to remember." minLength={10} required />
        <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} required />
        {errors.form && <Callout tone="danger">{errors.form}</Callout>}
      </form>
    </Dialog>
  );
}

