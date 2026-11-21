/**
 * Step 7 — anti-hallucination check for AI-extracted values (rules 1-3).
 *
 * An AI value is accepted only when
 *   1. its `evidence` is a verbatim quote (case/space-insensitive) of the
 *      processed message or one of the context messages it was shown, and
 *   2. the value is derivable from that quote: numbers must appear in it
 *      (allowing k/lakh/crore multipliers, thousands separators and
 *      "qty × unit price"), dates must resolve from it relative to the message
 *      date, phones/emails/URLs must be in it, names/text must share most of
 *      their words with it.
 * Anything else is dropped to null and surfaced as a suggestion + warning.
 */
import type { CellValue, Field } from "@/lib/shared/types";
import { normalizeValue } from "../records/coerce";
import type { FieldRole } from "./types";
import { findVerbatim } from "./text";

export type EvidenceSource = { ref: string; messageId: string | null; text: string };

export type VerifyResult =
  | { ok: true; value: CellValue; evidence: string; messageId: string | null }
  | { ok: false; code: "evidence_not_found" | "value_not_in_evidence" | "invalid_value"; value: CellValue; reason: string };

const UNIT: Record<string, number> = { k: 1e3, thousand: 1e3, l: 1e5, lac: 1e5, lacs: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7, m: 1e6, mn: 1e6, million: 1e6 };

/** Every number a quote can justify (with multipliers and qty × price products). */
export function numbersIn(text: string): number[] {
  const bases: number[] = [];
  const out = new Set<number>();
  for (const m of text.matchAll(/(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d+))?\s*(k|thousand|lakhs?|lacs?|l|cr|crores?|m|mn|million)?\b/gi)) {
    const base = Number(m[1].replace(/,/g, "") + (m[2] ? `.${m[2]}` : ""));
    if (!Number.isFinite(base)) continue;
    bases.push(base);
    out.add(base);
    const unit = m[3]?.toLowerCase();
    if (unit && UNIT[unit]) out.add(base * UNIT[unit]);
  }
  if (/\b(each|per|apiece|a piece)\b|@|×|\bx\b/i.test(text) && bases.length <= 6) {
    for (let i = 0; i < bases.length; i++) for (let j = i + 1; j < bases.length; j++) out.add(bases[i] * bases[j]);
  }
  return [...out];
}

const STOP = new Set(
  "the and for with from that this have has was were are you your our their his her its into about than then them they she him who what when where which while will would could should can may might just also very really please pls kindly hai hain the of to in on at by an a is it be as or".split(" "),
);

const tokens = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => (t.length >= 3 && !STOP.has(t)) || /\d/.test(t));

const tokenHit = (t: string, pool: string[]) => pool.some((x) => x === t || (t.length >= 4 && x.length >= 4 && x.slice(0, 4) === t.slice(0, 4) && (x.startsWith(t) || t.startsWith(x) || Math.abs(x.length - t.length) <= 2)));

/** Share of the value's significant words found in the quote. */
function tokenSupport(value: string, quote: string, extra: string[] = []): number {
  const v = tokens(value);
  if (!v.length) return quote.toLowerCase().includes(value.toLowerCase().trim()) ? 1 : 0;
  const pool = [...tokens(quote), ...extra.flatMap(tokens)];
  return v.filter((t) => tokenHit(t, pool)).length / v.length;
}

const PERSON_ROLES = new Set<FieldRole>(["customer", "sender", "shared_name"]);
const METADATA_ROLES = new Set<FieldRole>(["file", "file_type", "chat", "image", "none", "activity_date", "created_date"]);

export function verifyAiValue(input: {
  field: Field;
  role: FieldRole;
  raw: string;
  evidence: string | null;
  messageRef: string | null;
  sources: EvidenceSource[];
  refDate: Date;
  defaultCountry?: string;
  /** Sender/contact names: an AI person value may come from these. */
  knownNames: string[];
}): VerifyResult {
  const { field, role } = input;
  if (METADATA_ROLES.has(role)) return { ok: false, code: "invalid_value", value: input.raw, reason: "this field is filled from message metadata only" };
  const n = normalizeValue(field, input.raw, { refDate: input.refDate, defaultCountry: input.defaultCountry });
  if (n.value === null) return { ok: false, code: "invalid_value", value: input.raw, reason: n.warning ?? "not a valid value for this field" };
  const value = n.value;

  const quote = (input.evidence ?? "").trim();
  if (quote.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return { ok: false, code: "evidence_not_found", value, reason: "no supporting quote was given" };

  // Look in the referenced message first, then the rest of what the model was shown.
  const ordered = [...input.sources.filter((s) => s.ref === input.messageRef), ...input.sources.filter((s) => s.ref !== input.messageRef)];
  let found: { verbatim: string; messageId: string | null } | null = null;
  for (const s of ordered) {
    const v = findVerbatim(s.text, quote);
    if (v) {
      found = { verbatim: v, messageId: s.messageId };
      break;
    }
  }
  if (!found) return { ok: false, code: "evidence_not_found", value, reason: "the quoted evidence is not in the conversation" };
  const q = found.verbatim;

  let supported: boolean;
  switch (field.type) {
    case "number":
    case "currency":
      supported = typeof value === "number" && numbersIn(q).some((x) => Math.abs(x - value) < 0.01);
      break;
    case "date":
      supported = dateDerivable(field, q, value, input.refDate, input.defaultCountry);
      break;
    case "phone": {
      const digits = String(value).replace(/\D/g, "");
      supported = q.replace(/\D/g, "").includes(digits.slice(-10));
      break;
    }
    case "email":
      supported = q.toLowerCase().includes(String(value).toLowerCase());
      break;
    case "url":
      try {
        supported = q.toLowerCase().includes(new URL(String(value)).hostname.replace(/^www\./, "").toLowerCase());
      } catch {
        supported = false;
      }
      break;
    case "status":
    case "boolean":
      // The value is constrained to the field's options; the quote must exist (checked above).
      supported = true;
      break;
    case "image":
      supported = false;
      break;
    default:
      supported = PERSON_ROLES.has(role) ? tokenSupport(String(value), q, input.knownNames) === 1 : tokenSupport(String(value), q) >= 0.6;
  }
  if (!supported) return { ok: false, code: "value_not_in_evidence", value, reason: "the value can't be derived from the quoted evidence" };
  return { ok: true, value, evidence: q.slice(0, 500), messageId: found.messageId };
}

function dateDerivable(field: Field, quote: string, value: CellValue, refDate: Date, defaultCountry?: string): boolean {
  if (typeof value !== "string") return false;
  if (normalizeValue(field, quote, { refDate, defaultCountry }).value === value) return true;
  for (const m of quote.matchAll(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g)) {
    if (normalizeValue(field, m[0], { refDate, defaultCountry }).value === value) return true;
  }
  return false;
}
