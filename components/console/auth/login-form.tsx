"use client";

/**
 * /login — email + password. Redirects to `?next=` (validated) or /console,
 * or to /onboarding when the account has no workspace yet.
 */
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { ApiClientError, api, clearApiCache, setCached } from "@/lib/client/api";
import { errorMessage, fieldErrors } from "@/lib/client/errors";
import { START_PATH, safeNext } from "@/lib/client/browser";
import type { MeDTO } from "@/lib/shared/types";
import { ME_PATH } from "../session";
import { Button, TextField } from "../kit/form";
import { Callout } from "../kit/surface";
import { AuthCard } from "./auth-card";
import { PasswordField } from "./fields";

/** Where to go after authenticating. */
export function destinationFor(me: MeDTO, next: string | null): string {
  const dest = safeNext(next);
  return me.workspace ? dest : `/onboarding${dest !== START_PATH ? `?next=${encodeURIComponent(dest)}` : ""}`;
}

/** Store the fresh session so the console paints instantly, then navigate. */
export function adoptSession(me: MeDTO) {
  clearApiCache();
  setCached<MeDTO>(ME_PATH, () => me);
}

/** Reads `?next=` (needs a Suspense boundary — see the page). */
export function LoginWithParams() {
  const params = useSearchParams();
  return <LoginForm next={params.get("next")} />;
}

/** The sign-in form. `next` is the post-login destination (validated with `safeNext`). */
export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signedIn, setSignedIn] = useState<MeDTO | null>(null);

  // Already signed in? Offer to continue (quietly — a 401 here is the normal case).
  useEffect(() => {
    let cancelled = false;
    api<MeDTO>(ME_PATH)
      .then((me) => !cancelled && setSignedIn(me))
      .catch(() => {});
    router.prefetch(START_PATH);
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    // Read the DOM too: browser autofill doesn't always fire change events before the first interaction.
    const form = e.currentTarget as HTMLFormElement;
    const em = (email || (form.elements.namedItem("email") as HTMLInputElement | null)?.value || "").trim();
    const pw = password || (form.elements.namedItem("password") as HTMLInputElement | null)?.value || "";
    if (!em || !pw) {
      setErrors({ ...(em ? {} : { email: "Enter your email address." }), ...(pw ? {} : { password: "Enter your password." }) });
      return;
    }
    setPending(true);
    setFormError(null);
    setErrors({});
    try {
      const me = await api<MeDTO>("/api/auth/login", { body: { email: em, password: pw } });
      adoptSession(me);
      router.replace(destinationFor(me, next));
      // Stay pending until the next page takes over.
    } catch (err) {
      setPending(false);
      const code = err instanceof ApiClientError ? err.code : "";
      if (code === "invalid_credentials") setFormError("Incorrect email or password.");
      else if (code === "invalid") {
        const f = fieldErrors(err);
        if (f.email || f.password) setErrors(f);
        else setFormError(errorMessage(err));
      } else setFormError(errorMessage(err));
    }
  }

  const signupHref = next ? `/signup?next=${encodeURIComponent(next)}` : "/signup";
  return (
    <AuthCard
      title="Sign in to Infera"
      description="Welcome back. Your conversations are waiting, neatly organised."
      footer={
        <>
          New to Infera?{" "}
          <Link href={signupHref} className="font-medium text-brand hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {signedIn && (
        <Callout
          tone="brand"
          className="mb-5"
          title={`You're signed in as ${signedIn.user.email}`}
          action={
            <Link href={destinationFor(signedIn, next)} replace className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              Continue <ArrowRight className="size-4" aria-hidden />
            </Link>
          }
        >
          Or sign in with another account below.
        </Callout>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="off"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <PasswordField label="Password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        {formError && <Callout tone="danger">{formError}</Callout>}
        <Button type="submit" variant="primary" size="lg" pending={pending} className="mt-1 w-full">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
