"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarCheck, CircleCheck, LoaderCircle, X } from "lucide-react";
import { COUNTRY_CODES, HONEYPOT_FIELD, TEAM_SIZES, isValidEmail, nationalDigits } from "@/lib/validation";

type Errors = Partial<Record<"name" | "email" | "phone" | "business", string>>;

export function DemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId();
  const firstField = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => firstField.current?.focus(), 120);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStatus("idle");
        setErrors({});
        setServerError("");
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = Object.fromEntries(fd.entries()) as Record<string, string>;

    const next: Errors = {};
    if (!data.name?.trim()) next.name = "Please enter your name.";
    if (!isValidEmail((data.email ?? "").trim().toLowerCase())) next.email = "Enter a valid email address.";
    if (!nationalDigits((data.phone ?? "").trim())) next.phone = "Enter a valid phone number.";
    if (!data.business?.trim()) next.business = "Tell us your business name.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setStatus("loading");
    setServerError("");
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setStatus("done");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="surface-lg relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-6 sm:rounded-3xl sm:p-8"
          >
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 rounded-full p-2 text-muted transition hover:bg-sunken hover:text-fg"
            >
              <X className="size-5" />
            </button>

            {status === "done" ? (
              <div className="flex flex-col items-center py-8 text-center">
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  className="grid size-16 place-items-center rounded-full bg-brand-2/15 text-brand-2"
                >
                  <CircleCheck className="size-8" />
                </motion.div>
                <h2 className="mt-5 text-2xl font-semibold tracking-tight">You&apos;re on the list</h2>
                <p className="mt-2 max-w-sm text-muted">
                  Thanks! Someone from the Infera team will reach out on WhatsApp or email within one business day to
                  schedule your walkthrough.
                </p>
                <button
                  onClick={onClose}
                  className="mt-7 rounded-full bg-fg px-5 py-2.5 text-sm font-medium text-bg transition hover:opacity-90"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="mb-6 flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-2xl bg-brand/12 text-brand">
                    <CalendarCheck className="size-5" />
                  </span>
                  <div>
                    <h2 id={titleId} className="text-xl font-semibold tracking-tight">
                      Get a demo
                    </h2>
                    <p className="text-sm text-muted">A 20-minute walkthrough with your own use case.</p>
                  </div>
                </div>

                <form onSubmit={onSubmit} noValidate className="grid gap-4">
                  {/* Honeypot: invisible to people, often filled by bots. */}
                  <input
                    type="text"
                    name={HONEYPOT_FIELD}
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden
                    className="absolute -left-[9999px] h-0 w-0 opacity-0"
                  />
                  <Field label="Full name" error={errors.name}>
                    <input ref={firstField} name="name" autoComplete="name" placeholder="Anjali Menon" className={inputCls(errors.name)} />
                  </Field>
                  <Field label="Work email" error={errors.email}>
                    <input name="email" type="email" autoComplete="email" placeholder="you@business.com" className={inputCls(errors.email)} />
                  </Field>
                  <Field label="WhatsApp number" error={errors.phone}>
                    <div className="flex gap-2">
                      <select name="country" defaultValue="+91" aria-label="Country code" className={`${inputCls()} max-w-[7.5rem] shrink-0`}>
                        {COUNTRY_CODES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <input name="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" className={inputCls(errors.phone)} />
                    </div>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Business name" error={errors.business}>
                      <input name="business" autoComplete="organization" placeholder="Menon Traders" className={inputCls(errors.business)} />
                    </Field>
                    <Field label="Team size">
                      <select name="teamSize" defaultValue="2–10" className={inputCls()}>
                        {TEAM_SIZES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="What do you want to track? (optional)">
                    <textarea
                      name="message"
                      rows={3}
                      placeholder="e.g. Orders and payment proofs from 12 distributor groups"
                      className={`${inputCls()} resize-none`}
                    />
                  </Field>

                  {serverError && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">{serverError}</p>}

                  <button
                    type="submit"
                    disabled={status === "loading"}
                    className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-fg px-6 text-sm font-semibold text-bg transition hover:opacity-90 disabled:opacity-60"
                  >
                    {status === "loading" && <LoaderCircle className="size-4 animate-spin" />}
                    {status === "loading" ? "Booking…" : "Book my demo"}
                  </button>
                  <p className="text-center text-xs text-muted">
                    By submitting you agree to our{" "}
                    <a href="/privacy" className="underline underline-offset-2 hover:text-fg">
                      Privacy Policy
                    </a>
                    . No spam, ever.
                  </p>
                </form>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function inputCls(error?: string) {
  return `h-11 w-full rounded-xl border bg-sunken/60 px-3.5 text-sm text-fg placeholder:text-muted/70 outline-none transition focus:border-brand focus:bg-elev focus:ring-4 focus:ring-[var(--ring)] ${
    error ? "border-red-500/70" : "border-line"
  } [&:is(textarea)]:h-auto [&:is(textarea)]:py-3`;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-fg-soft">{label}</span>
      {children}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </label>
  );
}
