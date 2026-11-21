"use client";

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { TextField } from "../kit/form";

/** Password input with a show/hide toggle. */
export function PasswordField(props: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; error?: string | null; aside?: ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <TextField
      {...props}
      type={show ? "text" : "password"}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="grid size-8 place-items-center rounded-full text-muted transition-colors duration-150 hover:bg-sunken hover:text-fg"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  );
}

/** Live hint for new passwords: counts toward the 10-character minimum. */
export function PasswordHint({ value, min = 10 }: { value: string; min?: number }) {
  const ok = value.length >= min;
  if (!value) return <>At least {min} characters. A short phrase is easy to remember and hard to guess.</>;
  return ok ? <span className="text-emerald-700 dark:text-emerald-400">Looks good — {value.length} characters.</span> : <>{min - value.length} more character{min - value.length === 1 ? "" : "s"} to go.</>;
}
