/**
 * On-device extraction engine. Turns chat messages into structured rows
 * without sending anything off the device. (Claude can optionally take over
 * for custom collections — see lib/app/ai-client.ts.)
 */
import type { CellValue, Chat, Collection, Field, Message, Row } from "./types";
import { LEAD_STATUSES, ORDER_STATUSES } from "./templates";

/* ------------------------------------------------------------------ */
/*  Entity detectors                                                   */
/* ------------------------------------------------------------------ */

const CUR = "(?:₹|\\$|€|£|\\b(?:rs\\.?|inr|usd|eur|gbp|aed|dhs?))";
const NUM = "(\\d{1,3}(?:,\\d{2,3})+|\\d+)(?:\\.(\\d{1,2}))?\\s*(k|lakh|lac|l|cr)?\\b";
const AMOUNT_RE = [new RegExp(`${CUR}\\s?${NUM}`, "gi"), new RegExp(`\\b${NUM}\\s?(?:rs|rupees|inr|\\/-|dollars|usd|aed)\\b`, "gi")];

function multiplier(u?: string) {
  switch (u?.toLowerCase()) {
    case "k":
      return 1_000;
    case "l":
    case "lac":
    case "lakh":
      return 100_000;
    case "cr":
      return 10_000_000;
    default:
      return 1;
  }
}

const toNum = (int: string, dec?: string, unit?: string) => Number(int.replace(/,/g, "") + (dec ? "." + dec : "")) * multiplier(unit);

export function findAmounts(text: string): number[] {
  const out: number[] = [];
  for (const re of AMOUNT_RE) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const n = toNum(m[1], m[2], m[3]);
      if (n > 0 && n < 1e10) out.push(n);
    }
  }
  return out;
}

/** Amount stated in the text, preferring an explicit total. */
/** After a bare (no currency) number: a time, a percentage or a word other than a connector means it isn't an amount. */
const BARE_NUM_SKIP =
  /^(?:[:%]|\s*(?!(?:by|via|to|on|in|through|using|with|from|only|tomorrow|today|tonight|now|later|please|pls|plz|and|before|after|as|is|was|will|rs|rupees|inr|dollars|bucks|done|paid|sent|pending|due)\b)[a-z])/i;

export function bestAmount(text: string): number | null {
  // Currency marker → always accept. Bare number → skip "Total 3 items", "pay at 3 pm", "pay at 3:30";
  // keep "pay 500 by tomorrow", "Total: 1500".
  const totalRe = new RegExp(`\\b(?:grand total|total|amount|bill|pay(?:able)?)\\b[^\\d₹$€£]{0,12}?(${CUR})?\\s?${NUM}`, "gi");
  for (const t of text.matchAll(totalRe)) {
    // t[1]=currency, t[2]=integer, t[3]=decimals, t[4]=unit
    const after = text.slice((t.index ?? 0) + t[0].length);
    if (!t[1] && !t[4] && BARE_NUM_SKIP.test(after)) continue;
    const n = toNum(t[2], t[3], t[4]);
    if (n > 0 && n < 1e10) return n;
  }
  const all = findAmounts(text);
  if (!all.length) return null;
  // "8 lamps at ₹890 each" → compute the total.
  const each = text.match(new RegExp(`(\\d{1,4})\\s+[a-z ]{0,30}?(?:at|@|for)\\s*${CUR}?\\s?${NUM}\\s*(?:each|per|\\/pc|a piece|apiece)`, "i"));
  if (each) return Number(each[1]) * toNum(each[2], each[3], each[4]);
  return Math.max(...all);
}

export function findPhones(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?){2,4}\d{2,5}/g)) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, "");
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - 16), start);
    // Not a phone: glued to letters (AWB/tracking codes) or labelled as a reference/UTR/order number.
    if (/[A-Za-z]$/.test(before) || /\b(utr|ref|txn|transaction|order|awb|tracking|invoice|inv|id|no\.?)\s*[:#-]?\s*$/i.test(before)) continue;
    const plus = raw.startsWith("+");
    const ok = plus
      ? digits.length >= 10 && digits.length <= 13
      : digits.length === 10 || (digits.length === 11 && digits.startsWith("0")) || (digits.length === 12 && digits.startsWith("91"));
    if (ok) out.push(raw);
  }
  return out;
}

export const findEmails = (text: string) => text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
export const findUrls = (text: string) =>
  (text.match(/\bhttps?:\/\/[^\s<>()"']+|\bwww\.[^\s<>()"']+/gi) ?? []).map((u) => u.replace(/[.,!?)]+$/, ""));

export function isPhoneLike(s: string) {
  return /^\+?[\d\s()-]{9,}$/.test(s.trim());
}

const STOP_ITEM =
  /\b(for|at|by|please|pls|plz|and i|tomorrow|today|tonight|next|each|total|rs|inr|delivery|deliver|via|from|to|is|are|will|can|asap|urgently|now|sent|send|this|that|which|when|if|so|but|also|okay|ok|thanks|thank|price|cost|rate|still|available|left|in stock)\b|[.,!?;:₹$(\n]/i;

const SKIP_AFTER_NUM = /^\s*(?:am|pm|a\.m|p\.m|days?|hrs?|hours?|mins?|minutes?|weeks?|months?|years?|yrs?|th|st|nd|rd|%|k\b|lakh|lac|cr|rs|inr|rupees|\/-|o'?clock|:\d)/i;

function trimItem(raw: string) {
  const cut = raw.split(STOP_ITEM)[0] ?? "";
  const words = cut.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  while (words.length && /^(the|a|an|of|some|my|your|more|it|them|one|ones)$/i.test(words[words.length - 1])) words.pop();
  const s = words.join(" ");
  return s.length >= 3 && !/^(it|them|this|that|me|you|us|order|payment|money|time)$/i.test(s) ? s : null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "3 office chairs", "need 20 notebooks", "is the red basketball available" → qty + item. */
export function findItem(text: string): { qty: number | null; item: string } | null {
  const t = text.replace(/\s+/g, " ");
  const qtyRe = /(?:^|[^\d₹$.,])(\d{1,4})\s*(?:x\s*)?(?:(pcs|pieces|pairs?|units?|nos|boxes|kgs?|sets?|packs?|dozen|bottles|cartons?)\s+(?:of\s+)?)?(?=[a-z])([a-z][\w\-' ]{2,50})/gi;
  for (const m of t.matchAll(qtyRe)) {
    const after = t.slice((m.index ?? 0) + m[0].length - m[3].length);
    if (SKIP_AFTER_NUM.test(after)) continue;
    const item = trimItem(m[3]);
    if (item && !/^(of|in|on|with|and)\b/i.test(item)) {
      const unit = m[2] && /pair|set|box|pack|dozen|carton/i.test(m[2]) ? `${m[2]} of ` : "";
      return { qty: Number(m[1]), item: cap(unit + item) };
    }
  }
  const verbRe =
    /\b(?:want(?:\s+to\s+(?:buy|order))?|need|order(?:ing)?|book|buy|looking for|interested in|enquir(?:e|y) (?:about|for)|do you (?:have|sell)|have you got|is (?:the|this)|price (?:of|for)|details of|send me)\s+(?:(?:a|an|the|one|some|this|that|those|these|more|any)\s+)?([a-z][\w\-' ]{2,50})/gi;
  for (const m of t.matchAll(verbRe)) {
    const item = trimItem(m[1]);
    if (item && !/^(to|it|you|me|help|know|confirm|pay|call|talk|ask|check|see|get|go|come|update)\b/i.test(item)) {
      return { qty: null, item: cap(item) };
    }
  }
  return null;
}

const NOT_PLACE = /^(I|The|A|An|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Today|Tomorrow|Yes|No|Ok|Okay|Hi|Hello|Thanks|Please|UPI|GPay|WhatsApp|Bhaiya|Sir|Madam|Ma'am)$/;

export function findLocation(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  const kws = t.matchAll(
    /\b(?:[Dd]eliver(?:y)?\s+(?:to|at|in)|[Ss]hip\s+to|[Aa]ddress(?:\s+is)?[:\-]?|[Ll]ocated\s+(?:in|at)|[Ll]ocation[:\-]?|[Bb]ased\s+in|in|at|near|around)\s+((?:[A-Z][a-zA-Z]+|\d{1,4}[A-Za-z]?\b(?=[ ,]+[A-Z][a-zA-Z]+))(?:[ ,]+(?:[A-Z][a-zA-Z]+|\d{6})){0,4})/g,
  );
  for (const kw of kws) {
    const parts = kw[1].split(/[ ,]+/).filter((w) => !NOT_PLACE.test(w));
    const res = parts.join(" ").replace(/\s{2,}/g, " ");
    // Needs a real place word ("2 days", "5pm" are not addresses).
    if (parts.length && /[A-Za-z]{3,}/.test(res) && !/^\d{1,2}\s*(?:am|pm|a|p)?$/i.test(res)) return res;
  }
  const pin = t.match(/\b([A-Z][a-zA-Z]+)?[ ,-]*(\d{6})\b/);
  if (pin && !/^(19|20)\d{4}$/.test(pin[2])) return [pin[1], pin[2]].filter(Boolean).join(" ");
  return null;
}

/**
 * Keeps the first location found; a later one replaces it only when it is explicit
 * ("deliver to", "address", "ship to") or carries a 6-digit PIN.
 */
function pickLocation(prev: string | null, text: string): string | null {
  const loc = findLocation(text);
  if (!loc) return prev;
  if (!prev || /\d{6}/.test(loc) || /\b(?:deliver(?:y)?\s+(?:to|at)|ship\s+to|address)\b/i.test(text)) return loc;
  return prev;
}

const WEEKDAYS =["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const dayStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const DAY = 86_400_000;

/** A date mentioned in the text ("by Friday", "tomorrow", "25 Nov"), relative to when it was sent. */
export function findDueDate(text: string, sentAt: number): number | null {
  const t = text.toLowerCase();
  const base = dayStart(sentAt);
  if (/\bday after tomorrow\b/.test(t)) return base + 2 * DAY;
  if (/\b(tomorrow|tmrw|tmr|kal)\b/.test(t)) return base + DAY;
  if (/\b(today|tonight|by eod|end of (the )?day)\b/.test(t)) return base;
  const wd = t.match(/\b(?:by|on|this|next|before|coming)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1]);
    let diff = (target - new Date(sentAt).getDay() + 7) % 7 || 7;
    if (/next\s/.test(wd[0]) && diff < 7) diff += 0;
    return base + diff * DAY;
  }
  const dm = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/) ??
    t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (dm) {
    const [day, mon] = /\d/.test(dm[1]) ? [Number(dm[1]), dm[2]] : [Number(dm[2]), dm[1]];
    const d = new Date(sentAt);
    let res = new Date(d.getFullYear(), MONTHS.indexOf(mon), day).getTime();
    if (res < base - 30 * DAY) res = new Date(d.getFullYear() + 1, MONTHS.indexOf(mon), day).getTime();
    return res;
  }
  const inDays = t.match(/\bin (\d{1,2}) days?\b/);
  if (inDays) return base + Number(inDays[1]) * DAY;
  return null;
}

export const isoDate = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ------------------------------------------------------------------ */
/*  Status vocabularies                                                */
/* ------------------------------------------------------------------ */

// Completion phrases only: naming a method ("Can I pay by UPI?") or sharing a UPI id isn't a payment.
const PAID = /\b(paid|payment (?:done|sent|made|completed|successful|received)|sent (?:you )?(?:the )?(?:money|payment|amount)|transferred|credited|payment screenshot)\b/i;
const PENDING_PAY = /\b(will pay|i'?ll pay|pay (?:you )?(?:tomorrow|later|by|on|next)|payment (?:pending|due)|pending payment|due amount|balance (?:amount|due)|send (?:me )?the (?:bill|invoice)|outstanding|not (?:yet )?paid)\b/i;
const NOT_PAID = /\b(not (?:yet )?paid|unpaid|yet to (?:be )?pa(?:y|id)|(?:haven'?t|have not|hasn'?t|has not|didn'?t|did not) (?:yet )?pa(?:y|id))\b/i;
const REFUND = /\b(refund(?:ed)?|money back|reversed)\b/i;

/** A completed payment: a completion phrase that isn't negated, pending, or asked as a question ("Have you paid?"). */
const isPaid = (t: string) => {
  if (!PAID.test(t) || PENDING_PAY.test(t) || NOT_PAID.test(t)) return false;
  const sentences = t.split(/(?<=[.?!])\s+|\n/).filter((s) => PAID.test(s));
  return sentences.some((s) => !/\?\s*$/.test(s.trim()));
};

type Rule = [string, { test(s: string): boolean }];

const ORDER_RULES: Rule[] = [
  ["Cancelled", /\b(cancel(?:led|ed)?|don'?t want (?:it|them)|no longer need|not needed anymore)\b/i],
  ["Delivered", /\b(delivered|received (?:the|my|it|them|parcel|order)|got (?:the|my) (?:parcel|order|package|delivery))\b/i],
  ["Shipped", /\b(shipped|dispatch(?:ed)?|tracking|courier(?:ed)?|out for delivery|in transit|sent the parcel|awb)\b/i],
  ["Packed", /\b(packed|packing (?:done|complete)|ready (?:to|for) (?:ship|dispatch|pickup))\b/i],
  ["Paid", { test: isPaid }],
  ["Confirmed", /\b(confirm(?:ed)?|go ahead|finali[sz]ed?|book it|done deal|deal\b|okay send|please send|proceed)\b/i],
  ["New order", /\b(want|need|order|book|buy|available|price|do you have|in stock|interested|how much|kitna|send me)\b/i],
];

const LEAD_RULES: Rule[] = [
  ["Lost", /\b(not interested|no longer interested|went with|bought (?:it )?elsewhere|too expensive|out of (?:my )?budget|cancel)\b/i],
  ["Won", /\b(deal done|confirmed|booking amount|token (?:amount|advance)|advance paid|signed|let'?s (?:go ahead|proceed)|paid)\b/i],
  ["Proposal sent", /\b(quote|quotation|proposal|estimate|price list|brochure|catalog(?:ue)?|rate card|pricing)\b/i],
  ["Qualified", /\b(budget|site visit|visit|meeting|meet|call me|schedule|demo|when can|available on|requirement|bhk|sq\.? ?ft)\b/i],
];

const COMPLAINT = /\b(damaged|broken|defect(?:ive)?|wrong (?:size|item|colou?r|product)|not working|stopped working|complain(?:t)?|issue|problem|refund|return|replace(?:ment)?|missing|late|delay(?:ed)?|not (?:yet )?received|haven'?t received|torn|faded|leak(?:ing)?|poor quality)\b/i;
const RESOLVED = /\b(resolved|replaced|refunded|sorted|fixed|received the replacement|issue (?:is )?closed|all good now|works now)\b/i;
const REQUEST =
  /\b(please|pls|plz|kindly|can you|could you|would you|remind|don'?t forget|need you to|make sure)\b[^.?!\n]*\b(send|share|call|deliver|update|check|confirm|book|add|bring|pay|mail|email|forward|prepare|arrange|schedule|fix|change|reserve|keep|dispatch|ship|mark)\b/i;
const DONE_REPLY = /\b(done|sent|shared|updated|completed|delivered|booked|added|dispatched|shipped|called|fixed|arranged|scheduled|marked)\b/i;

function rankStatus(rules: Rule[], order: string[], texts: string[]) {
  let best = -1;
  let cancelled = false;
  for (const text of texts) {
    for (const [status, re] of rules) {
      if (!re.test(text)) continue;
      if (status === "Cancelled" || status === "Lost") cancelled = true;
      else {
        cancelled = false;
        best = Math.max(best, order.indexOf(status));
      }
      break;
    }
  }
  if (cancelled) return order[order.length - 1];
  return best >= 0 ? order[best] : null;
}

const payMethod = (t: string) => {
  const m = t.match(/\b(gpay|google pay|phonepe|paytm|upi|neft|imps|rtgs|bank transfer|cash|card|cheque|check|paypal|bhim)\b/i);
  if (!m) return null;
  const v = m[1].toLowerCase();
  return v === "google pay" || v === "gpay" ? "GPay" : v === "upi" || v === "bhim" ? "UPI" : /^(neft|imps|rtgs)$/.test(v) ? v.toUpperCase() : cap(v.replace("phonepe", "PhonePe").replace("paytm", "Paytm"));
};

const sentenceWith = (text: string, re: RegExp) => {
  const sentences = text.split(/(?<=[.?!])\s+|\n/);
  const s = sentences.find((x) => re.test(x)) ?? text;
  return s.trim().replace(/\s+/g, " ").slice(0, 120);
};

/* ------------------------------------------------------------------ */
/*  Extraction                                                         */
/* ------------------------------------------------------------------ */

export type Extracted = {
  key: string;
  chatId: string;
  values: Record<string, CellValue>;
  sourceIds: string[];
  imageId?: string;
};

type Unit = { key: string; chat: Chat; name: string; msgs: Message[] };

/** Splits chats into "units": the 1:1 chat, or each member of a group. */
function units(chats: Chat[], byChat: Map<string, Message[]>): Unit[] {
  const out: Unit[] = [];
  for (const chat of chats) {
    const msgs = (byChat.get(chat.id) ?? []).filter((m) => m.kind !== "system");
    if (!msgs.length) continue;
    if (!chat.isGroup) {
      out.push({ key: chat.id, chat, name: chat.name, msgs });
      continue;
    }
    const bySender = new Map<string, Message[]>();
    for (const m of msgs) {
      if (m.fromMe) continue;
      bySender.set(m.sender, [...(bySender.get(m.sender) ?? []), m]);
    }
    for (const [sender, list] of bySender) {
      // Include my replies that come right after this member's messages so statuses can move forward.
      const ids = new Set(list.map((m) => m.id));
      const withReplies = msgs.filter((m, i) => ids.has(m.id) || (m.fromMe && i > 0 && ids.has(msgs[i - 1].id)));
      out.push({ key: `${chat.id}:${sender}`, chat, name: sender, msgs: withReplies });
    }
  }
  return out;
}

function phoneFor(u: Unit) {
  if (isPhoneLike(u.name)) return u.name;
  for (const m of u.msgs) if (!m.fromMe) {
    const p = findPhones(m.text)[0];
    if (p) return p;
  }
  return null;
}

function extractOrders(us: Unit[]): Extracted[] {
  const out: Extracted[] = [];
  for (const u of us) {
    type O = { ids: string[]; texts: string[]; item: string | null; qty: number | null; amount: number | null; totalLocked: boolean; address: string | null; last: number; hasTrigger: boolean };
    const orders: O[] = [];
    let cur: O | null = null;
    for (const m of u.msgs) {
      const text = m.text;
      if (!text && m.kind !== "image") continue;
      const complaint = COMPLAINT.test(text) || RESOLVED.test(text);
      const it = !m.fromMe && !complaint ? findItem(text) : null;
      const amount = complaint ? null : bestAmount(text);
      const isTotal = /\btotal|comes? to|bill\b/i.test(text);
      const status = complaint ? null : rankStatus(ORDER_RULES, ORDER_STATUSES, [text]);
      const imgPay = m.kind === "image" && /pay|upi|gpay|receipt|screenshot|paid/i.test(text);
      const relevant = Boolean(it || amount || status || imgPay);
      if (!relevant) continue;
      const terminal = cur && /Delivered|Cancelled/.test(rankStatus(ORDER_RULES, ORDER_STATUSES, cur.texts) ?? "");
      if (!cur || (terminal && it)) {
        if (!it && !(status === "New order")) continue; // need something order-like to start
        cur = { ids: [], texts: [], item: null, qty: null, amount: null, totalLocked: false, address: null, last: m.at, hasTrigger: false };
        orders.push(cur);
      }
      cur.ids.push(m.id);
      cur.texts.push(imgPay ? `${text} paid` : text);
      if (it && !cur.item) {
        cur.item = it.item;
        cur.qty = it.qty;
      } else if (it?.qty && !cur.qty) cur.qty = it.qty;
      if (amount && isTotal) {
        cur.amount = amount;
        cur.totalLocked = true;
      } else if (amount && !cur.totalLocked) cur.amount = Math.max(cur.amount ?? 0, amount);
      if (!m.fromMe) cur.address = pickLocation(cur.address, text);
      if (status) cur.hasTrigger = true;
      cur.last = m.at;
    }
    orders.forEach((o, i) => {
      if (!o.item && !o.amount) return;
      out.push({
        key: `${u.key}#${i}`,
        chatId: u.chat.id,
        sourceIds: o.ids,
        values: {
          customer: u.name,
          phone: phoneFor(u),
          purchase: o.item,
          qty: o.qty,
          amount: o.amount,
          status: rankStatus(ORDER_RULES, ORDER_STATUSES, o.texts) ?? "New order",
          address: o.address,
          date: isoDate(o.last),
        },
      });
    });
  }
  return out;
}

function extractLeads(us: Unit[]): Extracted[] {
  const out: Extracted[] = [];
  for (const u of us) {
    const theirs = u.msgs.filter((m) => !m.fromMe && m.text);
    if (!theirs.length) continue;
    let interest: string | null = null;
    let budget: number | null = null;
    let budgetLocked = false;
    let location: string | null = null;
    let next: string | null = null;
    const ids: string[] = [];
    for (const m of u.msgs) {
      const complaint = COMPLAINT.test(m.text) || RESOLVED.test(m.text);
      const it = !m.fromMe && !complaint ? findItem(m.text) : null;
      const amt = complaint ? null : bestAmount(m.text);
      const loc = !m.fromMe ? findLocation(m.text) : null;
      const nx = m.text.match(/\b(call me|call you|schedule|site visit|visit|meet(?:ing)?|send (?:me |us )?the|share the|quotation|quote|demo|follow up)\b[^.?!\n]{0,60}/i);
      if (it || amt || loc || nx) ids.push(m.id);
      if (it) interest = interest ?? it.item;
      const isTotal = /\btotal\b/i.test(m.text);
      if (amt && (isTotal || !budgetLocked)) {
        budget = amt;
        if (isTotal) budgetLocked = true;
      }
      if (loc) location = pickLocation(location, m.text);
      if (nx) next = cap(nx[0].trim());
    }
    if (!interest) continue;
    const any = u.msgs.map((m) => m.text);
    const stage =
      rankStatus(LEAD_RULES, LEAD_STATUSES, any) ?? (u.msgs.some((m) => m.fromMe) ? "Contacted" : "New lead");
    out.push({
      key: u.key,
      chatId: u.chat.id,
      sourceIds: ids.slice(-8),
      values: {
        name: u.name,
        phone: phoneFor(u),
        interest,
        budget,
        location,
        status: stage,
        next,
        date: isoDate(u.msgs[u.msgs.length - 1].at),
      },
    });
  }
  return out;
}

function extractPayments(chats: Chat[], byChat: Map<string, Message[]>): Extracted[] {
  const out = new Map<string, Extracted>();
  // `${chat.id}:${payer}:${amount}` → key (and time) of the latest open Pending/Paid entry for that tuple.
  const open = new Map<string, { key: string; at: number }>();
  for (const chat of chats) {
    const msgs = byChat.get(chat.id) ?? [];
    msgs.forEach((m, i) => {
      const text = m.text;
      const imgPay = m.kind === "image" && /pay|upi|gpay|receipt|screenshot|paid|sent/i.test(text);
      const paid = isPaid(text) || imgPay;
      const pending = PENDING_PAY.test(text) || NOT_PAID.test(text);
      const refund = REFUND.test(text);
      if (!paid && !pending && !refund) return;
      let amount = bestAmount(text);
      if (!amount) {
        for (let j = i - 1; j >= Math.max(0, i - 6) && !amount; j--) amount = bestAmount(msgs[j].text);
      }
      if (!amount) return;
      const payer = m.fromMe ? "You" : m.sender || chat.name;
      const match = `${chat.id}:${payer}:${amount}`;
      const status = refund ? "Refunded" : paid ? "Paid" : "Pending";
      const ref = text.match(/\b(?:utr|ref(?:erence)?|txn|transaction|upi ref)\s*(?:id|no\.?|number)?\s*[:#-]?\s*([A-Z0-9]{6,})/i)?.[1] ?? null;
      const last = open.get(match);
      const prev = last ? out.get(last.key) : undefined;
      // A repeated reminder about a payment that is already pending or paid.
      if (status === "Pending" && prev) return;
      const gap = last ? m.at - last.at : Infinity;
      const prevStatus = prev?.values.status;
      const prevRef = prev?.values.reference as string | null | undefined;
      // Merge only when this settles an open Pending entry, refunds the last Paid one, or re-confirms
      // the same Paid payment shortly after (screenshot + "Paid ₹500" text) — otherwise it's a new payment.
      const merge = Boolean(
        prev &&
          ((prevStatus === "Pending" && status !== "Pending" && gap <= 30 * DAY) ||
            (prevStatus === "Paid" && status === "Refunded") ||
            (prevStatus === "Paid" && status === "Paid" && gap <= 6 * 3_600_000 && !(ref && prevRef && ref !== prevRef))),
      );
      const key = merge ? last!.key : `${chat.id}:pay:${m.id}`;
      if (!merge && status === "Paid" && prevStatus === "Pending") open.delete(match);
      out.set(key, {
        key,
        chatId: chat.id,
        sourceIds: [...(prev?.sourceIds ?? []), m.id],
        imageId: m.kind === "image" ? m.attachment?.id : prev?.imageId,
        values: {
          payer,
          amount,
          method: payMethod(text) ?? (prev?.values.method as string | null) ?? null,
          status,
          reference: ref ?? (prev?.values.reference as string | null) ?? null,
          date: isoDate(m.at),
        },
      });
    });
  }
  return [...out.values()];
}

function extractProducts(chats: Chat[], byChat: Map<string, Message[]>): Extracted[] {
  const out: Extracted[] = [];
  for (const chat of chats) {
    const msgs = byChat.get(chat.id) ?? [];
    msgs.forEach((m, i) => {
      if (m.kind !== "image" && !(m.kind === "document" && /catalog|product|price|collection|range|menu|brochure/i.test(m.attachment?.name ?? "")))
        return;
      if (/pay|upi|gpay|receipt|screenshot|paid/i.test(m.text)) return;
      // Caption, or the text sent just before by the same person.
      let context = m.text;
      if (!context) {
        for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
          const p = msgs[j];
          if (p.sender !== m.sender || m.at - p.at > 15 * 60_000) break;
          if (p.text && p.kind === "text") {
            context = p.text;
            break;
          }
        }
      }
      const it = findItem(context);
      const who = m.fromMe ? "You" : m.sender || chat.name;
      const captionPrice = Boolean(m.text) && findAmounts(m.text).length > 0;
      const stripped = m.text.replace(new RegExp(`${CUR}\\s?[\\d,]+(?:\\.\\d+)?`, "gi"), "").replace(/[\s–—-]+$/, "").trim();
      const name =
        m.kind === "document"
          ? (m.attachment?.name ?? "Document").replace(/\.[a-z0-9]{2,5}$/i, "")
          : captionPrice && stripped
            ? stripped
            : (it?.item ?? (m.text && m.text.length <= 40 && !m.text.includes("?") ? m.text : `Photo from ${who}`));
      out.push({
        key: m.id,
        chatId: chat.id,
        sourceIds: [m.id],
        imageId: m.kind === "image" ? m.attachment?.id : undefined,
        values: {
          image: m.kind === "image" ? (m.attachment?.id ?? null) : null,
          name: cap(name),
          price: bestAmount(context),
          details: context && context !== m.text ? context.slice(0, 140) : m.kind === "document" && m.text ? m.text.slice(0, 140) : null,
          from: who,
          date: isoDate(m.at),
        },
      });
    });
  }
  return out;
}

function extractTasks(chats: Chat[], byChat: Map<string, Message[]>): Extracted[] {
  const out: Extracted[] = [];
  for (const chat of chats) {
    const msgs = byChat.get(chat.id) ?? [];
    msgs.forEach((m, i) => {
      if (m.fromMe || !REQUEST.test(m.text)) return;
      const wantsFile = /\b(send|share|forward|mail|email)\b/i.test(m.text);
      const done = msgs
        .slice(i + 1, i + 12)
        .find((r) => r.fromMe && r.at - m.at < 48 * 3_600_000 && (DONE_REPLY.test(r.text) || (wantsFile && Boolean(r.attachment))));
      const due = findDueDate(m.text, m.at);
      out.push({
        key: m.id,
        chatId: chat.id,
        sourceIds: done ? [m.id, done.id] : [m.id],
        values: {
          task: cap(sentenceWith(m.text, REQUEST)),
          from: m.sender || chat.name,
          due: due ? isoDate(due) : null,
          status: done ? "Done" : "To do",
          date: isoDate(m.at),
        },
      });
    });
  }
  return out;
}

function extractSupport(us: Unit[]): Extracted[] {
  const out: Extracted[] = [];
  for (const u of us) {
    u.msgs.forEach((m, i) => {
      if (m.fromMe || !COMPLAINT.test(m.text) || RESOLVED.test(m.text)) return;
      if (/\b(no (?:issue|problem)|not a problem)\b/i.test(m.text)) return;
      const later = u.msgs.slice(i + 1);
      const resolved = later.find((r) => RESOLVED.test(r.text));
      const replied = later.some((r) => r.fromMe);
      out.push({
        key: m.id,
        chatId: u.chat.id,
        sourceIds: resolved ? [m.id, resolved.id] : [m.id],
        values: {
          customer: u.name,
          issue: cap(sentenceWith(m.text, COMPLAINT)),
          status: resolved ? "Resolved" : replied ? "In progress" : "Open",
          date: isoDate(m.at),
        },
      });
    });
  }
  return out;
}

function extractContacts(us: Unit[]): Extracted[] {
  return us.map((u) => {
    const theirs = u.msgs.filter((m) => !m.fromMe);
    const last = u.msgs[u.msgs.length - 1];
    return {
      key: u.key,
      chatId: u.chat.id,
      sourceIds: [last.id],
      values: {
        name: u.name,
        phone: phoneFor(u),
        email: theirs.map((m) => findEmails(m.text)[0]).find(Boolean) ?? null,
        chats: u.msgs.length,
        last: (last.text || `[${last.kind}]`).slice(0, 100),
        date: isoDate(last.at),
      },
    };
  });
}

const KIND_LABEL: Record<string, string> = { image: "Image", video: "Video", audio: "Voice note", document: "Document", contact: "Contact card" };

function extractDocuments(chats: Chat[], byChat: Map<string, Message[]>): Extracted[] {
  const out: Extracted[] = [];
  for (const chat of chats)
    for (const m of byChat.get(chat.id) ?? []) {
      if (!KIND_LABEL[m.kind]) continue;
      out.push({
        key: m.id,
        chatId: chat.id,
        sourceIds: [m.id],
        imageId: m.kind === "image" ? m.attachment?.id : undefined,
        values: {
          image: m.kind === "image" ? (m.attachment?.id ?? null) : null,
          file: m.attachment?.name ?? `${KIND_LABEL[m.kind]} (not included in export)`,
          type: KIND_LABEL[m.kind],
          from: m.fromMe ? "You" : m.sender || chat.name,
          chat: chat.name,
          caption: m.text || null,
          date: isoDate(m.at),
        },
      });
    }
  return out;
}

function extractLinks(chats: Chat[], byChat: Map<string, Message[]>): Extracted[] {
  const out: Extracted[] = [];
  for (const chat of chats)
    for (const m of byChat.get(chat.id) ?? [])
      findUrls(m.text).forEach((url, i) => {
        let domain = url;
        try {
          domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
        } catch {}
        out.push({
          key: `${m.id}:${i}`,
          chatId: chat.id,
          sourceIds: [m.id],
          values: {
            url,
            domain,
            from: m.fromMe ? "You" : m.sender || chat.name,
            context: m.text.replace(url, "").trim().slice(0, 120) || null,
            date: isoDate(m.at),
          },
        });
      });
  return out;
}

/** Fills arbitrary fields (custom collections) with the best-matching detector per field. */
function extractCustom(fields: Field[], us: Unit[]): Extracted[] {
  const out: Extracted[] = [];
  for (const u of us) {
    const texts = u.msgs.map((m) => m.text).filter(Boolean);
    const theirs = u.msgs.filter((m) => !m.fromMe);
    const all = texts.join("\n");
    const item = theirs.map((m) => findItem(m.text)).find(Boolean);
    const values: Record<string, CellValue> = {};
    let filled = 0;
    const ids = new Set<string>();
    for (const f of fields) {
      const label = `${f.key} ${f.label} ${f.description}`.toLowerCase();
      let v: CellValue = null;
      switch (f.type) {
        case "phone":
          v = phoneFor(u);
          break;
        case "email":
          v = findEmails(all)[0] ?? null;
          break;
        case "url":
          v = findUrls(all)[0] ?? null;
          break;
        case "currency":
          for (const m of u.msgs) {
            const a = bestAmount(m.text);
            if (a) {
              v = a;
              ids.add(m.id);
            }
          }
          break;
        case "number":
          v = item?.qty ?? null;
          break;
        case "location":
          for (const m of theirs) {
            const l = findLocation(m.text);
            if (l) {
              v = l;
              ids.add(m.id);
            }
          }
          break;
        case "date":
          v = /due|deadline|delivery|visit|appointment|when/.test(label)
            ? (() => {
                for (const m of [...u.msgs].reverse()) {
                  const d = findDueDate(m.text, m.at);
                  if (d) return isoDate(d);
                }
                return null;
              })()
            : isoDate(u.msgs[u.msgs.length - 1].at);
          break;
        case "image": {
          const img = [...u.msgs].reverse().find((m) => m.kind === "image" && m.attachment?.id);
          v = img?.attachment?.id ?? null;
          break;
        }
        case "status": {
          const opts = f.options?.length ? f.options : ["New", "In progress", "Done"];
          v = opts[0];
          for (const t of texts) {
            const hit = opts.find((o) => new RegExp(`\\b${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t));
            if (hit) v = hit;
          }
          break;
        }
        default:
          if (/name|customer|client|person|contact|buyer|lead|who/.test(label)) v = u.name;
          else if (/product|item|purchase|interest|requirement|service|property|order/.test(label)) v = item?.item ?? null;
          else if (/issue|complaint|problem/.test(label)) v = theirs.map((m) => (COMPLAINT.test(m.text) ? sentenceWith(m.text, COMPLAINT) : null)).find(Boolean) ?? null;
          else if (/method|mode/.test(label)) v = payMethod(all);
          else if (/note|summary|detail|message|description|remark|comment/.test(label)) v = theirs[theirs.length - 1]?.text.slice(0, 140) || null;
          else if (/size/.test(label)) v = all.match(/\b(?:size\s*|uk\s*|us\s*|eu\s*)(\d{1,2}|xs|s|m|l|xl|xxl|xxxl)\b/i)?.[0] ?? null;
          else if (/colou?r/.test(label))
            v = all.match(/\b(red|blue|green|black|white|beige|navy|pink|yellow|grey|gray|brown|maroon|olive|orange|purple|cream)\b/i)?.[0] ?? null;
          else if (/chat|group|source/.test(label)) v = u.chat.name;
          else {
            // Generic lookups: "3 BHK", "BHK: 3", "GST no 29ABC…"
            const lab = f.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const before = all.match(new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*${lab}\\b`, "i"));
            const after = all.match(new RegExp(`\\b${lab}\\b\\s*(?:is|=|:|-)?\\s*([\\w₹$.,/-]{1,24})`, "i"));
            v = before ? before[0] : after ? after[1] : null;
          }
      }
      if (v !== null && v !== "" && f.type !== "date" && !(f.type === "text" && v === u.name) && f.type !== "status") filled++;
      values[f.key] = v;
    }
    if (!filled) continue;
    out.push({ key: u.key, chatId: u.chat.id, sourceIds: [...ids, u.msgs[u.msgs.length - 1].id].slice(-8), values });
  }
  return out;
}

export function extractLocal(collection: Collection, chats: Chat[], messages: Message[]): Extracted[] {
  const scoped = collection.scope === "all" ? chats : chats.filter((c) => (collection.scope as string[]).includes(c.id));
  const ids = new Set(scoped.map((c) => c.id));
  const byChat = new Map<string, Message[]>();
  for (const m of messages) {
    if (!ids.has(m.chatId)) continue;
    const list = byChat.get(m.chatId);
    if (list) list.push(m);
    else byChat.set(m.chatId, [m]);
  }
  for (const list of byChat.values()) list.sort((a, b) => a.at - b.at);
  const us = () => units(scoped, byChat);
  switch (collection.template) {
    case "orders":
      return extractOrders(us());
    case "leads":
      return extractLeads(us());
    case "payments":
      return extractPayments(scoped, byChat);
    case "products":
      return extractProducts(scoped, byChat);
    case "tasks":
      return extractTasks(scoped, byChat);
    case "support":
      return extractSupport(us());
    case "contacts":
      return extractContacts(us());
    case "documents":
      return extractDocuments(scoped, byChat);
    case "links":
      return extractLinks(scoped, byChat);
    default:
      return extractCustom(collection.fields, us());
  }
}

/**
 * Merges freshly extracted rows into the collection: updates rows with the
 * same key, adds new ones, never overwrites cells the user edited, and never
 * touches rows the user added by hand.
 */
export function mergeRows(collectionId: string, existing: Row[], extracted: Extracted[], now = Date.now()) {
  const byKey = new Map(existing.filter((r) => r.key).map((r) => [r.key!, r]));
  const upserts: Row[] = [];
  for (const e of extracted) {
    const prev = byKey.get(e.key);
    if (prev) {
      byKey.delete(e.key);
      const values = { ...e.values };
      for (const k of Object.keys(prev.edited ?? {})) values[k] = prev.values[k] ?? null;
      const changed = JSON.stringify(values) !== JSON.stringify(prev.values) || prev.sourceIds.join() !== e.sourceIds.join();
      if (changed) upserts.push({ ...prev, values, sourceIds: e.sourceIds, imageId: e.imageId ?? prev.imageId, chatId: e.chatId, updatedAt: now });
    } else {
      upserts.push({
        id: `r_${collectionId}_${hash(e.key)}`,
        collectionId,
        key: e.key,
        values: e.values,
        chatId: e.chatId,
        sourceIds: e.sourceIds,
        imageId: e.imageId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  // Rows whose source disappeared (chat deleted) and weren't edited by hand.
  const deletes = [...byKey.values()].filter((r) => !r.manual && !Object.keys(r.edited ?? {}).length).map((r) => r.id);
  return { upserts, deletes };
}

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + s.length.toString(36);
}
