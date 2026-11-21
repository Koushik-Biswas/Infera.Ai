"use client";

/**
 * /invite/[token] — shows the workspace and role, then:
 *  - signed in with the invited email → "Accept invitation";
 *  - signed in with another email → explain + "Sign out and continue";
 *  - signed out → name + password creates the account with the invited email.
 * Expired / used / unknown links get clear messages.
 */
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, LinkIcon, MailCheck, UserPlus } from "lucide-react";
import { ApiClientError, api, clearApiCache, useApi } from "@/lib/client/api";
import { errorMessage, fieldErrors } from "@/lib/client/errors";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, formatDate } from "@/lib/client/format";
import type { MeDTO, Role } from "@/lib/shared/types";
import { ME_PATH } from "../session";
import { Button, TextField, buttonCls } from "../kit/form";
import { Callout } from "../kit/surface";
import { RoleBadge } from "../kit/badges";
import { AuthCard, AuthCardSkeleton } from "./auth-card";
import { PasswordField, PasswordHint } from "./fields";
import { adoptSession } from "./login-form";

type InviteInfo = { workspaceName: string; email: string; role: Role; expired: boolean; accepted: boolean; expiresAt: string };

export function InviteFlow({ token }: { token: string }) {
  const router = useRouter();
  const path = `/api/invitations/${encodeURIComponent(token)}`;
  const invite = useApi<InviteInfo>(path, { staleMs: 60_000 });
  const [session, setSession] = useState<MeDTO | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ message: string; code: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<MeDTO>(ME_PATH)
      .then((me) => !cancelled && setSession(me))
      .catch(() => !cancelled && setSession(null));
    router.prefetch("/console");
    return () => {
      cancelled = true;
    };
  }, [router]);

  const loginHref = `/login?next=${encodeURIComponent(`/invite/${token}`)}`;

  async function accept(e?: FormEvent) {
    e?.preventDefault();
    if (pending) return;
    if (!session) {
      const local: Record<string, string> = {};
      if (!name.trim()) local.name = "Enter your name.";
      if (password.length < 10) local.password = "Use at least 10 characters.";
      if (Object.keys(local).length) {
        setErrors(local);
        return;
      }
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const me = await api<MeDTO>(`${path}/accept`, session ? { method: "POST" } : { body: { name: name.trim(), password } });
      adoptSession(me);
      router.replace("/console");
    } catch (err) {
      setPending(false);
      const code = err instanceof ApiClientError ? err.code : "";
      if (code === "invalid") {
        const f = fieldErrors(err);
        if (f.name || f.password) setErrors(f);
        else setFormError({ message: errorMessage(err), code });
      } else {
        setFormError({ message: errorMessage(err), code });
        if (code === "invitation_used" || code === "invitation_expired") void invite.reload();
      }
    }
  }

  async function signOut() {
    setPending(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* continue as signed out regardless */
    }
    clearApiCache();
    setSession(null);
    setPending(false);
  }

  if (invite.loading || session === undefined) return <AuthCardSkeleton fields={2} />;

  if (invite.error && !invite.data) {
    const notFound = invite.error.status === 404;
    return (
      <AuthCard
        icon={<LinkIcon />}
        title={notFound ? "This invitation link isn't valid" : "Couldn't open this invitation"}
        description={notFound ? "It may have been revoked, or the link was copied incompletely. Ask the person who invited you to send a new one." : errorMessage(invite.error)}
        footer={
          <Link href="/login" className="font-medium text-brand hover:underline">
            Go to sign in
          </Link>
        }
      >
        {!notFound && (
          <Button onClick={invite.reload} className="w-full">
            Try again
          </Button>
        )}
      </AuthCard>
    );
  }

  const inv = invite.data;
  if (!inv) return <AuthCardSkeleton fields={2} />;

  if (inv.accepted) {
    return (
      <AuthCard icon={<MailCheck />} title="This invitation was already used" description={`It has been accepted for ${inv.email}. Sign in with that account to open ${inv.workspaceName}.`}>
        <Link href={session ? "/console" : "/login?next=/console"} className={buttonCls("primary", "lg", "w-full")}>
          {session ? "Open the console" : "Sign in"}
        </Link>
      </AuthCard>
    );
  }

  if (inv.expired) {
    return (
      <AuthCard icon={<Clock />} title="This invitation has expired" description={`It expired on ${formatDate(inv.expiresAt)}. Ask an admin of ${inv.workspaceName} to send you a new invitation.`}>
        <Link href={session ? "/console" : "/login"} className={buttonCls("secondary", "lg", "w-full")}>
          {session ? "Open the console" : "Go to sign in"}
        </Link>
      </AuthCard>
    );
  }

  const header = (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-line bg-sunken/50 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-fg">{inv.workspaceName}</p>
        <p className="truncate text-xs text-muted">{ROLE_DESCRIPTIONS[inv.role]}</p>
      </div>
      <RoleBadge role={inv.role} />
    </div>
  );

  const matches = session && session.user.email.toLowerCase() === inv.email.toLowerCase();

  if (session && matches) {
    return (
      <AuthCard icon={<UserPlus />} title={`Join ${inv.workspaceName}`} description={`You've been invited as ${ROLE_LABELS[inv.role].toLowerCase()}. You're signed in as ${session.user.email}.`}>
        {header}
        {formError && (
          <Callout tone="danger" className="mb-4">
            {formError.message}
          </Callout>
        )}
        <Button variant="primary" size="lg" pending={pending} onClick={() => accept()} className="w-full">
          Accept invitation
        </Button>
      </AuthCard>
    );
  }

  if (session && !matches) {
    return (
      <AuthCard
        icon={<UserPlus />}
        title={`Join ${inv.workspaceName}`}
        description={
          <>
            This invitation is for <strong className="font-medium text-fg">{inv.email}</strong>, but you&apos;re signed in as{" "}
            <strong className="font-medium text-fg">{session.user.email}</strong>.
          </>
        }
        footer={
          <Link href="/console" className="font-medium text-brand hover:underline">
            Stay signed in and open the console
          </Link>
        }
      >
        {header}
        <Button variant="primary" size="lg" pending={pending} onClick={signOut} className="w-full">
          Sign out and continue
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      icon={<UserPlus />}
      title={`Join ${inv.workspaceName}`}
      description={`Create your account to accept the invitation. It expires on ${formatDate(inv.expiresAt)}.`}
      footer={
        <>
          Already have an account?{" "}
          <Link href={loginHref} className="font-medium text-brand hover:underline">
            Sign in to accept
          </Link>
        </>
      }
    >
      {header}
      <form onSubmit={accept} className="flex flex-col gap-4" noValidate>
        <TextField label="Email" type="email" name="email" autoComplete="email" value={inv.email} readOnly hint="Invitations are tied to this address." />
        <TextField label="Your name" name="name" autoComplete="name" required autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <PasswordField
          label="Choose a password"
          name="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint={<PasswordHint value={password} />}
        />
        {formError && (
          <Callout
            tone="danger"
            action={
              formError.code === "account_exists" ? (
                <Link href={loginHref} className="text-sm font-medium text-brand hover:underline">
                  Sign in
                </Link>
              ) : undefined
            }
          >
            {formError.message}
          </Callout>
        )}
        <Button type="submit" variant="primary" size="lg" pending={pending} className="mt-1 w-full">
          Create account and join
        </Button>
      </form>
    </AuthCard>
  );
}
