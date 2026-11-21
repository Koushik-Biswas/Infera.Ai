/**
 * Mailbox sync (Gmail, Outlook or any IMAP server) via imapflow + nodemailer.
 *
 * Auth: "Sign in with Google" (OAuth refresh token in the encrypted auth blob, XOAUTH2)
 * or an app password (secrets.password). Sync: recent mail from Inbox and Sent
 * (config.historyDays, default 30) is imported once, then new Inbox mail arrives live
 * through IMAP IDLE. Replies go out over SMTP in the same thread (In-Reply-To/References).
 * LinkedIn message notifications become LinkedIn conversations (adapters/email.ts).
 *
 * Config: address, provider ("gmail" | "outlook" | "custom"), imapHost/imapPort, smtpHost/smtpPort, historyDays.
 */
import type { ImapFlow as ImapFlowT, FetchMessageObject } from "imapflow";
import type { ConnectorFactory } from "../types";
import type { ParsedInbound } from "../../channels/types";
import { emailToInbound, htmlToText, stripQuotedReply, type ParsedEmail } from "../../channels/adapters/email";
import { cleanMime } from "../../channels/util";
import { maxMediaBytes } from "../../env";
import { registerLiveSender } from "../live";
import { googleAccessToken, type GoogleAuth } from "../google-oauth";

const PRESETS: Record<string, { imap: [string, number]; smtp: [string, number] }> = {
  gmail: { imap: ["imap.gmail.com", 993], smtp: ["smtp.gmail.com", 465] },
  outlook: { imap: ["outlook.office365.com", 993], smtp: ["smtp.office365.com", 587] },
};
const MAX_HISTORY = 1000;

type Auth = { user: string; pass?: string; accessToken?: string };

export function mailServers(cfg: Record<string, unknown>) {
  const preset = PRESETS[String(cfg.provider ?? "")] ?? null;
  const imapHost = typeof cfg.imapHost === "string" && cfg.imapHost ? cfg.imapHost : preset?.imap[0];
  const smtpHost = typeof cfg.smtpHost === "string" && cfg.smtpHost ? cfg.smtpHost : preset?.smtp[0];
  return {
    imap: imapHost ? { host: imapHost, port: Number(cfg.imapPort ?? preset?.imap[1] ?? 993) } : null,
    smtp: smtpHost ? { host: smtpHost, port: Number(cfg.smtpPort ?? preset?.smtp[1] ?? 465) } : null,
  };
}

/** mailparser output → ParsedEmail (shared with the inbound-parse webhook adapter). */
async function parseRaw(source: Buffer): Promise<{ email: ParsedEmail; to: string | null; references: string[] }> {
  const { simpleParser } = await import("mailparser");
  const m = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const from = m.from?.value?.[0];
  const toList = (Array.isArray(m.to) ? m.to : m.to ? [m.to] : []).flatMap((a) => a.value);
  const headers: Record<string, string> = {};
  for (const [k, v] of m.headers) headers[k.toLowerCase()] = typeof v === "string" ? v : Array.isArray(v) ? v.join(", ") : String((v as { value?: unknown })?.value ?? v ?? "");
  const text = m.text ?? (m.html ? htmlToText(m.html) : "");
  const cap = maxMediaBytes();
  return {
    email: {
      from: { name: from?.name || null, email: from?.address?.toLowerCase() ?? null },
      to: toList[0]?.address?.toLowerCase() ?? null,
      subject: m.subject ?? "",
      text: stripQuotedReply(text),
      html: null,
      messageId: m.messageId ?? null,
      date: m.date ?? null,
      headers,
      attachments: m.attachments
        .filter((a) => a.contentDisposition !== "inline" || !a.contentType.startsWith("image/"))
        .slice(0, 10)
        .map((a) => ({ name: a.filename ?? "attachment", mime: cleanMime(a.contentType), size: a.size, data: a.size <= cap ? a.content : null })),
    },
    to: toList[0]?.address?.toLowerCase() ?? null,
    references: (Array.isArray(m.references) ? m.references : m.references ? [m.references] : []).slice(-10),
  };
}

export const createConnector: ConnectorFactory = async (ctx) => {
  const cfg = ctx.channel.config ?? {};
  const address = String(cfg.address ?? "").toLowerCase();
  const servers = mailServers(cfg);
  const historyDays = Math.min(365, Math.max(0, Number(cfg.historyDays ?? 30) || 0));
  const google = await ctx.getAuth<GoogleAuth>();

  const auth = async (): Promise<Auth> => {
    if (google?.provider === "google") return { user: google.email, accessToken: await googleAccessToken(google) };
    if (!ctx.secrets.password) throw new Error("No mailbox credentials: sign in with Google or add an app password.");
    return { user: String(cfg.username ?? address), pass: ctx.secrets.password };
  };
  if (!servers.imap) {
    throw new Error("Set the IMAP server (or choose Gmail / Outlook).");
  }

  const { ImapFlow } = await import("imapflow");
  let stopped = false;
  let client: ImapFlowT | null = null;
  let unregister: (() => void) | null = null;
  let work: Promise<unknown> = Promise.resolve();
  const queue = (fn: () => Promise<unknown>) => (work = work.then(fn).catch((e) => ctx.log("warn", "mail_task_failed", { message: e instanceof Error ? e.message.slice(0, 160) : "unknown" })));

  const me = () => (google?.email ?? address).toLowerCase();

  /** One IMAP message → Infera message (outbound when sent by the mailbox owner). */
  const toInbound = async (msg: FetchMessageObject, historical: boolean): Promise<ParsedInbound | null> => {
    if (!msg.source) return null;
    const { email, to, references } = await parseRaw(msg.source);
    const p = emailToInbound(email);
    const mine = email.from.email === me();
    if (mine && p.source !== "linkedin") {
      if (!to) return null;
      const thread = p.conversation.externalId.split("|").slice(1).join("|");
      p.direction = "outbound";
      p.conversation = { ...p.conversation, externalId: `${to}|${thread}` };
      p.sender = { isMe: true, name: "You", email: email.from.email };
    }
    p.historical = historical;
    p.raw = { ...(p.raw as Record<string, unknown>), uid: msg.uid, references };
    return p;
  };

  const fetchSince = async (path: string, since: Date, max: number) => {
    const c = client!;
    const lock = await c.getMailboxLock(path);
    try {
      const uids = (await c.search({ since }, { uid: true })) || [];
      const picked = uids.slice(-max);
      const out: ParsedInbound[] = [];
      if (!picked.length) return { out, lastUid: 0, uidValidity: String(c.mailbox && typeof c.mailbox === "object" ? c.mailbox.uidValidity : "") };
      for await (const m of c.fetch(picked.join(","), { uid: true, source: true }, { uid: true })) {
        if (stopped) break;
        const p = await toInbound(m, true).catch(() => null);
        if (p) out.push(p);
      }
      return { out, lastUid: picked.length ? Math.max(...picked) : 0, uidValidity: String(c.mailbox && typeof c.mailbox === "object" ? c.mailbox.uidValidity : "") };
    } finally {
      lock.release();
    }
  };

  const importHistory = async () => {
    const cursor = await ctx.getCursor();
    if (cursor.historyDoneAt || historyDays === 0) return;
    const startedAt = new Date().toISOString();
    await ctx.update({ state: "syncing", progress: { phase: "history", total: null, done: 0, startedAt, finishedAt: null, message: "Importing recent email…" } });
    const since = new Date(Date.now() - historyDays * 86_400_000);
    const inbox = await fetchSince("INBOX", since, MAX_HISTORY);
    let sent: ParsedInbound[] = [];
    try {
      const boxes = await client!.list();
      const sentBox = boxes.find((b) => b.specialUse === "\\Sent")?.path;
      if (sentBox) sent = (await fetchSince(sentBox, since, MAX_HISTORY / 2)).out;
    } catch {
      /* no Sent folder access */
    }
    const all = [...inbox.out, ...sent].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    const r = await ctx.ingestMany(all, { historical: true, progress: { total: all.length } });
    const finishedAt = new Date().toISOString();
    await ctx.setCursor({ historyDoneAt: finishedAt, inboxUid: Math.max(Number(cursor.inboxUid ?? 0), inbox.lastUid), uidValidity: inbox.uidValidity });
    await ctx.update({ state: "connected", lastSyncAt: new Date(), progress: { phase: "done", total: r.imported, done: r.imported, startedAt, finishedAt, message: `Imported ${r.imported} recent emails.` } });
  };

  /** New Inbox mail (UIDs above the last seen one). */
  const pullNew = async () => {
    const c = client;
    if (!c || stopped) return;
    const cursor = await ctx.getCursor();
    const box = c.mailbox && typeof c.mailbox === "object" ? c.mailbox : null;
    let from = Number(cursor.inboxUid ?? 0);
    if (box && cursor.uidValidity && String(box.uidValidity) !== String(cursor.uidValidity)) from = 0; // mailbox was rebuilt
    if (!from && box) from = Math.max(0, Number(box.uidNext ?? 1) - 1);
    let last = from;
    for await (const m of c.fetch(`${from + 1}:*`, { uid: true, source: true }, { uid: true })) {
      if (stopped || m.uid <= from) continue;
      last = Math.max(last, m.uid);
      const p = await toInbound(m, false).catch(() => null);
      if (p) await ctx.ingest(p);
    }
    if (last !== from || !cursor.inboxUid) await ctx.setCursor({ inboxUid: last, uidValidity: box ? String(box.uidValidity) : null });
    await ctx.update({ lastSyncAt: new Date() });
  };

  const connect = async () => {
    await ctx.update({ state: "connecting", lastError: null });
    const a = await auth();
    const c = new ImapFlow({ host: servers.imap!.host, port: servers.imap!.port, secure: true, auth: a, logger: false, emitLogs: false });
    client = c;
    c.on("error", (e: Error) => ctx.log("warn", "imap_error", { message: e.message.slice(0, 160) }));
    c.on("close", () => {
      if (!stopped) ctx.fail(new Error("The mailbox connection closed."));
    });
    try {
      await c.connect();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const authFail = /auth|credentials|invalid|login/i.test(msg) || (e as { authenticationFailed?: boolean }).authenticationFailed;
      throw new Error(authFail ? "The mailbox rejected the sign-in. For Gmail use “Sign in with Google” or an app password (Google Account → Security → App passwords)." : `Could not connect to ${servers.imap!.host}: ${msg.slice(0, 160)}`);
    }
    await ctx.update({ state: "connected", account: { email: a.user } });
    await importHistory();
    await c.mailboxOpen("INBOX");
    await pullNew();
    // imapflow IDLEs automatically on the open mailbox; "exists" fires when new mail lands.
    c.on("exists", () => void queue(pullNew));
  };

  // SMTP replies through the same account.
  unregister = registerLiveSender(ctx.channel.id, {
    sendText: async (to, text, opts) => {
      if (!servers.smtp) throw new Error("No SMTP server configured for replies.");
      const a = await auth();
      const nodemailer = await import("nodemailer");
      const t = nodemailer.createTransport({
        host: servers.smtp.host,
        port: servers.smtp.port,
        secure: servers.smtp.port === 465,
        auth: a.accessToken ? { type: "OAuth2", user: a.user, accessToken: a.accessToken } : { user: a.user, pass: a.pass },
      });
      const info = await t.sendMail({ from: a.user, to, subject: opts?.subject ?? "", text, ...(opts?.inReplyTo ? { inReplyTo: opts.inReplyTo, references: [...(opts.references ?? []), opts.inReplyTo] } : {}) });
      return { providerMessageId: String(info.messageId ?? "").replace(/^<|>$/g, "") || null };
    },
  });

  void queue(() =>
    connect().catch(async (e) => {
      if (stopped) return;
      await ctx.update({ state: "error", lastError: e instanceof Error ? e.message : String(e) }).catch(() => {});
      ctx.fail(e);
    }),
  );

  return {
    async stop() {
      stopped = true;
      unregister?.();
      const c = client;
      client = null;
      await Promise.race([c?.logout().catch(() => c?.close()), new Promise((r) => setTimeout(r, 5000))]);
    },
    async command(cmd) {
      if (cmd === "resync") {
        await ctx.setCursor({ historyDoneAt: null });
        void queue(async () => {
          if (!client) return;
          await importHistory();
          await client.mailboxOpen("INBOX");
        });
      }
      if (cmd === "logout") {
        stopped = true;
        await ctx.setAuth(null);
      }
    },
  };
};

