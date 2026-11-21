/**
 * Step 6 — deterministic extraction, field by field.
 *
 * Every field gets a role (from the collection template, or inferred from the
 * field's type, key and label for custom collections) and the role picks the
 * detector: amounts via `bestAmount`, phones via `findPhones`, items via
 * `findItem`, places via `findLocation`, statuses via the status vocabulary,
 * relative dates via `findDueDate`, people from "my name is X" or the sender.
 *
 * Values that come from message metadata (sender name/phone, message date,
 * attachment names) use method "metadata" with no evidence; everything read
 * from the text carries a verbatim evidence snippet (rule 10).
 */
import type { CellValue, ExtractedEntity, Field } from "@/lib/shared/types";
import type { CollectionRow } from "../db/schema";
import { bestAmount, findDueDate, findEmails, findLocation, findPhones, findUrls, isoDate } from "@/lib/app/extract";
import { normalizePhone } from "../records/coerce";
import type { Candidate, ContextMessage, FieldRole, PipelineMessage } from "./types";
import { cap, clauseAround, escapeRe, isPhoneLike, localDate, sentences, snippetFor, wallClock } from "./text";
import {
  APPOINTMENT,
  COMPLAINT_STRONG,
  COMPLAINT_WEAK,
  DELIVERY_ISSUE,
  NEXT_STEP,
  NO_PROBLEM,
  PAYMENT_ISSUE,
  REFERENCE_RE,
  REFUND_REQUEST,
  REQUEST,
  REQUEST_HINGLISH,
  RESOLVED,
  matchStatus,
  payMethod,
} from "./vocab";

export type ExtractEnv = {
  message: PipelineMessage;
  /** Earlier messages of the conversation, oldest first. */
  context: ContextMessage[];
  timezone: string;
  defaultCountry?: string;
  category: string;
};

/* ------------------------------ Roles -------------------------------- */

const TEMPLATE_ROLES: Record<string, FieldRole> = {
  "orders:customer": "customer",
  "orders:phone": "phone",
  "orders:purchase": "item",
  "orders:qty": "quantity",
  "orders:amount": "amount",
  "orders:status": "status",
  "orders:address": "location",
  "orders:date": "activity_date",
  "leads:name": "customer",
  "leads:phone": "phone",
  "leads:interest": "item",
  "leads:budget": "amount",
  "leads:location": "location",
  "leads:status": "status",
  "leads:next": "next_step",
  "leads:date": "activity_date",
  "payments:payer": "customer",
  "payments:amount": "amount",
  "payments:method": "method",
  "payments:status": "status",
  "payments:reference": "reference",
  "payments:date": "created_date",
  "products:image": "image",
  "products:name": "product",
  "products:price": "amount",
  "products:details": "summary",
  "products:from": "sender",
  "products:date": "created_date",
  "tasks:task": "task",
  "tasks:from": "sender",
  "tasks:due": "due_date",
  "tasks:status": "status",
  "tasks:date": "created_date",
  "support:customer": "customer",
  "support:issue": "issue",
  "support:status": "status",
  "support:date": "created_date",
  "contacts:name": "shared_name",
  "contacts:phone": "shared_phone",
  "contacts:email": "email",
  "contacts:chats": "none",
  "contacts:last": "summary",
  "contacts:date": "activity_date",
  "documents:image": "image",
  "documents:file": "file",
  "documents:type": "file_type",
  "documents:from": "sender",
  "documents:chat": "chat",
  "documents:caption": "caption",
  "documents:date": "created_date",
  "links:url": "url",
  "links:domain": "domain",
  "links:from": "sender",
  "links:context": "link_context",
  "links:date": "created_date",
};

/** Field types each role can fill (a template field whose type was changed falls back to inference). */
const ROLE_TYPES: Partial<Record<FieldRole, Field["type"][]>> = {
  customer: ["text"],
  sender: ["text"],
  shared_name: ["text"],
  phone: ["phone", "text"],
  shared_phone: ["phone", "text"],
  email: ["email", "text"],
  url: ["url", "text"],
  amount: ["currency", "number"],
  quantity: ["number"],
  item: ["text"],
  product: ["text"],
  location: ["location", "text"],
  status: ["status"],
  activity_date: ["date"],
  created_date: ["date"],
  due_date: ["date"],
  image: ["image"],
};

const ACTIVITY_LABEL = /\b(latest|last|recent|most recent|updated|activity)\b/i;
const DUE_LABEL = /\b(due|deadline|by when|delivery date|visit|appointment|meeting|scheduled|follow.?up|expected|eta)\b/i;

export function fieldRole(collection: Pick<CollectionRow, "template">, field: Field): FieldRole {
  const fixed = TEMPLATE_ROLES[`${collection.template}:${field.key}`];
  if (fixed && (!ROLE_TYPES[fixed] || ROLE_TYPES[fixed]!.includes(field.type))) return fixed;
  const name = `${field.key.replace(/_/g, " ")} ${field.label}`.toLowerCase();
  const all = `${name} ${field.description}`.toLowerCase();
  switch (field.type) {
    case "phone":
      return "phone";
    case "email":
      return "email";
    case "url":
      return "url";
    case "currency":
      return "amount";
    case "status":
      return "status";
    case "image":
      return "image";
    case "boolean":
      return "none";
    case "location":
      return "location";
    case "date":
      return DUE_LABEL.test(name) ? "due_date" : ACTIVITY_LABEL.test(all) ? "activity_date" : "created_date";
    case "number":
      if (/\b(qty|quantity|units?|pieces|pcs|nos|items)\b/.test(name)) return "quantity";
      if (/\b(price|amount|budget|cost|total|value|fee|fees|rate)\b/.test(name)) return "amount";
      return "generic";
    case "text":
      return textRole(name) ?? textRole(all) ?? "generic";
  }
}

function textRole(s: string): FieldRole | null {
  if (/\b(requested by|shared by|sent by|posted by|sender|from)\b/.test(s)) return "sender";
  if (/\b(product|item|purchase|interest(?:ed)?|requirement|service|property|goods|sku|model)\b/.test(s)) return "item";
  if (/\b(name|customer|client|payer|lead|buyer|person|contact|who)\b/.test(s)) return "customer";
  if (/\b(method|mode)\b/.test(s)) return "method";
  if (/\b(reference|utr|txn|transaction|ref)\b/.test(s)) return "reference";
  if (/\b(issue|complaint|problem|grievance)\b/.test(s)) return "issue";
  if (/\b(task|action|to-?do)\b/.test(s)) return "task";
  if (/\bnext\b/.test(s)) return "next_step";
  if (/\b(note|notes|summary|detail|details|message|description|remark|remarks|comment|comments)\b/.test(s)) return "summary";
  if (/\b(caption|context)\b/.test(s)) return "caption";
  if (/\bsize\b/.test(s)) return "size";
  if (/\bcolou?r\b/.test(s)) return "color";
  if (/\b(domain|site|website)\b/.test(s)) return "domain";
  if (/\b(file|document|attachment)\b/.test(s)) return "file";
  if (/\b(chat|group|conversation)\b/.test(s)) return "chat";
  if (/\b(address|location|city|area|place|locality)\b/.test(s)) return "location";
  return null;
}

/* ------------------------------ Items -------------------------------- */

// Ported from lib/app/extract.ts `findItem`, with two fixes: ordinal/unit suffixes need a word
// boundary ("5 steel bottles" was rejected as "5 st…"), and a bare unit ("2 pieces") is a
// quantity, not the item.
const STOP_ITEM =
  /\b(for|at|by|on|please|pls|plz|and i|tomorrow|today|tonight|next|each|total|rs|inr|delivery|deliver|via|from|to|is|are|will|can|asap|urgently|now|sent|send|this|that|which|when|if|so|but|also|okay|ok|thanks|thank|price|cost|rate|still|available|left|in stock|kitna|kitne|hai|chahiye|budget|instead|too|either)\b|[.,!?;:₹$(\n]/i;
const SKIP_AFTER_NUM =
  /^\s*(?:(?:am|pm|a\.m|p\.m|days?|hrs?|hours?|mins?|minutes?|weeks?|months?|years?|yrs?|th|st|nd|rd|k|lakh|lac|cr|rs|inr|rupees|o'?clock|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b|%|\/-|:\d)/i;
/** Things people ask for that are not products ("send me the quotation", "share pics"). */
const NOT_AN_ITEM = /^(?:the |a |an |your |ur )?(?:quotation|quote|price ?list|prices?|rates?|rate card|catalog(?:ue)?|brochure|details?|info(?:rmation)?|invoice|bill|receipt|photos?|pics?|pictures?|images?|videos?|update|number|address|location|reply|response|help|discount|offer)$/i;
const UNIT_ONLY = /^(pcs|pieces?|pairs?|units?|nos|box(?:es)?|kgs?|sets?|packs?|dozen|bottles?|cartons?|items?|qty|quantity)$/i;
const ITEM_QTY_RE = /(?:^|[^\d₹$.,])(\d{1,4})\s*(?:x\s*)?(?:(pcs|pieces|pairs?|units?|nos|boxes|kgs?|sets?|packs?|dozen|bottles|cartons?)\s+(?:of\s+)?)?(?=[a-z])([a-z][\w\-' ]{2,50})/gi;
const ITEM_VERB_RE =
  /\b(?:want(?:\s+to\s+(?:buy|order))?|need|order(?:ing)?|book|buy|looking for|interested in|enquir(?:e|y) (?:about|for)|do you (?:have|sell)|have you got|is (?:the|this)|price (?:of|for)|details of|send me|chahiye)\s+(?:(?:a|an|the|one|some|this|that|those|these|more|any)\s+)?([a-z][\w\-' ]{2,50})/gi;

function trimItem(raw: string): string | null {
  const cut = raw.split(STOP_ITEM)[0] ?? "";
  const words = cut.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  while (words.length && /^(the|a|an|of|some|my|your|more|it|them|one|ones)$/i.test(words[words.length - 1])) words.pop();
  const s = words.join(" ");
  return s.length >= 3 && !/^(it|them|this|that|me|you|us|order|payment|money|time)$/i.test(s) && !NOT_AN_ITEM.test(s) ? s : null;
}

/** "3 office chairs", "need 20 notebooks", "is the red saree available? 2 pieces" → qty + item. */
export function itemIn(text: string): { qty: number | null; item: string } | null {
  const t = text.replace(/\s+/g, " ");
  let bareQty: number | null = null;
  for (const m of t.matchAll(ITEM_QTY_RE)) {
    if (SKIP_AFTER_NUM.test(m[3])) continue;
    // "3BHK flat", "2TB drive": the number is part of the product name, not a quantity.
    if (!m[2] && new RegExp(`${m[1]}${escapeRe(m[3].slice(0, 1))}`).test(m[0])) {
      const spec = trimItem(`${m[1]}${m[3]}`);
      if (spec && !NOT_AN_ITEM.test(m[3])) return { qty: null, item: spec };
      continue;
    }
    const item = trimItem(m[3]);
    if (!item || /^(of|in|on|with|and)\b/i.test(item)) continue;
    if (UNIT_ONLY.test(item)) {
      bareQty ??= Number(m[1]);
      continue;
    }
    const unit = m[2] && /pair|set|box|pack|dozen|carton/i.test(m[2]) ? `${m[2]} of ` : "";
    return { qty: Number(m[1]), item: cap(unit + item) };
  }
  for (const m of t.matchAll(ITEM_VERB_RE)) {
    const item = trimItem(m[1]);
    if (item && !UNIT_ONLY.test(item) && !/^(?:to|it|you|me|help|know|confirm|pay|call|talk|ask|check|see|get|go|come|update)\b|^\d/i.test(item)) {
      return { qty: bareQty, item: cap(item) };
    }
  }
  return null;
}

/* --------------------------- Detectors ------------------------------- */

type Found = { value: CellValue; confidence: number; evidence: string | null; method?: Candidate["method"]; messageId?: string | null; isDefault?: boolean };

const NOT_NAME = new Set(
  "interested looking fine good ok okay here not sure available coming going waiting sorry back done ready happy from also still the a an at in on your customer client calling writing contacting reaching messaging with new old just very really trying planning there".split(" "),
);
const NAME_STOP = new Set("and i here from with calling writing looking interested want wanted hai hu hoon ji sir madam bhai bhaiya from the a an".split(" "));

const INTRO_ANY = /\b(?:my name is|my name's|myself|mera naam|naam hai|name\s*[:-])\s*([\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*){0,3})/iu;
const INTRO_CAP = /\b(?:[Tt]his is|I am|I'm|[Ii]t's|[Hh]ere is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/;

/** "my name is Rahul", "this is Priya Sharma", "mera naam Amit hai" → the name, with verbatim evidence. */
export function selfIntroduction(text: string): { name: string; evidence: string; confidence: number } | null {
  for (const [re, confidence] of [
    [INTRO_ANY, 0.95],
    [INTRO_CAP, 0.85],
  ] as const) {
    const m = re.exec(text);
    if (!m) continue;
    const raw = m[1];
    const kept: string[] = [];
    for (const w of raw.split(/\s+/)) {
      if (NAME_STOP.has(w.toLowerCase().replace(/[.']/g, ""))) break;
      kept.push(w.replace(/[.,]+$/, ""));
    }
    if (!kept.length || NOT_NAME.has(kept[0].toLowerCase()) || kept.join("").length < 2) continue;
    const keptRaw = raw.slice(0, raw.indexOf(kept[kept.length - 1]) + kept[kept.length - 1].length);
    const start = m.index ?? 0;
    const evidence = text.slice(start, start + m[0].indexOf(raw) + keptRaw.length);
    const name = kept.map((w) => (w === w.toLowerCase() ? cap(w) : w)).join(" ");
    return { name, evidence, confidence };
  }
  return null;
}

const CUR = "(?:₹|\\$|€|£|\\b(?:rs\\.?|inr|usd|eur|gbp|aed|dhs?))";
const NUM = "(\\d{1,3}(?:,\\d{2,3})+|\\d+)(?:\\.(\\d{1,2}))?\\s*(k|lakh|lac|l|cr)?\\b";
/** After a bare number: a time, a percentage or a word other than a connector ("10 packs") means it isn't money. */
const NOT_MONEY_AFTER =
  "(?!\\s*(?:[:%]|(?!(?:by|via|to|on|in|through|using|with|from|only|tomorrow|today|tonight|now|just|already|yesterday|later|please|pls|and|before|after|as|is|was|will|rs|rupees?|rupaye|inr|dollars|bucks|done|paid|sent|pending|due|per|each|for|a|an|ka|ki|ke|se|hai|thanks|thank|ok|okay)\\b)[a-z]))";

const mult = (u?: string) => {
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
};
const toNum = (int: string, dec?: string, unit?: string) => Number(int.replace(/,/g, "") + (dec ? "." + dec : "")) * mult(unit);

const LOCATE_RES = [
  new RegExp(`\\b(?:grand total|total|amount|bill|pay(?:able)?)\\b[^\\d₹$€£]{0,12}?${CUR}?\\s?${NUM}`, "gi"),
  new RegExp(`${CUR}\\s?${NUM}`, "gi"),
  new RegExp(`\\b${NUM}\\s?(?:rs|rupees|inr|\\/-|dollars|usd|aed)\\b`, "gi"),
];
const PAY_NUM = new RegExp(
  `\\b(?:paid|paying|sent|transferred|deposited|received|bheje|bhej diya|bhej diye|kar diya)\\s+(?:you\\s+|u\\s+)?${CUR}?\\s?${NUM}${NOT_MONEY_AFTER}`,
  "i",
);
const NUM_PAID = new RegExp(`\\b${NUM}\\s*(?:rs\\.?|rupees|inr|\\/-)?\\s*(?:ka\\s+)?(?:payment\\s+)?(?:paid|sent|transferred|bhej diya|bhej diye|kar diya|done)\\b`, "i");
const PRICE_NUM = new RegExp(
  `\\b(?:price|rate|cost|budget|mrp|amount|total|bill|charges?|fees?|deposit|advance)\\s*(?:is|of|=|:|-|around|approx\\.?|about|upto|up to|under|within|hai|tak)?\\s*${CUR}?\\s?${NUM}${NOT_MONEY_AFTER}`,
  "i",
);

/** Amount stated in `text` with a verbatim evidence snippet. */
export function amountIn(text: string): { value: number; evidence: string; confidence: number } | null {
  const v = bestAmount(text);
  if (v !== null) {
    for (const [i, re] of LOCATE_RES.entries()) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const n = toNum(m[1], m[2], m[3]);
        if (Math.abs(n - v) < 0.005) return { value: v, evidence: m[0].trim(), confidence: i === 0 ? 0.9 : 0.92 };
      }
    }
    // Computed totals ("8 lamps at ₹890 each") — quote the clause that states them.
    const idx = text.search(/\d/);
    return { value: v, evidence: clauseAround(text, Math.max(0, idx)), confidence: 0.85 };
  }
  for (const [re, confidence] of [
    [PAY_NUM, 0.88],
    [NUM_PAID, 0.86],
    [PRICE_NUM, 0.86],
  ] as const) {
    const m = re.exec(text);
    if (!m) continue;
    const n = toNum(m[1], m[2], m[3]);
    if (n > 0 && n < 1e10) return { value: n, evidence: m[0].trim(), confidence };
  }
  return null;
}

const PAYMENT_CONTEXT = /\b(total|bill|amount|pay|payable|due|balance|invoice|price|cost|charges?)\b/i;

/** For payment messages without an amount ("Done, paid"), the amount stated just before in the conversation. */
function amountFromContext(env: ExtractEnv): Found | null {
  const recent = env.context.slice(-6).reverse();
  for (const m of recent) {
    if (env.message.sentAt.getTime() - m.sentAt.getTime() > 7 * 86_400_000) break;
    const a = amountIn(m.text);
    if (!a) continue;
    const close = env.message.sentAt.getTime() - m.sentAt.getTime() <= 86_400_000 && PAYMENT_CONTEXT.test(m.text);
    return { value: a.value, confidence: close ? 0.85 : 0.7, evidence: a.evidence, messageId: m.id };
  }
  return null;
}

const DATE_PHRASE =
  /\b(day after tomorrow|tomorrow|tmrw|tmr|kal|today|tonight|by eod|end of (?:the )?day|(?:by|on|this|next|before|coming)?\s*(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?|in \d{1,2} days?)\b/i;

/** Clause containing the relative/explicit date phrase that `findDueDate` resolved. */
function dateEvidence(text: string): string {
  const m = DATE_PHRASE.exec(text);
  return clauseAround(text, m?.index ?? 0);
}

/** "send 10 packs to Koramangala, Bangalore 560034" → "Koramangala, Bangalore 560034". */
const SEND_TO_PLACE =
  /\b(?:send|deliver|ship|courier|dispatch|bhej(?:o|na|do|dena)?)\b[^.?!\n]{0,60}?\bto\s+((?:[A-Z][a-zA-Z]+|\d{1,4}[A-Za-z]?\b(?=[ ,]+[A-Z]))(?:[ ,]+(?:[A-Z][a-zA-Z]+|\d{6}|(?:road|rd|nagar|colony|sector|street|st|lane|layout|block|phase)\b)){0,6})/;

const KIND_LABEL: Record<string, string> = { image: "Image", video: "Video", audio: "Voice note", document: "Document", contact: "Contact card", sticker: "Sticker", location: "Location" };

function fileTypeOf(msg: PipelineMessage): string | null {
  if (KIND_LABEL[msg.kind] && msg.kind !== "text") return KIND_LABEL[msg.kind];
  const mime = msg.attachments[0]?.mime ?? "";
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Voice note";
  return msg.attachments.length ? "Document" : null;
}

const SIZE_RE = /\b(?:size\s*[:-]?\s*|uk\s*|us\s*|eu\s*)(\d{1,2}|xxxl|xxl|xl|xs|s|m|l)\b/i;
const COLOR_RE = /\b(red|blue|green|black|white|beige|navy|pink|yellow|grey|gray|brown|maroon|olive|orange|purple|cream|gold|silver)\b/i;
const OUTBOUND_PROMISE = /\b(?:i'?ll|i will|we'?ll|we will)\s+(?:send|share|call|deliver|update|check|confirm|arrange|dispatch|ship|get back)\b[^.?!\n]{0,80}/i;
const SHARED_NAME_RES = [
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'s\s+(?:number|contact|no\.?|mobile|phone)\b/,
  /\b(?:number|contact|no\.?|mobile|phone)\s+(?:of|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[:–-]\s*\+?\d[\d\s-]{7,}/,
];

function personFromMetadata(msg: PipelineMessage): Found | null {
  if (msg.direction === "inbound") {
    if (msg.senderName && !isPhoneLike(msg.senderName)) return { value: msg.senderName.trim().slice(0, 120), confidence: 0.9, evidence: null, method: "metadata" };
    if (msg.contact?.displayName && !isPhoneLike(msg.contact.displayName)) return { value: msg.contact.displayName, confidence: 0.85, evidence: null, method: "metadata" };
    return null;
  }
  // Business replies: the customer is the conversation's contact, never the business sender.
  if (msg.contact?.displayName && !isPhoneLike(msg.contact.displayName)) return { value: msg.contact.displayName, confidence: 0.85, evidence: null, method: "metadata" };
  if (!msg.isGroup && msg.conversationTitle && !isPhoneLike(msg.conversationTitle)) return { value: msg.conversationTitle.slice(0, 120), confidence: 0.8, evidence: null, method: "metadata" };
  return null;
}

function phoneFromMetadata(msg: PipelineMessage, defaultCountry?: string): Found | null {
  if (msg.contact?.phone) return { value: msg.contact.phone, confidence: 0.95, evidence: null, method: "metadata" };
  if (msg.direction === "inbound" && msg.senderHandle && /^\+?\d{8,15}$/.test(msg.senderHandle.replace(/[\s-]/g, ""))) {
    // WhatsApp/SMS handles are international numbers without the "+".
    const raw = msg.channelType === "whatsapp_cloud" || msg.channelType === "sms_twilio" ? `+${msg.senderHandle.replace(/^\+/, "")}` : msg.senderHandle;
    const p = normalizePhone(raw, defaultCountry);
    if (p) return { value: p, confidence: 0.9, evidence: null, method: "metadata" };
  }
  return null;
}

function sentenceMatching(text: string, re: RegExp): string | null {
  return sentences(text).find((s) => re.test(s)) ?? null;
}

function detect(role: FieldRole, field: Field, env: ExtractEnv, collection: Pick<CollectionRow, "fields">): Found | null {
  const msg = env.message;
  const text = msg.text;
  const inbound = msg.direction === "inbound";
  switch (role) {
    case "customer": {
      const intro = inbound && text ? selfIntroduction(text) : null;
      if (intro) return { value: intro.name, confidence: intro.confidence, evidence: intro.evidence };
      return personFromMetadata(msg);
    }
    case "sender":
      if (msg.senderName && !isPhoneLike(msg.senderName)) return { value: msg.senderName.trim().slice(0, 120), confidence: 0.95, evidence: null, method: "metadata" };
      if (!inbound) return { value: "You", confidence: 0.9, evidence: null, method: "metadata" };
      return personFromMetadata(msg);
    case "shared_name": {
      for (const re of SHARED_NAME_RES) {
        const m = re.exec(text);
        if (m) return { value: m[1], confidence: 0.85, evidence: clauseAround(text, m.index ?? 0) };
      }
      if (inbound && /\bmy (?:number|contact|mobile|phone|no\.?)\b/i.test(text)) return personFromMetadata(msg);
      if (msg.kind === "contact") {
        const first = text.split("\n")[0]?.replace(/^(?:name\s*[:-]\s*)/i, "").trim();
        if (first && !isPhoneLike(first) && first.length <= 80) return { value: first, confidence: 0.85, evidence: first };
      }
      return null;
    }
    case "phone": {
      const p = inbound ? findPhones(text)[0] : undefined;
      if (p) return { value: p, confidence: 0.95, evidence: p };
      return phoneFromMetadata(msg, env.defaultCountry);
    }
    case "shared_phone": {
      const p = findPhones(text)[0];
      return p ? { value: p, confidence: 0.95, evidence: p } : null;
    }
    case "email": {
      const e = inbound ? findEmails(text)[0] : undefined;
      if (e) return { value: e, confidence: 0.97, evidence: e };
      return msg.contact?.email ? { value: msg.contact.email, confidence: 0.9, evidence: null, method: "metadata" } : null;
    }
    case "url": {
      const u = findUrls(text)[0];
      return u ? { value: u, confidence: 0.97, evidence: u } : null;
    }
    case "domain": {
      const u = findUrls(text)[0];
      if (!u) return null;
      try {
        const host = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "");
        return { value: host, confidence: 0.97, evidence: u };
      } catch {
        return null;
      }
    }
    case "link_context": {
      const u = findUrls(text)[0];
      if (!u) return null;
      const rest = text.split(u).join(" ").replace(/\s+/g, " ").trim();
      return rest ? { value: rest.slice(0, 200), confidence: 0.9, evidence: clauseAround(text, Math.max(0, text.indexOf(u))) } : null;
    }
    case "amount": {
      const a = text ? amountIn(text) : null;
      if (a) return a;
      if (env.category === "payment") return amountFromContext(env);
      return null;
    }
    case "quantity": {
      const it = text && !COMPLAINT_STRONG.test(text) ? itemIn(text) : null;
      if (!it?.qty) return null;
      return { value: it.qty, confidence: 0.85, evidence: snippetFor(text, it.item.toLowerCase()) ?? clauseAround(text, 0) };
    }
    case "item": {
      if (!text || COMPLAINT_STRONG.test(text) || RESOLVED.test(text)) return null;
      const it = itemIn(text);
      if (!it) return null;
      const hasQtyField = collection.fields.some((f) => f !== field && f.type === "number" && /\b(qty|quantity|units?|pieces|pcs)\b/i.test(`${f.key} ${f.label}`));
      const value = !hasQtyField && it.qty ? `${it.qty} ${it.item.charAt(0).toLowerCase()}${it.item.slice(1)}` : it.item;
      return { value, confidence: it.qty ? 0.85 : 0.82, evidence: snippetFor(text, it.item) ?? clauseAround(text, 0) };
    }
    case "product": {
      const caption = text.trim();
      if (msg.attachments.length && caption && caption.length <= 40 && !caption.includes("?") && !findUrls(caption).length) return { value: cap(caption), confidence: 0.82, evidence: caption };
      const it = text ? itemIn(text) : null;
      if (it) return { value: it.item, confidence: 0.8, evidence: snippetFor(text, it.item) };
      if (msg.kind === "document" && msg.attachments[0]?.name) return { value: msg.attachments[0].name.replace(/\.[a-z0-9]{2,5}$/i, ""), confidence: 0.85, evidence: null, method: "metadata" };
      return null;
    }
    case "location": {
      if (!inbound || !text) return null;
      const to = SEND_TO_PLACE.exec(text);
      if (to) return { value: to[1].replace(/[\s,]+$/, ""), confidence: 0.9, evidence: clauseAround(text, to.index ?? 0) };
      const loc = findLocation(text);
      if (!loc) return null;
      const first = loc.split(/\s+/)[0];
      const evidence = snippetFor(text, first) ?? clauseAround(text, 0);
      const explicit = /\b(?:deliver(?:y)?\s+(?:to|at|in)|ship\s+to|address|located\s+(?:in|at)|location|based\s+in)\b/i.test(evidence);
      return { value: loc, confidence: explicit ? 0.9 : /\d{6}/.test(loc) ? 0.85 : 0.8, evidence };
    }
    case "status": {
      const options = field.options ?? [];
      if (!options.length || !text) return options.length ? { value: options[0], confidence: 0.5, evidence: null, isDefault: true } : null;
      const s = matchStatus(options, text, msg.direction);
      if (s) return { value: s.value, confidence: 0.9, evidence: s.evidence };
      return { value: options[0], confidence: 0.5, evidence: null, isDefault: true };
    }
    case "activity_date":
    case "created_date":
      return { value: localDate(msg.sentAt, env.timezone), confidence: 1, evidence: null, method: "metadata" };
    case "due_date": {
      if (!text) return null;
      const due = findDueDate(text, wallClock(msg.sentAt, env.timezone).getTime());
      if (due === null) return null;
      return { value: isoDate(due), confidence: 0.85, evidence: dateEvidence(text) };
    }
    case "method": {
      const m = payMethod(text);
      return m ? { value: m.value, confidence: 0.95, evidence: snippetFor(text, m.match) ?? m.match } : null;
    }
    case "reference": {
      const m = REFERENCE_RE.exec(text);
      return m ? { value: m[1], confidence: 0.95, evidence: m[0] } : null;
    }
    case "issue": {
      if (!inbound || NO_PROBLEM.test(text)) return null;
      const s = sentenceMatching(text, PAYMENT_ISSUE) ?? sentenceMatching(text, DELIVERY_ISSUE) ?? sentenceMatching(text, COMPLAINT_STRONG) ?? sentenceMatching(text, REFUND_REQUEST) ?? sentenceMatching(text, COMPLAINT_WEAK);
      return s ? { value: cap(s.replace(/\s+/g, " ").slice(0, 160)), confidence: 0.85, evidence: s.slice(0, 160) } : null;
    }
    case "task": {
      if (!inbound) {
        const p = OUTBOUND_PROMISE.exec(text);
        return p ? { value: cap(p[0].trim()), confidence: 0.8, evidence: p[0].trim() } : null;
      }
      const s = sentenceMatching(text, REQUEST) ?? sentenceMatching(text, REQUEST_HINGLISH) ?? sentenceMatching(text, APPOINTMENT);
      return s ? { value: cap(s.replace(/\s+/g, " ").slice(0, 160)), confidence: 0.85, evidence: s.slice(0, 160) } : null;
    }
    case "next_step": {
      const m = NEXT_STEP.exec(text);
      return m ? { value: cap(m[0].trim()), confidence: 0.8, evidence: m[0].trim() } : null;
    }
    case "summary": {
      const t = text.trim();
      return t ? { value: t.slice(0, 200), confidence: 0.9, evidence: t.slice(0, 160) } : null;
    }
    case "caption": {
      const t = text.trim();
      return t && (msg.attachments.length || msg.kind !== "text") ? { value: t.slice(0, 300), confidence: 0.95, evidence: t.slice(0, 160) } : null;
    }
    case "file": {
      const name = msg.attachments[0]?.name;
      return name ? { value: name.slice(0, 200), confidence: 0.95, evidence: null, method: "metadata" } : null;
    }
    case "file_type": {
      const t = fileTypeOf(msg);
      return t ? { value: t, confidence: 1, evidence: null, method: "metadata" } : null;
    }
    case "chat":
      return msg.conversationTitle ? { value: msg.conversationTitle.slice(0, 120), confidence: 1, evidence: null, method: "metadata" } : null;
    case "image": {
      const img = msg.attachments.find((a) => a.fileId && a.mime.startsWith("image/"));
      return img?.fileId ? { value: img.fileId, confidence: 1, evidence: null, method: "metadata" } : null;
    }
    case "size": {
      const m = SIZE_RE.exec(text);
      return m ? { value: m[0].trim(), confidence: 0.85, evidence: m[0].trim() } : null;
    }
    case "color": {
      const m = COLOR_RE.exec(text);
      return m ? { value: cap(m[1].toLowerCase()), confidence: 0.85, evidence: snippetFor(text, m[0]) ?? m[0] } : null;
    }
    case "generic":
      return labelLookup(field, text);
    case "none":
      return null;
  }
}

/** Custom fields: "GST no: 29ABC…", "3 BHK", "Size - XL". */
function labelLookup(field: Field, text: string): Found | null {
  if (!text) return null;
  const lab = escapeRe(field.label.trim());
  if (!lab) return null;
  const before = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*${lab}\\b`, "i").exec(text);
  if (before) return { value: field.type === "number" ? Number(before[1]) : before[0], confidence: 0.75, evidence: before[0] };
  const after = new RegExp(`\\b${lab}\\b\\s*(?:is|=|:|-)\\s*([\\w₹$.,/-]{1,40})`, "i").exec(text);
  if (after) return { value: after[1].replace(/[.,]+$/, ""), confidence: 0.75, evidence: after[0] };
  return null;
}

/** Roles a payment/business reply may change on an existing record (update-only routes). */
const UPDATE_ONLY_ROLES = new Set<FieldRole>(["status", "activity_date"]);

/** Rules extraction for one collection. Returns at most one candidate per field. */
export function extractRules(collection: Pick<CollectionRow, "template" | "fields">, env: ExtractEnv, opts: { updateOnly: boolean }): Candidate[] {
  const out: Candidate[] = [];
  for (const field of collection.fields) {
    const role = fieldRole(collection, field);
    if (opts.updateOnly && !UPDATE_ONLY_ROLES.has(role)) continue;
    const f = detect(role, field, env, collection);
    if (!f || f.value === null || f.value === "") continue;
    out.push({
      field,
      role,
      value: f.value,
      confidence: f.confidence,
      evidence: f.evidence ? f.evidence.slice(0, 500) : null,
      method: f.method ?? "rules",
      messageId: f.messageId ?? env.message.id,
      ...(f.isDefault ? { isDefault: true } : {}),
    });
  }
  return out;
}

/** Message-level entities independent of any collection (spec: customer_name, phone, ...). */
export function genericEntities(env: ExtractEnv): ExtractedEntity[] {
  const msg = env.message;
  const text = msg.text;
  if (!text) return [];
  const out: ExtractedEntity[] = [];
  const inbound = msg.direction === "inbound";
  if (inbound) {
    const intro = selfIntroduction(text);
    if (intro) out.push({ field: "customer_name", value: intro.name, confidence: intro.confidence, evidence: intro.evidence, method: "rules", collection_id: null });
    for (const p of findPhones(text).slice(0, 3)) out.push({ field: "phone", value: normalizePhone(p, env.defaultCountry) ?? p, confidence: 0.95, evidence: p, method: "rules", collection_id: null });
    for (const e of findEmails(text).slice(0, 3)) out.push({ field: "email", value: e.toLowerCase(), confidence: 0.97, evidence: e, method: "rules", collection_id: null });
  }
  for (const u of findUrls(text).slice(0, 3)) out.push({ field: "url", value: u, confidence: 0.97, evidence: u, method: "rules", collection_id: null });
  const amount = amountIn(text);
  if (amount) out.push({ field: "amount", value: amount.value, confidence: amount.confidence, evidence: amount.evidence, method: "rules", collection_id: null });
  const due = findDueDate(text, wallClock(msg.sentAt, env.timezone).getTime());
  if (due !== null) out.push({ field: "date_mentioned", value: isoDate(due), confidence: 0.8, evidence: dateEvidence(text), method: "rules", collection_id: null });
  return out;
}
