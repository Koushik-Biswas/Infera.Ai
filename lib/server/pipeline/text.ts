/**
 * Small, dependency-free text helpers shared by the pipeline steps:
 * verbatim evidence lookup (case/space-insensitive), clause snippets and
 * workspace-timezone date handling.
 */

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Lower-cases, unifies quotes/dashes and collapses whitespace, keeping a map back to the original indexes. */
function fold(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      ch = " ";
      prevSpace = true;
    } else {
      prevSpace = false;
      if (ch === "‘" || ch === "’" || ch === "`" || ch === "´") ch = "'";
      else if (ch === "“" || ch === "”") ch = '"';
      else if (ch === "–" || ch === "—") ch = "-";
    }
    for (const x of ch.toLowerCase()) {
      text += x;
      map.push(i);
    }
  }
  while (text.endsWith(" ")) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

const EDGE_PUNCT = /^[\s"'“”‘’.,;:…!?()[\]-]+|[\s"'“”‘’.,;:…!?()[\]-]+$/g;

/**
 * Finds `needle` inside `haystack` ignoring case, whitespace runs and quote
 * styles, and returns the matching slice of the ORIGINAL haystack (verbatim
 * evidence), or null when it isn't there.
 */
export function findVerbatim(haystack: string, needle: string): string | null {
  const trimmed = needle.replace(EDGE_PUNCT, "");
  if (!trimmed) return null;
  const h = fold(haystack);
  const n = fold(trimmed).text;
  if (!n) return null;
  const idx = h.text.indexOf(n);
  if (idx < 0) return null;
  const start = h.map[idx];
  const end = h.map[idx + n.length - 1] + 1;
  return haystack.slice(start, end);
}

/** The sentence/line around `index`, trimmed to `max` characters (verbatim). */
export function clauseAround(text: string, index: number, max = 160): string {
  let start = index;
  while (start > 0 && !/[.?!\n]/.test(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !/[.?!\n]/.test(text[end])) end++;
  if (end < text.length && /[.?!]/.test(text[end])) end++;
  let s = text.slice(start, end).trim();
  if (s.length > max) {
    const rel = Math.max(0, index - start - Math.floor(max / 3));
    s = text.slice(start + rel, start + rel + max).trim();
  }
  return s;
}

/** Clause of `text` containing `needle` (case-insensitive), or null. */
export function snippetFor(text: string, needle: string | null | undefined, max = 160): string | null {
  if (!needle) return null;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return null;
  return clauseAround(text, idx, max);
}

/** Clause containing the first match of `re`, or null. */
export function snippetForMatch(text: string, re: RegExp, max = 160): { snippet: string; match: string } | null {
  const flags = re.flags.replace("g", "");
  const m = new RegExp(re.source, flags).exec(text);
  if (!m) return null;
  return { snippet: clauseAround(text, m.index ?? 0, max), match: m[0] };
}

export const sentences = (text: string) =>
  text
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

export const isPhoneLike = (s: string) => /^\+?[\d\s()-]{7,}$/.test(s.trim());

/** Emoji / pictographs (stripped when deciding if a message is "just an emoji"). */
export const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu;

/* --------------------------- Timezone dates --------------------------- */

type ZonedParts = { y: number; m: number; d: number; h: number; min: number; weekday: string };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
    } catch {
      f = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
    }
    fmtCache.set(tz, f);
  }
  return f;
}

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = Object.fromEntries(formatter(tz).formatToParts(date).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24, min: Number(parts.minute), weekday: parts.weekday ?? "" };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of `date` in the workspace timezone. */
export function localDate(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** "2026-11-18 14:05 (Wed)" in the workspace timezone (for AI prompts). */
export function localDateTime(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.min)} (${p.weekday})`;
}

/**
 * A server-local Date whose wall clock equals `date`'s wall clock in `tz`.
 * The relative-date helpers in lib/app/extract.ts work in server-local time,
 * so feeding them this value makes "tomorrow"/"by Friday" resolve in the
 * workspace's timezone.
 */
export function wallClock(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  return new Date(p.y, p.m - 1, p.d, p.h, p.min);
}

/** Default international prefix for phone normalisation, from the workspace currency. */
export function defaultCountryFor(currency: string | undefined): string | undefined {
  switch ((currency ?? "").toUpperCase()) {
    case "INR":
      return "+91";
    case "USD":
    case "CAD":
      return "+1";
    case "GBP":
      return "+44";
    case "AED":
      return "+971";
    case "SGD":
      return "+65";
    case "AUD":
      return "+61";
    case "SAR":
      return "+966";
    case "PKR":
      return "+92";
    case "BDT":
      return "+880";
    case "NPR":
      return "+977";
    case "LKR":
      return "+94";
    default:
      return undefined;
  }
}
