/**
 * Step 3 — deterministic classifier (runs before any AI, rule 18).
 *
 * Keyword/regex rules over English and common Hinglish / Indian business
 * phrasing ("kitna", "available hai", "bhej do", "payment kar diya",
 * "delivered nahi hua"...). Returns a category, intent, priority and a
 * confidence the pipeline uses to decide whether AI is needed (assist mode)
 * and whether chit-chat/spam can be skipped early.
 */
import type { Category, Intent, MessageKind, Priority } from "@/lib/shared/types";
import { findPhones, findUrls } from "@/lib/app/extract";
import { amountIn, itemIn } from "./extract";
import {
  ANGRY,
  APPOINTMENT,
  AVAILABILITY,
  BUY_VERB,
  CANCEL,
  COMPLAINT_STRONG,
  COMPLAINT_WEAK,
  CONTACT_SHARE,
  DELIVERED,
  DELIVERY_ISSUE,
  DONE_REPLY,
  IN_PROGRESS,
  INTEREST,
  LEGAL,
  MODIFY_ORDER,
  NO_PROBLEM,
  NOT_PAID,
  ORDER_STATUS_Q,
  PACKED,
  PAY_REQUEST,
  PAYMENT_ISSUE,
  PENDING_PAY,
  POSITIVE_FEEDBACK,
  PRICE,
  PROPOSAL,
  REFUND_DONE,
  REFUND_REQUEST,
  REQUEST,
  REQUEST_HINGLISH,
  RESOLVED,
  SHIPPED,
  SPAM_STRONG,
  SPAM_WEAK,
  STRONG_ORDER,
  URGENT,
  WEAK_ORDER,
  isAckOnly,
  isGreetingOnly,
  paidMatch,
  payMethod,
  type Direction,
} from "./vocab";

export type RulesClassification = {
  category: Category;
  intent: Intent;
  priority: Priority;
  /** 0..1 — how sure the rules are. */
  confidence: number;
  /** Which rules fired (for debugging / processing_metadata). */
  signals: string[];
};

export type ClassifyInput = {
  text: string;
  kind: MessageKind;
  direction: Direction;
  attachments: { name: string; mime: string }[];
};

const MEDIA_KINDS: MessageKind[] = ["image", "video", "audio", "document", "sticker"];
const QUESTION_START = /^(what|which|when|where|why|how|is|are|do|does|did|can|could|will|would|should|kya|kab|kitna|kitne|kaun|kaise|kahan)\b/i;
const OUTBOUND_ORDER_UPDATE = /\border (?:is |has been )?(?:confirmed|placed|booked|ready)\b|\b(?:your|the) order\b[^.?!\n]{0,30}\b(?:confirmed|ready)\b/i;
const PAYMENT_MEDIA_CAPTION = /\b(pay|paid|upi|gpay|phonepe|paytm|receipt|screenshot|transaction|txn|utr)\b/i;

function countMatches(text: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const seen = new Set<string>();
  for (const m of text.matchAll(g)) seen.add(m[0].toLowerCase());
  return seen.size;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function classifyRules(input: ClassifyInput): RulesClassification {
  const text = input.text.trim();
  const dir = input.direction;
  const hasMedia = input.attachments.length > 0 || MEDIA_KINDS.includes(input.kind);
  const signals: string[] = [];

  const result = (category: Category, intent: Intent, confidence: number, priority: Priority, signal: string): RulesClassification => {
    signals.push(signal);
    return { category, intent, priority: escalate(priority, category, intent, text, signals), confidence: round(confidence), signals };
  };

  if (input.kind === "contact") return result("contact_share", "share_contact", 0.95, "low", "kind_contact");
  if (input.kind === "location" && !text) return result("general", "share_location", 0.7, "low", "kind_location");

  if (dir === "outbound") {
    const out = classifyOutbound(text, result);
    if (out) return out;
    const generic = classifyInbound(text, hasMedia, result, false);
    // Statements by the business are context, not customer intent: be less sure.
    return { ...generic, confidence: round(generic.confidence * 0.85) };
  }
  return classifyInbound(text, hasMedia, result, true);
}

type Result = (category: Category, intent: Intent, confidence: number, priority: Priority, signal: string) => RulesClassification;

/** Messages sent by the business: they move existing records forward. */
function classifyOutbound(text: string, result: Result): RulesClassification | null {
  if (!text) return null;
  if (isGreetingOnly(text)) return result("general", "greeting", 0.95, "low", "greeting");
  if (isAckOnly(text)) return result("general", "acknowledgement", 0.95, "low", "acknowledgement");
  if (paidMatch(text)) return result("payment", "payment_confirmation", 0.9, "medium", "out_payment_received");
  if (REFUND_DONE.test(text)) return result("payment", "refund_processed", 0.85, "medium", "out_refund_done");
  if (PAY_REQUEST.test(text) || PENDING_PAY.test(text) || NOT_PAID.test(text)) return result("payment", "payment_request", 0.85, "medium", "out_payment_request");
  if (SHIPPED.test(text) || PACKED.test(text) || (DELIVERED.test(text) && !DELIVERY_ISSUE.test(text)) || OUTBOUND_ORDER_UPDATE.test(text))
    return result("order", "order_status", 0.88, "medium", "out_fulfilment");
  if (RESOLVED.test(text)) return result("support", "issue_resolved", 0.85, "medium", "out_resolved");
  if (IN_PROGRESS.test(text)) return result("support", "issue_update", 0.8, "medium", "out_in_progress");
  if (PROPOSAL.test(text) && amountIn(text) !== null) return result("sales_enquiry", "quote_sent", 0.8, "medium", "out_quote");
  if (DONE_REPLY.test(text) && text.split(/\s+/).length <= 12) return result("follow_up", "task_done", 0.8, "low", "out_done");
  return null;
}

function classifyInbound(raw: string, hasMedia: boolean, result: Result, inbound: boolean): RulesClassification {
  const urls = raw ? findUrls(raw) : [];

  if (inbound && raw) {
    const strongSpam = countMatches(raw, SPAM_STRONG);
    const weakSpam = countMatches(raw, SPAM_WEAK);
    if (strongSpam && (strongSpam + weakSpam >= 2 || urls.length)) return result("spam", "spam", 0.95, "low", "spam_strong_multi");
    if (strongSpam) return result("spam", "spam", 0.88, "low", "spam_strong");
    if (weakSpam >= 2 && urls.length) return result("spam", "spam", 0.86, "low", "spam_weak_multi");
  }

  // Words inside links ("…/catalog.pdf") say nothing about intent.
  const text = urls.reduce((s, u) => s.split(u).join(" "), raw).trim();

  if (!hasMedia && !urls.length) {
    if (isGreetingOnly(text)) return result("general", "greeting", 0.95, "low", "greeting");
    if (isAckOnly(text)) return result("general", "acknowledgement", 0.95, "low", "acknowledgement");
  }

  if (PAYMENT_ISSUE.test(text)) return result("support", "complaint", 0.88, "high", "payment_issue");
  if (REFUND_REQUEST.test(text) && !REFUND_DONE.test(text)) return result("support", "refund_request", 0.88, "high", "refund_request");
  if (DELIVERY_ISSUE.test(text)) return result("support", "complaint", 0.88, "high", "delivery_issue");
  if (COMPLAINT_STRONG.test(text) && !NO_PROBLEM.test(text) && !RESOLVED.test(text)) return result("support", "complaint", 0.9, "high", "complaint");

  const method = payMethod(text);
  const amount = text ? (amountIn(text)?.value ?? null) : null;
  if (paidMatch(text)) return result("payment", "payment_confirmation", amount !== null || method || /\d/.test(text) ? 0.94 : 0.9, "medium", "paid");
  if (REFUND_DONE.test(text)) return result("payment", "refund_processed", 0.85, "medium", "refund_done");
  if (PENDING_PAY.test(text) || NOT_PAID.test(text)) return result("payment", "payment_promise", 0.86, "medium", "payment_pending");
  if (hasMedia && PAYMENT_MEDIA_CAPTION.test(text)) return result("payment", "payment_confirmation", 0.75, "medium", "payment_media");

  if (CANCEL.test(text) && /\b(order|it|them|booking|cancel)\b/i.test(text)) return result("order", "cancel_order", /\?\s*$/.test(text) ? 0.8 : 0.88, "high", "cancel");
  if (ORDER_STATUS_Q.test(text)) return result("order", "order_status", 0.86, "medium", "order_status");
  if (MODIFY_ORDER.test(text)) return result("order", "modify_order", 0.8, "medium", "modify_order");
  if (DELIVERED.test(text) && !DELIVERY_ISSUE.test(text) && !/\?\s*$/.test(text)) return result("order", "order_status", 0.8, "medium", "delivery_confirmed");

  const item = text ? itemIn(text) : null;
  const question = /\?/.test(text) || QUESTION_START.test(text);
  const price = PRICE.test(text);
  const availability = AVAILABILITY.test(text);
  const interest = INTEREST.test(text);
  const enquiry = price || availability || interest;

  if (STRONG_ORDER.test(text)) return result("order", "place_order", item ? 0.92 : 0.88, "high", "order_strong");
  if (WEAK_ORDER.test(text) && (item || amount !== null) && !(enquiry && question)) return result("order", "place_order", 0.85, "high", "order_weak");

  if (enquiry) {
    const buying = BUY_VERB.test(text);
    const intent: Intent = interest && (buying || item) ? "purchase_interest" : price ? "price_request" : availability ? "availability_check" : "purchase_interest";
    const strength = [price, availability, interest, Boolean(item)].filter(Boolean).length;
    const hot = (buying && (Boolean(item?.qty) || amount !== null)) || (interest && amount !== null);
    return result("sales_enquiry", intent, strength >= 2 ? 0.9 : 0.82, hot ? "high" : "medium", "enquiry");
  }

  if (COMPLAINT_WEAK.test(text) && !NO_PROBLEM.test(text) && !RESOLVED.test(text)) return result("support", "complaint", 0.72, "high", "complaint_weak");
  if (RESOLVED.test(text)) return result("support", "issue_resolved", 0.75, "medium", "resolved");
  if (APPOINTMENT.test(text)) return result("appointment", "schedule_meeting", 0.85, "medium", "appointment");
  if (REQUEST.test(text) || REQUEST_HINGLISH.test(text)) return result("follow_up", "task_request", 0.82, "medium", "request");
  if (PAY_REQUEST.test(text)) return result("general", "question", 0.7, "medium", "payment_details_request");
  if (CONTACT_SHARE.test(text) || (findPhones(text).length > 0 && /\b(number|contact|no\.?|mobile|phone)\b/i.test(text)))
    return result("contact_share", "share_contact", 0.85, "low", "contact_share");
  if (urls.length) return result("document_share", "share_link", 0.8, "low", "link");
  if (hasMedia) return result("document_share", "share_document", 0.85, "low", "media");
  if (POSITIVE_FEEDBACK.test(text)) return result("feedback", "feedback", 0.85, "low", "feedback");
  if (inbound && SPAM_WEAK.test(text)) return result("spam", "spam", 0.7, "low", "spam_weak");
  if (question) return result("general", "question", 0.55, "medium", "question");
  return result("general", "unknown", 0.45, "low", "fallback");
}

/** Urgency overrides: explicit urgency, legal threats, angry complaints/refunds. */
function escalate(priority: Priority, category: Category, intent: Intent, text: string, signals: string[]): Priority {
  if (category === "spam" || intent === "greeting" || intent === "acknowledgement") return priority;
  if (URGENT.test(text)) {
    signals.push("urgent");
    return "urgent";
  }
  if (LEGAL.test(text)) {
    signals.push("legal_threat");
    return "urgent";
  }
  if ((category === "support" || intent === "refund_request") && ANGRY.test(text)) {
    signals.push("angry");
    return "urgent";
  }
  return priority;
}
