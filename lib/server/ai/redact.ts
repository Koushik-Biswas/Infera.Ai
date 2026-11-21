/**
 * PII redaction before text leaves for the AI provider (workspace setting
 * `redactPII`). Phone numbers and emails are swapped for stable placeholders
 * ([PHONE_1], [EMAIL_1]) and mapped back in the model's output.
 *
 * Phones/emails are always extracted deterministically by the rules engine, so
 * the model never needs the real values.
 */
import { findEmails, findPhones } from "@/lib/app/extract";

export type Redaction = { text: string; map: Map<string, string> };

export function redactPII(texts: string[]): { texts: string[]; map: Map<string, string> } {
  const map = new Map<string, string>(); // placeholder → original
  const reverse = new Map<string, string>(); // original → placeholder
  let phones = 0;
  let emails = 0;
  const swap = (original: string, kind: "PHONE" | "EMAIL") => {
    let p = reverse.get(original);
    if (!p) {
      p = `[${kind}_${kind === "PHONE" ? ++phones : ++emails}]`;
      reverse.set(original, p);
      map.set(p, original);
    }
    return p;
  };
  const out = texts.map((t) => {
    let s = t;
    for (const e of findEmails(s)) s = s.split(e).join(swap(e, "EMAIL"));
    for (const p of findPhones(s)) s = s.split(p).join(swap(p, "PHONE"));
    return s;
  });
  return { texts: out, map };
}

/** Put the original values back into any string inside `value` (deep). */
export function restorePII<T>(value: T, map: Map<string, string>): T {
  if (!map.size) return value;
  if (typeof value === "string") {
    let s: string = value;
    for (const [p, o] of map) s = s.split(p).join(o);
    return s as T;
  }
  if (Array.isArray(value)) return value.map((v) => restorePII(v, map)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, restorePII(v, map)])) as T;
  }
  return value;
}
