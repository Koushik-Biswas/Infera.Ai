/**
 * Automation condition evaluation (pure, deterministic — rule 15).
 *
 * Conditions are AND-ed. Each one reads a field from the context:
 *  - "category", "priority", "intent", "source", "channel", "channel_id" → message context
 *    (falls back to a record value with the same key when the message context has none);
 *  - "record.<key>" / "values.<key>" → explicitly a record value;
 *  - anything else → a record value key.
 *
 * Operators: eq/neq (case-insensitive for strings, numeric strings compare as numbers),
 * contains/not_contains (case-insensitive substring), gt/gte/lt/lte (numbers, numeric
 * strings coerced; ISO dates compare chronologically), exists/not_exists, in (array).
 * Unknown values never satisfy a positive comparison (rule 12: null means unknown).
 */
import type { AutomationCondition, CellValue, ConditionOp } from "@/lib/shared/types";

export type ConditionContext = {
  values: Record<string, CellValue>;
  category?: string | null;
  priority?: string | null;
  intent?: string | null;
  source?: string | null;
  /** Channel type, e.g. "whatsapp_cloud". */
  channel?: string | null;
  channelId?: string | null;
};

export type ConditionResult = {
  field: string;
  op: ConditionOp;
  value: CellValue | CellValue[] | null;
  actual: CellValue;
  pass: boolean;
};

/** Field names that read the message context rather than record values. */
export const CONTEXT_FIELDS = new Set(["category", "priority", "intent", "source", "channel", "channel_id"]);

const contextValue = (ctx: ConditionContext, field: string): CellValue | undefined => {
  switch (field) {
    case "category":
      return ctx.category ?? undefined;
    case "priority":
      return ctx.priority ?? undefined;
    case "intent":
      return ctx.intent ?? undefined;
    case "source":
      return ctx.source ?? undefined;
    case "channel":
      return ctx.channel ?? undefined;
    case "channel_id":
      return ctx.channelId ?? undefined;
    default:
      return undefined;
  }
};

/** True when the condition needs message context (as opposed to record values only). */
export const isContextField = (field: string) => CONTEXT_FIELDS.has(field);

/** Record value key a condition field refers to, or null for pure context fields. */
export function valueKeyOf(field: string): string | null {
  if (field.startsWith("record.")) return field.slice(7);
  if (field.startsWith("values.")) return field.slice(7);
  return field;
}

export function resolveField(ctx: ConditionContext, field: string): CellValue {
  if (field.startsWith("record.") || field.startsWith("values.")) return ctx.values[field.slice(7)] ?? null;
  if (CONTEXT_FIELDS.has(field)) {
    const v = contextValue(ctx, field);
    if (v !== undefined && v !== null) return v;
  }
  return ctx.values[field] ?? null;
}

const isBlank = (v: CellValue | undefined) => v === null || v === undefined || (typeof v === "string" && !v.trim());

const NUMERIC_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Number from a cell: numbers as-is, numeric strings (thousands separators allowed), else null. */
export function toNumber(v: CellValue | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/[,_\s]/g, "");
  if (!s || !NUMERIC_RE.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toTime(v: CellValue | undefined): number | null {
  if (typeof v !== "string" || !ISO_DATE_RE.test(v.trim())) return null;
  const t = Date.parse(v.trim());
  return Number.isNaN(t) ? null : t;
}

/** Loose equality: case-insensitive strings, numeric strings vs numbers, "true"/"false" vs booleans. */
export function looseEquals(a: CellValue | undefined, b: CellValue | undefined): boolean {
  const an = a ?? null;
  const bn = b ?? null;
  if (an === null || bn === null) return an === bn;
  if (typeof an === "boolean" || typeof bn === "boolean") {
    const asBool = (x: CellValue) => (typeof x === "boolean" ? x : typeof x === "string" ? (/^(true|yes)$/i.test(x.trim()) ? true : /^(false|no)$/i.test(x.trim()) ? false : null) : null);
    const x = asBool(an);
    const y = asBool(bn);
    return x !== null && x === y;
  }
  if (typeof an === "number" || typeof bn === "number") {
    const x = toNumber(an);
    const y = toNumber(bn);
    return x !== null && y !== null && Math.abs(x - y) < 1e-9;
  }
  return String(an).trim().toLowerCase() === String(bn).trim().toLowerCase();
}

function compare(actual: CellValue, expected: CellValue | CellValue[] | undefined): number | null {
  if (Array.isArray(expected)) return null;
  const x = toNumber(actual);
  const y = toNumber(expected);
  if (x !== null && y !== null) return x - y;
  const tx = toTime(actual);
  const ty = toTime(expected);
  if (tx !== null && ty !== null) return tx - ty;
  return null;
}

function contains(actual: CellValue, expected: CellValue | CellValue[] | undefined): boolean {
  if (isBlank(actual) || expected === undefined || expected === null || Array.isArray(expected)) return false;
  return String(actual).toLowerCase().includes(String(expected).toLowerCase());
}

export function evaluateCondition(cond: AutomationCondition, ctx: ConditionContext): ConditionResult {
  const actual = resolveField(ctx, cond.field);
  const expected = cond.value;
  let pass: boolean;
  switch (cond.op) {
    case "eq":
      pass = Array.isArray(expected) ? false : looseEquals(actual, expected ?? null);
      break;
    case "neq":
      pass = Array.isArray(expected) ? true : !looseEquals(actual, expected ?? null);
      break;
    case "contains":
      pass = contains(actual, expected);
      break;
    case "not_contains":
      pass = !contains(actual, expected);
      break;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const d = compare(actual, expected);
      pass = d !== null && (cond.op === "gt" ? d > 0 : cond.op === "gte" ? d >= 0 : cond.op === "lt" ? d < 0 : d <= 0);
      break;
    }
    case "exists":
      pass = !isBlank(actual);
      break;
    case "not_exists":
      pass = isBlank(actual);
      break;
    case "in": {
      const list = Array.isArray(expected) ? expected : expected === undefined ? [] : [expected];
      pass = !isBlank(actual) && list.some((x) => looseEquals(actual, x));
      break;
    }
    default:
      pass = false;
  }
  return { field: cond.field, op: cond.op, value: expected ?? null, actual, pass };
}

/** AND of all conditions (an empty list passes). */
export function evaluateConditions(conditions: readonly AutomationCondition[], ctx: ConditionContext): { pass: boolean; results: ConditionResult[] } {
  const results = conditions.map((c) => evaluateCondition(c, ctx));
  return { pass: results.every((r) => r.pass), results };
}
