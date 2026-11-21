/**
 * Validation for workspace settings updates (PATCH /api/v1/workspace).
 * Deterministic bounds for every setting (rule 15); cross-field rules are
 * checked after merging with the stored settings.
 */
import { z } from "zod";
import type { WorkspaceSettings } from "@/lib/shared/types";
import { unprocessable } from "../api/handler";

/** Canonical IANA name for a time zone, or null when the runtime doesn't know it. */
export function canonicalTimeZone(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export const settingsPatchSchema = z
  .object({
    currency: z
      .string()
      .max(8)
      .transform((v) => v.trim().toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO 4217 currency code, e.g. INR or USD.")),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .transform((v, ctx) => {
        const tz = canonicalTimeZone(v);
        if (!tz) {
          ctx.addIssue({ code: "custom", message: "Unknown time zone. Use an IANA name such as Asia/Kolkata." });
          return z.NEVER;
        }
        return tz;
      }),
    defaultCountryCode: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{0,3}$/, "Use a country calling code such as +91 or +1."),
    aiMode: z.enum(["off", "assist", "full"]),
    redactPII: z.boolean(),
    autoApplyThreshold: z.number().min(0).max(1),
    reviewThreshold: z.number().min(0).max(1),
    retentionDays: z.number().int().min(1).max(3650).nullable(),
    allowExternalActions: z.boolean(),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Merge a validated patch into the current settings and enforce cross-field rules. */
export function mergeSettings(current: WorkspaceSettings, patch: SettingsPatch): WorkspaceSettings {
  const next: WorkspaceSettings = { ...current };
  for (const [k, v] of Object.entries(patch) as [keyof WorkspaceSettings, unknown][]) {
    if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  }
  if (next.reviewThreshold > next.autoApplyThreshold) {
    throw unprocessable("settings.reviewThreshold: The review threshold can't be higher than the auto-apply threshold.", [
      { path: "settings.reviewThreshold", message: `Must be ≤ autoApplyThreshold (${next.autoApplyThreshold}).` },
    ]);
  }
  return next;
}

/** Keys whose values differ, as before/after objects for the audit log. */
export function diff<T extends Record<string, unknown>>(before: T, after: T): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof T>) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
