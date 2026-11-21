/**
 * Input rules for identity routes (signup, login, invitations, password change).
 * Shared so every entry point applies exactly the same policy.
 */
import { z } from "zod";
import { isValidEmail } from "@/lib/validation";
import { cleanText, isAllowedOrigin } from "../http";
import { forbidden, unprocessable } from "../api/handler";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

/** Lower-cased, trimmed, syntactically valid email. */
export const emailField = z
  .string()
  .max(320)
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.string().min(1, "Enter your email address.").refine(isValidEmail, "Enter a valid email address."));

/** New passwords (signup, invite acceptance, password change). */
export const newPasswordField = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`)
  .refine((v) => v.trim().length > 0, "Password can't be blank.");

/** Passwords being checked (login, current password): only bounded, never policy-checked. */
export const existingPasswordField = z.string().min(1, "Enter your password.").max(PASSWORD_MAX);

/** A person's display name: control characters stripped, 1-100 chars. */
export const personNameField = z
  .string()
  .max(1000)
  .transform((v) => cleanText(v, 100))
  .pipe(z.string().min(1, "Enter your name."));

/** A workspace name: control characters stripped, 1-80 chars. */
export const workspaceNameField = z
  .string()
  .max(1000)
  .transform((v) => cleanText(v, 80))
  .pipe(z.string().min(1, "Enter a workspace name."));

/** Rejects passwords that equal the account email (case-insensitive). */
export function assertPasswordPolicy(password: string, email: string, field = "password") {
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) {
    throw unprocessable(`${field}: Your password can't be the same as your email address.`, [{ path: field, message: "Password can't equal the email address." }]);
  }
}

/** Optional workspace name: blank → undefined (the caller picks a default). */
export const optionalWorkspaceNameField = z
  .string()
  .max(1000)
  .transform((v) => cleanText(v, 80) || undefined)
  .nullish();

/**
 * CSRF guard for routes that read the session cookie themselves (public
 * wrappers don't run the check): cross-site browser requests are rejected.
 */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  if (req.headers.get("sec-fetch-site") === "cross-site" || !isAllowedOrigin(req)) throw forbidden("Cross-site request blocked.");
}
