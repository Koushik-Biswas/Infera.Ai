"use client";

/** /signup — name, email, password (≥ 10 chars), optional workspace name. */
import { START_PATH } from "@/lib/client/browser";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiClientError, api } from "@/lib/client/api";
import { errorMessage, fieldErrors } from "@/lib/client/errors";
import type { MeDTO } from "@/lib/shared/types";
import { Button, TextField } from "../kit/form";
import { Callout } from "../kit/surface";
import { AuthCard } from "./auth-card";
import { PasswordField, PasswordHint } from "./fields";
import { adoptSession, destinationFor } from "./login-form";

/** Reads `?next=` (needs a Suspense boundary — see the page). */
export function SignupWithParams() {
  const params = useSearchParams();
  return <SignupForm next={params.get("next")} />;
}

/** The sign-up form. Creates the account and its first workspace, then opens the console. */
export function SignupForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", workspaceName: "" });
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ message: string; code: string } | null>(null);

  useEffect(() => {
    router.prefetch(START_PATH);
  }, [router]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const local: Record<string, string> = {};
    if (!form.name.trim()) local.name = "Enter your name.";
    if (!form.email.trim()) local.email = "Enter your email address.";
    if (form.password.length < 10) local.password = "Use at least 10 characters.";
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const me = await api<MeDTO>("/api/auth/signup", {
        body: { name: form.name.trim(), email: form.email.trim(), password: form.password, workspaceName: form.workspaceName.trim() || undefined },
      });
      adoptSession(me);
      router.replace(destinationFor(me, next));
    } catch (err) {
      setPending(false);
      const code = err instanceof ApiClientError ? err.code : "";
      if (code === "invalid") {
        const f = fieldErrors(err);
        if (Object.keys(f).some((k) => k in form)) setErrors(f);
        else setFormError({ message: errorMessage(err), code });
      } else if (err instanceof ApiClientError && err.status === 409) {
        setErrors({ email: err.message || "An account with this email already exists." });
      } else setFormError({ message: errorMessage(err), code });
    }
  }

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
  return (
    <AuthCard
      title="Create your account"
      description="Turn conversations into structured, searchable records — in minutes."
      footer={
        <>
          Already have an account?{" "}
          <Link href={loginHref} className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="Your name" name="name" autoComplete="name" required autoFocus maxLength={100} value={form.name} onChange={set("name")} error={errors.name} />
        <TextField
          label="Work email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="off"
          required
          value={form.email}
          onChange={set("email")}
          error={errors.email}
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={form.password}
          onChange={set("password")}
          error={errors.password}
          hint={<PasswordHint value={form.password} />}
        />
        <TextField
          label="Workspace name"
          aside="Optional"
          name="workspaceName"
          autoComplete="organization"
          maxLength={80}
          placeholder="e.g. Acme Traders"
          value={form.workspaceName}
          onChange={set("workspaceName")}
          error={errors.workspaceName}
          hint="Usually your business name. You can change it later."
        />
        {formError && (
          <Callout
            tone="danger"
            action={
              formError.code === "signups_disabled" ? (
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
          Create account
        </Button>
        <p className="text-center text-xs text-muted">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="underline hover:text-fg">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-fg">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthCard>
  );
}
