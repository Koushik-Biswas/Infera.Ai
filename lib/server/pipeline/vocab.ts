/**
 * Deterministic vocabularies used by the rules classifier and extractors.
 * Ported from the on-device engine (lib/app/extract.ts, where they are
 * module-private) and extended with common Hinglish / Indian business phrasing.
 */
import { cap, clauseAround, escapeRe, sentences } from "./text";

import type { Direction } from "./types";
export type { Direction };

/* ----------------------------- Payments ------------------------------ */

// Completion phrases only: naming a method ("Can I pay by UPI?") or sharing a UPI id isn't a payment.
export const PAID =
  /\b(paid|payment (?:done|sent|made|completed|successful|received|ho gaya|ho gya|kar diya|kar di|kardi|kardiya|kar diye)|sent (?:you )?(?:the )?(?:money|payment|amount)|transferred|credited|payment screenshot|pay kar (?:diya|di|diye)|(?:gpay|g pay|phonepe|paytm|upi) (?:kar|kr) (?:diya|di|diye)|paise bhej (?:diye|diya|di)|paisa bhej (?:diya|di)|amount bhej (?:diya|di)|payment bhej (?:diya|di)|transfer kar (?:diya|di)|received (?:the |your )?(?:payment|amount|money)|amount received|money received|got (?:the |your )?payment)\b/i;
/** "sent 500", "transferred ₹1,200", "500 bhej diya" — a sent amount counts as paid. */
export const SENT_AMOUNT =
  /\b(?:sent|transferred|deposited)\s+(?:you\s+|u\s+)?(?:rs\.?|inr|₹)?\s?\d|(?:₹\s?)?\b\d[\d,]*(?:\.\d+)?\s*(?:rs\.?|rupees|rupaye|\/-)?\s*(?:ka\s+)?(?:payment\s+)?(?:bhej|transfer kar|send kar|pay kar)\s?(?:diya|diye|di)\b/i;
const METHOD_WORDS = "(?:upi|gpay|g pay|google pay|cash|card|credit card|debit card|cheque|check|phonepe|phone pe|paytm|neft|imps|rtgs|bank|net ?banking|paypal)";
export const PENDING_PAY = new RegExp(
  `\\b(will pay|i'?ll pay|will send (?:the )?(?:money|payment|amount)|pay (?:you )?(?:tomorrow|later|next|tonight|soon|after)|pay (?:you )?(?:by|on|before) (?!${METHOD_WORDS}\\b)|payment (?:pending|due)|pending payment|due amount|balance (?:amount|due|payment)|outstanding|kal (?:pay|payment|bhej)|pay kar (?:dunga|dungi|denge|doonga)|bhej (?:dunga|dungi|denge|doonga)|baad (?:mein|me) (?:pay|payment|bhej))\\b`,
  "i",
);
export const NOT_PAID = /\b(not (?:yet )?paid|unpaid|yet to (?:be )?pa(?:y|id)|(?:haven'?t|have not|hasn'?t|has not|didn'?t|did not) (?:yet )?pa(?:y|id)|payment nahi (?:hua|kiya|aaya|aya))\b/i;
export const PAY_REQUEST =
  /\b(please pay|kindly pay|pls pay|plz pay|pay (?:the )?(?:balance|amount|bill|dues?|remaining)|payment (?:is )?(?:due|pending)|send (?:the )?payment|make (?:the )?payment|upi id|bank details|account details|qr code|payment link|have you paid|did you pay|payment kab|kab tak pay)\b/i;
export const PAYMENT_ISSUE =
  /\b(payment (?:failed|declined|stuck|not (?:received|reflecting|credited|showing))|(?:amount|money) (?:got )?(?:deducted|debited)|deducted but|debited but|double (?:charged|payment)|charged twice|transaction failed|paise kat gaye|paisa kat gaya)\b/i;
export const REFUND_REQUEST = /\b(refund|money back|paisa wapas|paise wapas|return (?:my|the) money|want my money)\b/i;
export const REFUND_DONE = /\b(refunded|refund (?:is |has been )?(?:done|processed|credited|initiated|completed|received|issued)|money (?:has been )?(?:returned|credited back)|reversed)\b/i;

/** A completed payment: a completion phrase that isn't negated, pending, or asked as a question ("Have you paid?"). */
export function paidMatch(t: string): RegExpExecArray | null {
  if (PENDING_PAY.test(t) || NOT_PAID.test(t)) return null;
  for (const s of sentences(t)) {
    const m = PAID.exec(s) ?? SENT_AMOUNT.exec(s);
    if (m && !/\?\s*$/.test(s)) return m;
  }
  return null;
}
export const isPaid = (t: string) => paidMatch(t) !== null;

const METHOD_RE = /\b(gpay|g pay|google pay|phonepe|phone pe|paytm|upi|neft|imps|rtgs|bank transfer|net ?banking|cash|card|credit card|debit card|cheque|check|paypal|bhim|amazon pay|cred)\b/i;

export function payMethod(t: string): { value: string; match: string } | null {
  const m = METHOD_RE.exec(t);
  if (!m) return null;
  const v = m[1].toLowerCase().replace(/\s+/g, " ");
  let value: string;
  if (v === "google pay" || v === "gpay" || v === "g pay") value = "GPay";
  else if (v === "upi" || v === "bhim") value = "UPI";
  else if (/^(neft|imps|rtgs)$/.test(v)) value = v.toUpperCase();
  else if (v === "phonepe" || v === "phone pe") value = "PhonePe";
  else if (v === "paytm") value = "Paytm";
  else if (v === "paypal") value = "PayPal";
  else if (v === "amazon pay") value = "Amazon Pay";
  else if (v === "cred") value = "CRED";
  else if (v === "netbanking" || v === "net banking") value = "Net banking";
  else if (v === "check") value = "Cheque";
  else value = cap(v);
  return { value, match: m[0] };
}

export const REFERENCE_RE = /\b(?:utr|ref(?:erence)?|txn|transaction|upi ref|order id|invoice)\s*(?:id|no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,})\b/i;

/* ------------------------------ Orders ------------------------------- */

export const CANCEL = /\b(cancel(?:led|ed|ling)?|don'?t want (?:it|them|the order)|no longer need|not needed anymore|order cancel|nahi chahiye)\b/i;
export const DELIVERY_ISSUE =
  /\b(not (?:yet )?(?:been )?delivered|delivered nahi|delivery nahi|nahi (?:aaya|aya|mila|pahuncha)|abhi tak nahi|didn'?t (?:get|receive)|haven'?t (?:got|received)|not (?:yet )?received|still waiting for (?:my|the) (?:order|parcel|delivery|package))\b/i;
export const DELIVERED = /\b(delivered|received (?:the|my|it|them|parcel|order|package)|got (?:the|my) (?:parcel|order|package|delivery)|mil gaya|aa gaya)\b/i;
export const SHIPPED = /\b(shipped|dispatch(?:ed)?|tracking (?:id|number|no|link)|courier(?:ed)?|out for delivery|in transit|sent the parcel|awb)\b/i;
export const PACKED = /\b(packed|packing (?:done|complete)|ready (?:to|for) (?:ship|dispatch|pickup))\b/i;
export const CONFIRMED = /\b(confirm(?:ed)?|go ahead|finali[sz]ed?|book it|done deal|proceed|okay send|ok send|please send|pakka)\b/i;
export const ORDER_STATUS_Q =
  /\b(where is my (?:order|parcel|package)|order status|status of (?:my|the) order|when will (?:it|my order|the parcel|the order) (?:arrive|come|be delivered|reach|ship)|kab (?:tak )?(?:aayega|ayega|milega|deliver|aaega)|track (?:my )?order|has it (?:been )?(?:shipped|dispatched)|(?:have|has) (?:you|it|my order|the order) (?:been )?(?:shipped|dispatched|sent)(?: my| the)?(?: order| parcel)?)\b/i;
export const MODIFY_ORDER =
  /\b(change (?:the |my )?(?:size|colou?r|address|quantity|qty|order)|instead of|replace (?:it )?with|make it \d|add (?:one|\d+) more|increase (?:the )?(?:qty|quantity)|reduce (?:the )?(?:qty|quantity))\b/i;
export const STRONG_ORDER =
  /\b((?:place|confirm) (?:an |my |the |this )?order|order (?:kar|karna|kardo|kar do|kar dijiye)|i'?ll take (?:it|them|\d+|one|two)|i will take|book (?:it|them)|go ahead|cash on delivery|cod|i want to order|i'?d like to order|i would like to order|finali[sz]e)\b/i;
export const WEAK_ORDER = /\b(please send|pls send|plz send|send me \d+|bhej do|bhej dijiye|bhejo|deliver (?:it |them )?to|ship (?:it |them )?to|confirmed|pack (?:it|them))\b/i;

/* ------------------------------ Leads -------------------------------- */

export const PRICE = /\b(price|prices|pricing|rate|rates|cost|costs|how much|kitna|kitne ka|kitne ki|kitne mein|kya rate|mrp|quote|quotation|price list|rate card|charges?|fees?)\b/i;
export const AVAILABILITY = /\b(available|availability|in stock|stock (?:me|mein|hai)|milega|mil jayega|do you have|have you got|do u have|any (?:stock|pieces))\b/i;
export const INTEREST =
  /\b(want to buy|wanna buy|want to purchase|looking for|interested in|interested|i need|need (?:a|an|some|\d+)|chahiye|lena hai|kharidna|buy|purchase|enquir(?:y|e)|inquir(?:y|e)|details (?:of|about|for)|more info|catalog(?:ue)?|brochure)\b/i;
export const BUY_VERB = /\b(buy|purchase|order|book|take|lena|kharid)\w*\b/i;
export const LOST = /\b(not interested|no longer interested|went with|bought (?:it )?elsewhere|too expensive|out of (?:my )?budget|nahi chahiye)\b/i;
export const WON = /\b(deal done|confirmed|booking amount|token (?:amount|advance)|advance paid|signed|let'?s (?:go ahead|proceed)|paid|pakka)\b/i;
export const PROPOSAL = /\b(quote|quotation|proposal|estimate|price list|brochure|catalog(?:ue)?|rate card|pricing)\b/i;
export const QUALIFIED = /\b(budget|site visit|visit|meeting|meet|call me|schedule|demo|when can|available on|requirement|bhk|sq\.? ?ft)\b/i;
export const NEXT_STEP = /\b(call me|call you|schedule|site visit|visit|meet(?:ing)?|send (?:me |us )?the|share the|quotation|quote|demo|follow up)\b[^.?!\n]{0,60}/i;

/* ----------------------------- Support ------------------------------- */

export const COMPLAINT_STRONG =
  /\b(damaged|broken|defect(?:ive)?|wrong (?:size|item|colou?r|product|order)|not working|stopped working|complain(?:t)?|torn|faded|leak(?:ing)?|poor quality|kharab|toota|tooti|toote|galat|kaam nahi (?:kar )?(?:raha|rahi)|nahi chal (?:raha|rahi)|bekar|bakwas)\b/i;
export const COMPLAINT_WEAK = /\b(issue|problem|return|replace(?:ment)?|missing|late|delay(?:ed)?|not (?:yet )?received|haven'?t received)\b/i;
export const NO_PROBLEM = /\b(no (?:issue|problem|worries)|not a problem|koi (?:baat|problem) nahi)\b/i;
export const RESOLVED = /\b(resolved|replaced|refunded|sorted|fixed|received the replacement|issue (?:is )?closed|all good now|works now|working now|ho gaya theek|theek ho gaya)\b/i;
export const IN_PROGRESS = /\b(looking into|checking (?:it|this|on)|we will (?:fix|replace|refund|resolve|check)|we'?ll (?:fix|replace|refund|resolve|check)|escalated|raised a ticket|ticket (?:number|id|no)|working on (?:it|this))\b/i;

/* --------------------------- Tasks / follow-ups ----------------------- */

export const REQUEST =
  /\b(please|pls|plz|kindly|can you|could you|would you|remind|don'?t forget|need you to|make sure)\b[^.?!\n]*\b(send|share|call|deliver|update|check|confirm|book|add|bring|pay|mail|email|forward|prepare|arrange|schedule|fix|change|reserve|keep|dispatch|ship|mark)\b/i;
export const REQUEST_HINGLISH = /\b(bhej dena|send kar dena|share kar dena|yaad (?:dila|se)|follow[- ]?up|get back to me|call back|callback|let me know|update me|batana|bata dena)\b/i;
export const DONE_REPLY = /\b(done|sent|shared|updated|completed|delivered|booked|added|dispatched|shipped|called|fixed|arranged|scheduled|marked|ho gaya|kar diya)\b/i;
export const DONE_INBOUND = /\b(done|completed|finished|ho gaya|kar diya)\b/i;

export const APPOINTMENT =
  /\b(appointment|meeting|meet (?:you|tomorrow|today|on|at|in)|schedule (?:a )?(?:call|meeting|visit|demo)|book (?:a )?(?:slot|appointment|visit|demo|table)|site visit|visit (?:your|the) (?:shop|store|office|site|showroom)|call me (?:at|on|tomorrow|today|after|before|in)|reschedule|slot|milte hain|milna hai)\b/i;

/* --------------------------- Spam / chit-chat ------------------------- */

export const SPAM_STRONG =
  /\b(lottery|jackpot|you (?:have |'ve )?won|winner of|claim (?:your )?(?:prize|reward|gift|cash)|lucky draw|kbc|bitcoin|crypto(?:currency)?|forex|double your (?:money|investment)|guaranteed (?:returns?|profit)|instant loan|pre-?approved (?:personal )?loan|loan (?:offer|approved|sanctioned)|low interest loan|verify your (?:account|kyc)|kyc (?:update|expired|pending|blocked)|account (?:will be )?(?:blocked|suspended))\b/i;
export const SPAM_WEAK = /\b(click (?:here|the link|below|on the link)|limited (?:time )?offer|act now|work from home|part[- ]time job|free (?:gift|iphone|recharge)|congratulations|earn (?:rs\.?|₹|\$)?\s?\d[\d,]*\s*(?:per|\/|a) ?(?:day|week|month)|investment (?:plan|scheme|opportunity)|credit card offer)\b/i;

const GREETING_WORDS = new Set("hi hii hiii hiiii hello helo hey heya hola namaste namaskar namaskaram vanakkam salaam salam gm gn good morning afternoon evening night day sir madam maam mam ji bhai bhaiya didi dear there team all everyone friend friends".split(" "));
const GREETING_CORE = /\b(hi+|hello|helo|hey|heya|hola|namaste|namaskar(?:am)?|vanakkam|salaa?m|gm|good (?:morning|afternoon|evening|night|day))\b/i;
const ACK_WORDS = new Set(
  "ok okay okk okkk k kk kkk thanks thank thankyou tq thx ty u you so much a lot noted sure great cool fine alright allright perfect nice got it welcome np no problem sounds good yes ya yeah yep yup haan han ha theek thik hai accha acha achha ji dhanyavad dhanyawad shukriya wow awesome super right understood".split(
    " ",
  ),
);

const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

export function isGreetingOnly(t: string): boolean {
  const w = words(t);
  return w.length > 0 && w.length <= 6 && GREETING_CORE.test(t) && w.every((x) => GREETING_WORDS.has(x));
}

export function isAckOnly(t: string): boolean {
  const w = words(t);
  if (!w.length) return true; // only emoji / punctuation ("👍", "🙏🙏", "!!")
  return w.length <= 8 && w.every((x) => ACK_WORDS.has(x));
}

/* ---------------------------- Priority ------------------------------- */

export const URGENT = /\b(urgent(?:ly)?|asap|emergency|immediately|right now|right away|jaldi|turant|abhi chahiye|today itself|critical)\b/i;
export const LEGAL = /\b(legal action|lawyer|advocate|court|consumer (?:forum|court)|police (?:complaint|case)|file (?:a )?(?:case|fir|complaint against)|sue (?:you|your)|fir)\b/i;
export const ANGRY = /\b(worst|pathetic|fraud|cheat(?:ed|ers?|ing)?|scam(?:mers?)?|disgusting|horrible|terrible|unacceptable|ridiculous|useless|bakwas|chor)\b|!{2,}/i;
export const POSITIVE_FEEDBACK =
  /\b(thank you so much|thanks a lot|great service|excellent|awesome|amazing|loved it|love it|very happy|really happy|satisfied|good quality|best service|will recommend|highly recommend|5 stars?|five stars?|mast hai|badhiya|bahut accha|bahut badhiya)\b/i;
export const CONTACT_SHARE = /\b(number|contact|mobile|phone|whatsapp)\b[^.?!\n]{0,40}(?:\+?\d[\d\s-]{8,})|\b(?:call|contact|reach) (?:him|her|them)\b/i;

/* --------------------------- Status families -------------------------- */

type FamilyTest = (text: string, dir: Direction) => RegExpExecArray | null;

/** Match only outside questions ("Can I cancel?" isn't a cancellation). */
function statement(re: RegExp): FamilyTest {
  return (t) => {
    for (const s of sentences(t)) {
      const m = re.exec(s);
      if (m && !/\?\s*$/.test(s)) return m;
    }
    return null;
  };
}
const plain = (re: RegExp): FamilyTest => (t) => re.exec(t);

type Family = { name: string; option: RegExp; negative?: boolean; test: FamilyTest };

/**
 * Each status option is matched to a "family" by its name, and the family's
 * vocabulary decides whether a message moves the record to that status.
 * Options that match no family fall back to a literal word match.
 */
const FAMILIES: Family[] = [
  { name: "cancelled", option: /cancel/i, negative: true, test: statement(CANCEL) },
  { name: "lost", option: /^lost$|rejected|declined|dropped/i, negative: true, test: statement(LOST) },
  { name: "refunded", option: /refund/i, negative: true, test: plain(REFUND_DONE) },
  { name: "delivered", option: /deliver/i, test: (t) => (DELIVERY_ISSUE.test(t) ? null : statement(DELIVERED)(t, "inbound")) },
  { name: "shipped", option: /ship|dispatch|transit/i, test: plain(SHIPPED) },
  { name: "packed", option: /pack/i, test: plain(PACKED) },
  { name: "paid", option: /\bpaid\b|payment (?:received|done)|settled/i, test: (t) => paidMatch(t) },
  { name: "pending", option: /pending|\bdue\b|unpaid|awaiting/i, test: (t) => PENDING_PAY.exec(t) ?? NOT_PAID.exec(t) },
  { name: "won", option: /^won$|converted|closed[- ]won/i, test: statement(WON) },
  { name: "proposal", option: /proposal|quot|estimate/i, test: (t, dir) => (dir === "outbound" ? PROPOSAL.exec(t) : null) },
  { name: "qualified", option: /qualif/i, test: plain(QUALIFIED) },
  { name: "contacted", option: /contacted|replied|responded/i, test: (t, dir) => (dir === "outbound" ? /\S+/.exec(t) : null) },
  { name: "resolved", option: /resolv|fixed|closed/i, test: plain(RESOLVED) },
  { name: "in_progress", option: /progress|working|investigat|assigned/i, test: (t, dir) => (dir === "outbound" ? IN_PROGRESS.exec(t) : null) },
  { name: "done", option: /^done$|complete|finished/i, test: (t, dir) => (dir === "outbound" ? DONE_REPLY.exec(t) : statement(DONE_INBOUND)(t, dir)) },
  { name: "confirmed", option: /confirm/i, test: plain(CONFIRMED) },
];

export function familyOf(option: string): Family | null {
  return FAMILIES.find((f) => f.option.test(option)) ?? null;
}

export type StatusMatch = { value: string; evidence: string; negative: boolean };

/**
 * Status implied by the text, among `options` (pipeline order). Negative
 * terminal statuses (Cancelled/Lost/Refunded) win; otherwise the furthest
 * matched stage. Returns null when the text says nothing about status.
 */
export function matchStatus(options: string[], text: string, dir: Direction): StatusMatch | null {
  let best: { index: number; m: StatusMatch } | null = null;
  let negative: StatusMatch | null = null;
  options.forEach((option, index) => {
    const fam = familyOf(option);
    let m: RegExpExecArray | null;
    if (fam) m = fam.test(text, dir);
    else m = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(option)}(?![\\p{L}\\p{N}])`, "iu").exec(text);
    if (!m) return;
    // Family tests may run per sentence, so locate the match in the full text.
    const evidence = clauseAround(text, Math.max(0, text.toLowerCase().indexOf(m[0].toLowerCase())));
    const hit: StatusMatch = { value: option, evidence, negative: Boolean(fam?.negative) };
    if (hit.negative) negative = hit;
    else if (!best || index > best.index) best = { index, m: hit };
  });
  if (negative) return negative;
  return best ? (best as { index: number; m: StatusMatch }).m : null;
}

/** True when `option` is a negative terminal status (Cancelled, Lost, Refunded...). */
export const isNegativeStatus = (option: string) => Boolean(familyOf(option)?.negative);
