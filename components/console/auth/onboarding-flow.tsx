"use client";

/**
 * /onboarding — create a first (or another) workspace. Signed-out visitors
 * are sent to /login by the API client's 401 handling.
 */
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Building2, LogOut } from "lucide-react";
import { Avatar } from "@/components/app/ui-base";
import { api, clearApiCache, useApi } from "@/lib/client/api";
import { errorMessage, fieldErrors } from "@/lib/client/errors";
import { START_PATH, safeNext } from "@/lib/client/browser";
import { ROLE_LABELS } from "@/lib/client/format";
import type { MeDTO, WorkspaceDTO } from "@/lib/shared/types";
import { ME_PATH } from "../session";
import { Button, TextField } from "../kit/form";
import { Callout } from "../kit/surface";
import { AuthCard, AuthCardSkeleton } from "./auth-card";
import { adoptSession } from "./login-form";

/** Reads `?next=` (needs a Suspense boundary — see the page). */
export function OnboardingWithParams() {
  const params = useSearchParams();
  return <OnboardingFlow next={params.get("next")} />;
}

export function OnboardingFlow({ next }: { next: string | null }) {
  const router = useRouter();
  const { data: me, error, reload } = useApi<MeDTO>(ME_PATH, { persist: true });
  const [name, setName] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const dest = safeNext(next);

  useEffect(() => {
    router.prefetch(START_PATH);
  }, [router]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!name.trim()) {
      setFieldError("Enter a workspace name.");
      return;
    }
    setPending("create");
    setFieldError(null);
    setFormError(null);
    try {
      await api<WorkspaceDTO>("/api/workspaces", { body: { name: name.trim() } });
      const fresh = await api<MeDTO>(ME_PATH);
      adoptSession(fresh);
      router.replace(dest);
    } catch (err) {
      setPending(null);
      const f = fieldErrors(err);
      if (f.name) setFieldError(f.name);
      else setFormError(errorMessage(err));
    }
  }

  async function open(workspaceId: string) {
    if (pending) return;
    setPending(workspaceId);
    setFormError(null);
    try {
      const fresh = await api<MeDTO>("/api/auth/switch-workspace", { body: { workspaceId } });
      adoptSession(fresh);
      router.replace(dest);
    } catch (err) {
      setPending(null);
      setFormError(errorMessage(err));
    }
  }

  async function signOut() {
    setPending("logout");
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* leave anyway */
    }
    clearApiCache();
    router.replace("/login");
  }

  if (!me) {
    if (error && error.status !== 401) {
      return (
        <AuthCard title="Couldn't load your account" description={errorMessage(error)}>
          <Button onClick={reload} className="w-full">
            Try again
          </Button>
        </AuthCard>
      );
    }
    return <AuthCardSkeleton fields={1} />;
  }

  const existing = me.workspaces;
  return (
    <AuthCard
      icon={<Building2 />}
      title={existing.length ? "Create a workspace" : "Create your workspace"}
      description="A workspace holds your channels, collections, records and team. Usually one per business."
      footer={
        <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={me.user.name || me.user.email} className="size-5 text-[9px]" />
            {me.user.email}
          </span>
          <span aria-hidden>·</span>
          <button type="button" onClick={signOut} disabled={pending === "logout"} className="inline-flex items-center gap-1 font-medium text-brand hover:underline disabled:opacity-60">
            <LogOut className="size-3.5" aria-hidden /> Sign out
          </button>
        </span>
      }
    >
      <form onSubmit={create} className="flex flex-col gap-4" noValidate>
        <TextField
          label="Workspace name"
          name="workspaceName"
          autoComplete="organization"
          required
          autoFocus
          maxLength={80}
          placeholder="e.g. Acme Traders"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldError}
          hint="You'll be the owner. Default collections (orders, leads, payments…) are created for you."
        />
        {formError && <Callout tone="danger">{formError}</Callout>}
        <Button type="submit" variant="primary" size="lg" pending={pending === "create"} disabled={Boolean(pending && pending !== "create")} className="w-full">
          Create workspace
        </Button>
      </form>

      {existing.length > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="mb-2 text-[13px] font-medium text-fg-soft">Or open one of your workspaces</p>
          <ul className="flex flex-col gap-1.5">
            {existing.map((w) => (
              <li key={w.id}>
                <Button variant="ghost" className="h-auto w-full justify-between rounded-xl border border-line px-3 py-2.5 text-left" pending={pending === w.id} disabled={Boolean(pending && pending !== w.id)} onClick={() => open(w.id)}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{w.name}</span>
                    <span className="block text-xs text-muted">{ROLE_LABELS[w.role]}</span>
                  </span>
                  <ArrowRight className="size-4 text-muted" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!existing.length && (
        <p className="mt-5 text-center text-xs text-muted">
          Joining a team instead? Open the invitation link from your email, or{" "}
          <Link href="/support" className="underline hover:text-fg">
            contact support
          </Link>
          .
        </p>
      )}
    </AuthCard>
  );
}
