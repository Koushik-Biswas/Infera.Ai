/**
 * Formatting helpers and human labels for the console. Pure functions only —
 * safe in server and client components.
 */
import type { ApiScope, Category, ChannelType, ConnectorState, DomainEventType, EventStatus, Priority, Role, Source, ValueSource } from "@/lib/shared/types";

/* ------------------------------ Numbers ----------------------------- */

/**
 * Format a count: `1284` → "1,284". With `compact`, values ≥ 10,000 become "12.9K".
 * `null`/`undefined`/NaN render as an em dash.
 */
export function formatNumber(n: number | null | undefined, opts: { compact?: boolean; digits?: number } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (opts.compact && Math.abs(n) >= 10_000) return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  return new Intl.NumberFormat("en", { maximumFractionDigits: opts.digits ?? 0 }).format(n);
}

/** Format a 0..1 fraction as a percentage: `0.256` → "26%" (or "25.6%" with `digits = 1`). */
export function formatPercent(fraction: number | null | undefined, digits = 0): string {
  if (fraction == null || !Number.isFinite(fraction)) return "—";
  return new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(fraction);
}

/** Format a duration in milliseconds: 840 → "840 ms", 2300 → "2.3 s", 125000 → "2 min". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** Format a byte count: 2048 → "2 KB". */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------- Dates ------------------------------ */

function toDate(d: string | number | Date): Date {
  if (d instanceof Date) return d;
  if (typeof d === "string" && d.length === 10) return new Date(`${d}T12:00:00`);
  return new Date(d);
}

/** "19 Nov, 14:05" (year added when not the current year). Invalid input is returned verbatim. */
export function formatDateTime(d: string | number | Date | null | undefined): string {
  if (d == null) return "—";
  const date = toDate(d);
  if (Number.isNaN(date.getTime())) return String(d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric", hour: "numeric", minute: "2-digit" });
}

/** "19 Nov" (year added when not the current year). */
export function formatDate(d: string | number | Date | null | undefined): string {
  if (d == null) return "—";
  const date = toDate(d);
  if (Number.isNaN(date.getTime())) return String(d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
}

/**
 * Relative time against `now`: "just now", "5m ago", "3h ago", "2d ago", "in 6d";
 * older than 30 days falls back to a short date.
 */
export function relativeTime(d: string | number | Date, now: number = Date.now()): string {
  const t = toDate(d).getTime();
  if (Number.isNaN(t)) return String(d);
  const diff = now - t;
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  if (s < 45) return future ? "in a moment" : "just now";
  const [v, unit] = s < 3600 ? [Math.round(s / 60), "m"] : s < 86_400 ? [Math.round(s / 3600), "h"] : s < 86_400 * 30 ? [Math.round(s / 86_400), "d"] : [0, ""];
  if (!unit) return formatDate(t);
  return future ? `in ${v}${unit}` : `${v}${unit} ago`;
}

/* ------------------------------- Labels ----------------------------- */

/** "sales_enquiry" → "Sales enquiry". */
export function humanize(s: string): string {
  const t = s.replace(/[_.-]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : s;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  sales_enquiry: "Sales enquiry",
  order: "Order",
  payment: "Payment",
  support: "Support",
  follow_up: "Follow-up",
  appointment: "Appointment",
  contact_share: "Contact shared",
  document_share: "Document shared",
  feedback: "Feedback",
  spam: "Spam",
  general: "General",
};

/** Human label for a message category (unknown values are humanized). */
export const categoryLabel = (c: string): string => CATEGORY_LABELS[c as Category] ?? humanize(c);

const INTENT_LABELS: Record<string, string> = {
  purchase_interest: "Purchase interest",
  price_request: "Price request",
  availability_check: "Availability check",
  place_order: "Place order",
  modify_order: "Modify order",
  cancel_order: "Cancel order",
  order_status: "Order status",
  payment_confirmation: "Payment confirmation",
  payment_promise: "Payment promise",
  payment_request: "Payment request",
  refund_request: "Refund request",
  complaint: "Complaint",
  question: "Question",
  task_request: "Task request",
  task_done: "Task done",
  schedule_meeting: "Schedule meeting",
  share_contact: "Shared contact",
  share_document: "Shared document",
  share_link: "Shared link",
  feedback: "Feedback",
  greeting: "Greeting",
  acknowledgement: "Acknowledgement",
  spam: "Spam",
  unknown: "Unknown",
};

/** Human label for a classifier intent. The classifier may return intents outside the list — they are humanized. */
export const intentLabel = (i: string): string => INTENT_LABELS[i] ?? humanize(i);

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  whatsapp_cloud: "WhatsApp Business",
  whatsapp_web: "WhatsApp (linked device)",
  telegram: "Telegram bot",
  telegram_user: "Telegram account",
  email: "Email (forwarding)",
  email_imap: "Email mailbox",
  slack: "Slack",
  sms_twilio: "SMS (Twilio)",
  instagram: "Instagram",
  messenger: "Messenger",
  linkedin: "LinkedIn",
  api: "API",
  whatsapp_export: "WhatsApp import",
};

/** Human label for a channel type. */
export const channelLabel = (t: string): string => CHANNEL_LABELS[t as ChannelType] ?? humanize(t);

export const SOURCE_LABELS: Record<Source, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  email: "Email",
  slack: "Slack",
  sms: "SMS",
  instagram: "Instagram",
  messenger: "Messenger",
  linkedin: "LinkedIn",
  api: "API",
};

/** Human label for a processing-result source ("whatsapp" → "WhatsApp"). */
export const sourceLabel = (s: string): string => SOURCE_LABELS[s as Source] ?? humanize(s);

/** Representative channel type for a source (for icons). */
export const SOURCE_CHANNEL: Record<Source, ChannelType> = {
  whatsapp: "whatsapp_cloud",
  telegram: "telegram",
  email: "email",
  slack: "slack",
  sms: "sms_twilio",
  instagram: "instagram",
  messenger: "messenger",
  linkedin: "linkedin",
  api: "api",
};

export const VALUE_SOURCE_LABELS: Record<ValueSource, string> = {
  extracted: "Extracted",
  ai_suggested: "AI suggestion",
  manual: "Manual",
  automation: "Automation",
  api: "API",
  import: "Import",
};

export const PRIORITY_LABELS: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

export const ROLE_LABELS: Record<Role, string> = { viewer: "Viewer", member: "Member", admin: "Admin", owner: "Owner" };

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: "Can read conversations, records and analytics.",
  member: "Can also edit records, resolve reviews, create collections and reply.",
  admin: "Can also manage channels, automations, API keys, webhooks, members and settings.",
  owner: "Full control, including deleting the workspace.",
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  processed: "Processed",
  needs_review: "Needs review",
  skipped: "Skipped",
  duplicate: "Duplicate",
  failed: "Failed",
};

export const CONNECTOR_STATE_LABELS: Record<ConnectorState, string> = {
  disconnected: "Disconnected",
  pairing: "Waiting for pairing",
  connecting: "Connecting",
  connected: "Connected",
  syncing: "Syncing",
  error: "Error",
  logged_out: "Logged out",
};

export const SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  ingest: "Send messages into Infera (POST /api/v1/events).",
  read: "Read records, conversations, messages, search and analytics.",
  write: "Create and edit records, resolve reviews and reply.",
  delete: "Delete records.",
};

export const DOMAIN_EVENT_DESCRIPTIONS: Record<DomainEventType, string> = {
  "message.received": "A new message arrived on any channel.",
  "message.processed": "A message was classified and processed.",
  "record.created": "A record was created in a collection.",
  "record.updated": "A record's values changed.",
  "record.status_changed": "A record moved to a new status.",
  "record.deleted": "A record was deleted.",
  "review.created": "Something needs human review.",
  "review.resolved": "A review item was approved or rejected.",
};
