/**
 * Deterministic validation/normalisation of field values (spec rule 15:
 * "Prefer deterministic validation for structured data"; rule 12: null for unknown).
 *
 * normalizeValue() never invents data: anything it can't parse becomes null
 * with a warning, and the caller decides whether that needs human review.
 */
import type { CellValue, Field } from "@/lib/shared/types";
import { findAmounts, findDueDate, isoDate } from "@/lib/app/extract";

export type Normalized = { value: CellValue; warning?: string };

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const MAX_TEXT = 2000;

export function normalizePhone(raw: string, defaultCountry = "+91"): string | null {
  const s = raw.trim();
  const plus = s.startsWith("+") || s.startsWith("00");
  const digits = s.replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (plus) return `+${digits}`;
  const cc = defaultCountry.replace(/\D/g, "");
  // Already includes the default country code (e.g. 919847011234).
  if (digits.length > 10 && digits.startsWith(cc)) return `+${digits}`;
  const national = digits.replace(/^0+/, "");
  if (national.length < 7) return null;
  const full = cc + national;
  return full.length <= 15 ? `+${full}` : null;
}

function parseNumber(raw: string): number | null {
  const amounts = findAmounts(raw);
  if (amounts.length) return amounts[0];
  const m = raw.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  let n = Number(m[0]);
  const unit = raw.slice((m.index ?? 0) + m[0].length).trim().toLowerCase();
  if (/^k\b/.test(unit)) n *= 1_000;
  else if (/^(l|lac|lakh)s?\b/.test(unit)) n *= 100_000;
  else if (/^(cr|crore)s?\b/.test(unit)) n *= 10_000_000;
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw: string, ref: Date): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // dd/mm/yyyy (day-first, as used in India/UK)
  if (m) return valid(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  const rel = findDueDate(s, ref.getTime());
  if (rel !== null) return isoDate(rel);
  const t = Date.parse(s);
  if (!Number.isNaN(t) && /\d/.test(s)) return isoDate(t);
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function normalizeValue(field: Field, raw: unknown, opts: { refDate?: Date; defaultCountry?: string } = {}): Normalized {
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw === "string" && !raw.trim()) return { value: null };
  if (typeof raw === "object") return { value: null, warning: `${field.label}: unsupported value` };
  const str = String(raw).trim();

  switch (field.type) {
    case "text":
    case "location":
      return { value: str.slice(0, MAX_TEXT) };
    case "image":
      return { value: str.slice(0, 500) };
    case "number":
    case "currency": {
      const n = typeof raw === "number" ? raw : parseNumber(str);
      if (n === null || !Number.isFinite(n)) return { value: null, warning: `${field.label}: "${str.slice(0, 40)}" is not a number` };
      return { value: field.type === "currency" ? Math.round(n * 100) / 100 : n };
    }
    case "date": {
      const d = parseDate(str, opts.refDate ?? new Date());
      return d ? { value: d } : { value: null, warning: `${field.label}: "${str.slice(0, 40)}" is not a date` };
    }
    case "phone": {
      const p = normalizePhone(str, opts.defaultCountry);
      return p ? { value: p } : { value: null, warning: `${field.label}: "${str.slice(0, 40)}" is not a phone number` };
    }
    case "email": {
      const e = str.toLowerCase();
      return EMAIL_RE.test(e) && e.length <= 254 ? { value: e } : { value: null, warning: `${field.label}: "${str.slice(0, 40)}" is not an email` };
    }
    case "url": {
      try {
        const u = new URL(/^https?:\/\//i.test(str) ? str : `https://${str}`);
        if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw new Error();
        return { value: u.toString() };
      } catch {
        return { value: null, warning: `${field.label}: "${str.slice(0, 40)}" is not a URL` };
      }
    }
    case "status": {
      const options = field.options ?? [];
      if (!options.length) return { value: str.slice(0, 80) };
      const lower = str.toLowerCase();
      const exact = options.find((o) => o.toLowerCase() === lower);
      if (exact) return { value: exact };
      const partial = options.filter((o) => o.toLowerCase().includes(lower) || lower.includes(o.toLowerCase()));
      if (partial.length === 1) return { value: partial[0] };
      return { value: null, warning: `${field.label}: "${str.slice(0, 40)}" is not one of ${options.join(", ")}` };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      if (/^(true|yes|y|1|done|paid)$/i.test(str)) return { value: true };
      if (/^(false|no|n|0)$/i.test(str)) return { value: false };
      return { value: null, warning: `${field.label}: "${str.slice(0, 40)}" is not yes/no` };
    }
  }
}

/** Normalise a whole values object against the collection's fields. Unknown keys are dropped. */
export function normalizeValues(fields: Field[], values: Record<string, unknown>, opts: { refDate?: Date; defaultCountry?: string } = {}) {
  const out: Record<string, CellValue> = {};
  const warnings: { field: string; message: string }[] = [];
  for (const f of fields) {
    if (!(f.key in values)) continue;
    const n = normalizeValue(f, values[f.key], opts);
    out[f.key] = n.value;
    if (n.warning) warnings.push({ field: f.key, message: n.warning });
  }
  return { values: out, warnings };
}

export const statusFieldOf = (fields: Field[]) => fields.find((f) => f.type === "status") ?? null;

export function sameValue(a: CellValue | undefined, b: CellValue | undefined): boolean {
  if ((a ?? null) === (b ?? null)) return true;
  if (typeof a === "string" && typeof b === "string") return a.trim().toLowerCase() === b.trim().toLowerCase();
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  return false;
}

/**
 * Identity of a record for dedupe. `matchFields` may contain field keys and the
 * special tokens "$contact" and "$conversation". Returns null if any part is missing.
 */
export function computeMatchKey(matchFields: string[], values: Record<string, CellValue>, ctx: { contactId?: string | null; conversationId?: string | null }): string | null {
  if (!matchFields.length) return null;
  const parts: string[] = [];
  for (const k of matchFields) {
    const v = k === "$contact" ? ctx.contactId : k === "$conversation" ? ctx.conversationId : values[k];
    if (v === null || v === undefined || v === "") return null;
    parts.push(String(v).trim().toLowerCase().replace(/\s+/g, " "));
  }
  return parts.join("|").slice(0, 500);
}
