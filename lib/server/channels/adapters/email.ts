/**
 * Inbound email — pure parsing for the common inbound-parse webhooks:
 *  - Postmark JSON (`From`, `FromFull`, `To`, `Subject`, `TextBody`, `HtmlBody`, `StrippedTextReply`, `MessageID`, `Date`, `Headers`, `Attachments`);
 *  - Mailgun / SendGrid multipart forms (`from`, `to`, `subject`, `text`/`body-plain`/`stripped-text`, `Message-Id`/`headers`, attachment files);
 *  - generic JSON `{ from, to, subject, text, html?, messageId, date, attachments?: [{ name, mime, content(base64) }] }`.
 *
 * Authentication (shared secret via `?key=` or `X-Infera-Token`) is done by the route.
 * Conversation = normalised subject thread (Re:/Fwd: stripped) + sender address.
 * Text = subject + blank line + body without quoted replies / signature (best effort).
 */
import { safeEqual } from "../../crypto";
import type { InboundAttachment, ParsedInbound } from "../types";
import { arr, cleanMime, num, obj, parseTimestamp, sha256, str } from "../util";

export type ParsedEmail = {
  from: { name: string | null; email: string | null };
  to: string | null;
  subject: string;
  text: string;
  html: string | null;
  messageId: string | null;
  date: Date | null;
  headers: Record<string, string>;
  attachments: InboundAttachment[];
};

export function verifyEmailToken(provided: string | null, inboundSecret: string): boolean {
  if (!provided || !inboundSecret) return false;
  return safeEqual(provided, inboundSecret);
}

/** "Rahul Sharma <rahul@x.com>" → { name, email }. */
export function parseAddress(v: string | null | undefined): { name: string | null; email: string | null } {
  if (!v) return { name: null, email: null };
  const first = v.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[0].trim();
  const angle = first.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angle) return { name: angle[1].trim() || null, email: angle[2].trim().toLowerCase() || null };
  const bare = first.match(/[^\s<>"]+@[^\s<>"]+/);
  return { name: null, email: bare ? bare[0].toLowerCase() : null };
}

/** Strips any number of reply/forward prefixes (incl. common non-English ones) and normalises spacing. */
export function normalizeSubject(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const next = s.replace(/^\s*(re|fw|fwd|aw|wg|sv|vs|antw|r|rif|tr|enc|res)\s*(\[\d+\])?\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Minimal HTML → text for HTML-only emails. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Removes quoted history, "On … wrote:" blocks, forwarded/original-message headers and signatures. */
export function stripQuotedReply(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (/^-- ?$/.test(line)) break; // RFC 3676 signature delimiter
    if (/^-{2,}\s*(original message|forwarded message)\s*-{2,}$/i.test(t)) break;
    if (/^_{10,}$/.test(t)) break; // Outlook separator
    if (/^on .{1,200}wrote:$/i.test(t)) break;
    if (/^on .{1,200}$/i.test(t) && /wrote:$/i.test(lines[i + 1]?.trim() ?? "")) break; // wrapped "On … \n wrote:"
    if (/^from: .+/i.test(t) && /^(sent|date|to|subject): /i.test(lines[i + 1]?.trim() ?? "")) break;
    if (/^sent from my (iphone|ipad|android|mobile|samsung|phone)/i.test(t)) break;
    if (/^get outlook for (ios|android)/i.test(t)) break;
    if (t.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function headerMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  // Postmark: [{ Name, Value }]
  for (const h of arr(v)) {
    const name = str(obj(h).Name) ?? str(obj(h).name);
    const value = str(obj(h).Value) ?? str(obj(h).value);
    if (name && value !== null) out[name.toLowerCase()] = value;
  }
  // SendGrid: raw header block "Key: value\r\nKey2: value"
  if (typeof v === "string") {
    for (const line of v.replace(/\r\n[ \t]+/g, " ").split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i > 0) out[line.slice(0, i).trim().toLowerCase()] ??= line.slice(i + 1).trim();
    }
  }
  return out;
}

function base64Bytes(v: unknown): Buffer | null {
  const s = str(v);
  if (!s) return null;
  const clean = s.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=_-]*$/.test(clean)) return null;
  return Buffer.from(clean, /[-_]/.test(clean) ? "base64url" : "base64");
}

/** Postmark / generic JSON payload. */
export function parseEmailJson(payload: unknown): ParsedEmail | null {
  const p = obj(payload);
  const fromFull = obj(p.FromFull);
  const fromStr = str(p.From) ?? str(p.from) ?? str(p.sender);
  const from = str(fromFull.Email) ? { name: str(fromFull.Name) || null, email: str(fromFull.Email)!.toLowerCase() } : parseAddress(fromStr);
  if (!from.email) return null;
  const headers = headerMap(p.Headers ?? p.headers);
  const html = str(p.HtmlBody) ?? str(p.html);
  const stripped = str(p.StrippedTextReply) ?? str(p["stripped-text"]);
  const textBody = str(p.TextBody) ?? str(p.text) ?? str(p["body-plain"]);
  const attachments: InboundAttachment[] = [];
  for (const a of arr(p.Attachments ?? p.attachments)) {
    const at = obj(a);
    const data = base64Bytes(at.Content ?? at.content);
    const name = str(at.Name) ?? str(at.name) ?? str(at.filename) ?? "attachment";
    attachments.push({ name, mime: cleanMime(at.ContentType ?? at.contentType ?? at.mime ?? at.type), size: data?.length ?? num(at.ContentLength ?? at.size), data, url: str(at.url) });
  }
  return {
    from,
    to: str(p.To) ?? str(p.to) ?? str(p.recipient),
    subject: str(p.Subject) ?? str(p.subject) ?? "",
    text: stripped?.trim() ? stripped.trim() : stripQuotedReply(textBody ?? (html ? htmlToText(html) : "")),
    html,
    messageId: str(p.MessageID) ?? str(p.messageId) ?? str(p.message_id) ?? headers["message-id"] ?? null,
    date: parseTimestamp(str(p.Date) ?? str(p.date) ?? headers.date),
    headers,
    attachments,
  };
}

/** Mailgun / SendGrid multipart (or urlencoded) form fields + uploaded files. */
export function parseEmailForm(fields: Record<string, string>, uploads: { name: string; mime: string; data: Buffer }[]): ParsedEmail | null {
  const from = parseAddress(fields.from ?? fields.sender ?? fields.From);
  if (!from.email) return null;
  const headers = headerMap(fields.headers ?? "");
  if (fields["message-headers"]) {
    // Mailgun: JSON array of [name, value] pairs.
    try {
      for (const pair of arr(JSON.parse(fields["message-headers"]))) {
        const [k, v] = arr(pair);
        if (typeof k === "string" && typeof v === "string") headers[k.toLowerCase()] ??= v;
      }
    } catch {
      /* ignore malformed header JSON */
    }
  }
  const html = fields.html ?? fields["body-html"] ?? null;
  const body = fields["stripped-text"]?.trim() ? fields["stripped-text"].trim() : stripQuotedReply(fields.text ?? fields["body-plain"] ?? (html ? htmlToText(html) : ""));
  return {
    from,
    to: fields.to ?? fields.recipient ?? fields.To ?? null,
    subject: fields.subject ?? fields.Subject ?? "",
    text: body,
    html,
    messageId: fields["Message-Id"] ?? fields["message-id"] ?? headers["message-id"] ?? null,
    date: parseTimestamp(fields.Date ?? fields.date ?? headers.date ?? fields.timestamp),
    headers,
    attachments: uploads.map((u) => ({ name: u.name, mime: cleanMime(u.mime), size: u.data.length, data: u.data })),
  };
}

const isAutoReply = (h: Record<string, string>) =>
  (h["auto-submitted"] !== undefined && h["auto-submitted"].toLowerCase() !== "no") || h["x-autoreply"] !== undefined || h["x-autorespond"] !== undefined || /^(auto_reply|junk)$/i.test(h.precedence ?? "");

/**
 * LinkedIn message notifications ("Rahul Sharma sent you a new message", InMail…) arriving in a
 * connected mailbox → a LinkedIn conversation with that person (source "linkedin"), not an email thread.
 * Replies can't go through email — the console says so (see outbound.ts).
 */
export function linkedinNotification(e: ParsedEmail): ParsedInbound | null {
  if (!e.from.email || !/@(e\.)?linkedin\.com$/i.test(e.from.email)) return null;
  const subject = e.subject.trim();
  const m =
    subject.match(/^(.{2,80}?) (?:sent you (?:a )?(?:new )?messages?|just messaged you|messaged you|sent you an InMail|replied to your (?:message|InMail))\b/i) ??
    subject.match(/^(?:new message|you have (?:a )?new messages?|new InMail) from (.{2,80})$/i) ??
    subject.match(/^(?:RE:\s*)?InMail from (.{2,80})$/i);
  if (!m) return null;
  const name = m[1].replace(/["“”]/g, "").trim();
  // The notification body quotes the message, then LinkedIn boilerplate.
  const body = e.text
    .split(/\n\s*(?:View message|Reply|View in LinkedIn|Unsubscribe|This email was intended for|You are receiving)/i)[0]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(?:linkedin|messaging|.{0,80}sent you a new message\.?)$/i.test(l) && l !== name)
    .join("\n")
    .trim();
  const date = e.date ?? new Date();
  return {
    externalId: `li:${e.messageId?.replace(/^<|>$/g, "").trim() || sha256([name, subject, date.toISOString()].join("\u0001"))}`,
    direction: "inbound",
    conversation: { externalId: `linkedin:${name.toLowerCase()}`, title: name, isGroup: false },
    sender: { externalId: `linkedin:${name.toLowerCase()}`, name },
    text: body || subject,
    sentAt: date,
    source: "linkedin",
    raw: { provider: "email", linkedinNotification: true },
  };
}

/** ParsedEmail → normalised inbound message. */
export function emailToInbound(e: ParsedEmail): ParsedInbound {
  const li = linkedinNotification(e);
  if (li) return li;
  const subject = e.subject.trim();
  const thread = normalizeSubject(subject).toLowerCase() || "(no subject)";
  const body = e.text.trim();
  const text = subject ? (body ? `${subject}\n\n${body}` : subject) : body;
  const date = e.date ?? new Date();
  const messageId = e.messageId?.replace(/^<|>$/g, "").trim() || `sha:${sha256([e.from.email, subject, date.toISOString(), body].join("\u0001"))}`;
  return {
    externalId: messageId,
    direction: "inbound",
    conversation: { externalId: `${e.from.email}|${thread}`, title: normalizeSubject(subject) || e.from.name || e.from.email, isGroup: false },
    sender: { externalId: e.from.email, name: e.from.name, email: e.from.email },
    text,
    attachments: e.attachments,
    sentAt: date,
    replyToExternalId: e.headers["in-reply-to"]?.replace(/^<|>$/g, "").trim() || null,
    // Bounces / out-of-office replies are stored but not processed (rule 18).
    skipProcessing: isAutoReply(e.headers),
    raw: {
      provider: "email",
      to: e.to,
      messageId: e.messageId,
      autoReply: isAutoReply(e.headers),
      attachments: e.attachments.map((a) => ({ name: a.name, mime: a.mime, size: a.size ?? null })),
    },
  };
}
