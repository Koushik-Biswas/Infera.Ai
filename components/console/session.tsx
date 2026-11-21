"use client";

/**
 * Console session: who is signed in, the active workspace and the user's role.
 *
 *   const { me, workspace, role, can, ready } = useSession();
 *   if (can("admin")) …          // false until the session has loaded
 *
 * `/api/auth/me` is persisted to sessionStorage, so the shell paints instantly
 * on reload while it revalidates. A signed-out visitor never gets here
 * (`proxy.ts` + the API client's 401 redirect); a user without a workspace is
 * sent to /onboarding.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiClientError, api, clearApiCache, setCached, useApi } from "@/lib/client/api";
import { roleAtLeast, type MeDTO, type Role, type UserDTO, type WorkspaceDTO } from "@/lib/shared/types";

/** Path of the session endpoint (cached + persisted). */
export const ME_PATH = "/api/auth/me";

export type SessionValue = {
  /** Full MeDTO once loaded (undefined on the very first load without a persisted copy). */
  me: MeDTO | undefined;
  user: UserDTO | null;
  workspace: WorkspaceDTO | null;
  role: Role | null;
  /** True once `me` is available. */
  ready: boolean;
  /** Last error loading the session (network/server). */
  error: ApiClientError | undefined;
  /** Bumped on workspace switch/reset — the shell remounts pages with it so every list refetches. */
  generation: number;
  /** Role check: `can("admin")` is true for admins and owners. False while loading. */
  can: (min: Role) => boolean;
  /** Revalidate `/api/auth/me`. */
  refresh: () => Promise<void>;
  /** Switch the active workspace (clears every cached response). */
  switchWorkspace: (workspaceId: string) => Promise<void>;
  /** Create a workspace and switch to it. */
  createWorkspace: (name: string) => Promise<WorkspaceDTO>;
  /** Forget all cached data and reload the session (after leaving/deleting a workspace). */
  reset: () => Promise<MeDTO>;
  /** Sign out and go to /login. */
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

/** Leave per-record detail pages when the workspace changes (their ids belong to the old workspace). */
function sectionRoot(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "console" || parts.length <= 2 || parts[1] === "settings") return null;
  return `/${parts[0]}/${parts[1]}`;
}

/** Provides `useSession()` to the console. Mount once, in the console layout. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me, error, reload } = useApi<MeDTO>(ME_PATH, { persist: true });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (me && !me.workspace) router.replace(`/onboarding?next=${encodeURIComponent(pathname)}`);
  }, [me, router, pathname]);

  const role = me?.role ?? null;

  function adopt(next: MeDTO) {
    clearApiCache();
    setCached<MeDTO>(ME_PATH, () => next);
    setGeneration((g) => g + 1);
    const root = sectionRoot(pathname);
    if (root) router.replace(root);
    router.refresh();
  }

  async function switchWorkspace(workspaceId: string) {
    const next = await api<MeDTO>("/api/auth/switch-workspace", { body: { workspaceId } });
    adopt(next);
  }

  async function createWorkspace(name: string) {
    const ws = await api<WorkspaceDTO>("/api/workspaces", { body: { name } });
    const next = await api<MeDTO>(ME_PATH);
    adopt(next);
    return ws;
  }

  async function reset() {
    const next = await api<MeDTO>(ME_PATH);
    adopt(next);
    return next;
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* the cookie is cleared server-side when possible; leave either way */
    }
    router.replace("/login");
    clearApiCache();
  }

  const value: SessionValue = {
    me,
    user: me?.user ?? null,
    workspace: me?.workspace ?? null,
    role,
    ready: Boolean(me),
    error,
    generation,
    can: (min: Role) => (role ? roleAtLeast(role, min) : false),
    refresh: reload,
    switchWorkspace,
    createWorkspace,
    reset,
    logout,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The console session. Must be used under `<SessionProvider>` (every console page is). */
export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider> (the console layout).");
  return ctx;
}

/** Like `useSession()` but returns null outside the console (for shared widgets). */
export function useOptionalSession(): SessionValue | null {
  return useContext(SessionContext);
}
