/**
 * Telegram personal account (official MTProto API via teleproto).
 *
 * Login (the person connecting never sees API credentials):
 *  - QR code (default): scanned in Telegram → Settings → Devices → Link Desktop Device. The code
 *    refreshes about every 30 s; teleproto handles the data-centre migration after the scan.
 *  - Phone number (fallback, "phone_login" command): Telegram sends a login code ("code" command).
 *  - Two-step verification password when the account has one ("password" command).
 *  What the flow waits for is published as `prompt` on the connection (lib/shared/types.ts).
 *  Command args (password, code, phone) arrive sealed and are opened only here.
 *
 * The session string is stored in the encrypted auth blob (connector_sessions.auth_enc via
 * ctx.setAuth), so any instance that takes over the lease resumes it. Never log it.
 *
 * Sync: recent private chats and groups (config.historyDays, default 30) are
 * imported once after login, then every new message arrives live. Broadcast
 * channels are skipped. Replies are sent through the live session.
 *
 * Credentials: ONLY the server's TELEGRAM_API_ID / TELEGRAM_API_HASH (my.telegram.org/apps).
 * Per-channel api_id / api_hash stored by older versions are ignored.
 */
import type { Api as ApiNs, TelegramClient as TC } from "teleproto";
import type { ConnectorFactory } from "../types";
import type { InboundAttachment, ParsedInbound } from "../../channels/types";
import { maxMediaBytes, telegramApiCredentials } from "../../env";
import { registerLiveSender } from "../live";
import { openText } from "../../data/sealed";
import { CODE_EXPIRED, TELEGRAM_CREDENTIALS_MISSING, WRONG_CODE, WRONG_PASSWORD, codeVia, describeLoginError, maskPhone, promptStamp, rpcCode } from "../telegram-login";

type StoredAuth = { v: 1; session: string };
type TP = typeof import("teleproto");
type LoginMode = { kind: "qr" } | { kind: "phone"; phone: string };

const cfgNum = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

/** Server credentials (env only). Kept as an export for callers/tests. */
export const telegramCredentials = () => telegramApiCredentials();

/** Interrupts a pending login step. teleproto rethrows errors whose message is AUTH_USER_CANCEL. */
class LoginInterrupted extends Error {
  constructor() {
    super("AUTH_USER_CANCEL");
    this.name = "LoginInterrupted";
  }
}

/** Resolves after `ms`, or early when `signal` aborts. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

export const createConnector: ConnectorFactory = async (ctx) => {
  const creds = telegramApiCredentials();
  if (!creds) {
    // The manager records the thrown message as the channel's error: make it readable for the admin.
    throw new Error(TELEGRAM_CREDENTIALS_MISSING);
  }
  const tp: TP = await import("teleproto");
  const { TelegramClient, sessions, events, utils, Api } = tp;
  const historyDays = cfgNum(ctx.channel.config?.historyDays, 30, 0, 365);
  const ignoreGroups = ctx.channel.config?.ignoreGroups === true;
  const downloadMedia = ctx.channel.config?.downloadMedia !== false;

  const stored = await ctx.getAuth<StoredAuth>();
  const session = new sessions.StringSession(stored?.v === 1 ? stored.session : "");
  const client: TC = new TelegramClient(session, creds.apiId, creds.apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
    deviceModel: "Infera",
    systemVersion: "Server",
    appVersion: "1.0",
    baseLogger: new tp.Logger("none" as never),
  });

  let stopped = false;
  let loggedIn = false;
  let unregister: (() => void) | null = null;
  const names = new Map<string, string>();

  /* ------------------------- Login state ------------------------- */

  /** Next login method; switched by the "phone_login" / "connect" commands. */
  let mode: LoginMode = { kind: "qr" };
  /** The running login attempt; aborting it restarts the loop with the current `mode`. */
  let attempt = new AbortController();
  const waiters = new Map<"password" | "code", { resolve: (v: string) => void; reject: (e: Error) => void }>();
  /** Message to show with the next prompt (wrong password / code). */
  let promptError: string | null = null;
  /** Error Telegram returned when teleproto stopped the flow through onError (it rethrows a generic error). */
  let loginError: unknown = null;
  /** Shown once on the next QR code (e.g. why the phone login was abandoned). */
  let notice: string | null = null;

  const waitFor = (kind: "password" | "code") =>
    new Promise<string>((resolve, reject) => {
      waiters.get(kind)?.reject(new LoginInterrupted());
      const signal = attempt.signal;
      if (signal.aborted || stopped) return reject(new LoginInterrupted());
      waiters.set(kind, { resolve, reject });
      signal.addEventListener("abort", () => reject(new LoginInterrupted()), { once: true });
    });
  const answer = (kind: "password" | "code", value: string) => {
    const w = waiters.get(kind);
    waiters.delete(kind);
    w?.resolve(value);
  };
  /** Stop the current attempt (mode switch / stop); pending prompts are cancelled. */
  const interrupt = () => {
    attempt.abort();
    for (const w of waiters.values()) w.reject(new LoginInterrupted());
    waiters.clear();
  };

  const saveSession = async () => {
    const s = (client.session as InstanceType<typeof sessions.StringSession>).save();
    if (s) await ctx.setAuth({ v: 1, session: s } satisfies StoredAuth);
  };

  /* --------------------------- Conversion --------------------------- */

  const chatIdOf = (m: ApiNs.Message) => utils.getPeerId(m.peerId);
  const isBroadcast = (m: ApiNs.Message) => m.peerId instanceof Api.PeerChannel && (m as unknown as { post?: boolean }).post === true;

  const titleFor = async (chatId: string, m: ApiNs.Message): Promise<string | null> => {
    const known = names.get(chatId);
    if (known) return known;
    try {
      const chat = await m.getChat();
      if (chat) {
        const t = utils.getDisplayName(chat);
        if (t) names.set(chatId, t);
        return t || null;
      }
    } catch {
      /* unknown entity */
    }
    return null;
  };

  const convert = async (m: ApiNs.Message, historical: boolean): Promise<ParsedInbound | null> => {
    if (!(m instanceof Api.Message) || isBroadcast(m)) return null;
    const chatId = chatIdOf(m);
    const isGroup = !(m.peerId instanceof Api.PeerUser);
    if (isGroup && ignoreGroups) return null;
    const text = m.message ?? "";
    const attachments: InboundAttachment[] = [];
    let kind: ParsedInbound["kind"] = "text";
    if (m.media) {
      if (m.media instanceof Api.MessageMediaPhoto) {
        kind = "image";
        attachments.push({ name: `photo-${m.id}.jpg`, mime: "image/jpeg" });
      } else if (m.media instanceof Api.MessageMediaDocument && m.media.document instanceof Api.Document) {
        const d = m.media.document;
        const fileName = d.attributes.find((a): a is ApiNs.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename)?.fileName;
        const mime = d.mimeType || "application/octet-stream";
        kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "document";
        attachments.push({ name: fileName ?? `${kind}-${m.id}`, mime, size: Number(d.size) || null });
      } else if (m.media instanceof Api.MessageMediaGeo && m.media.geo instanceof Api.GeoPoint) {
        kind = "location";
      } else if (m.media instanceof Api.MessageMediaContact) {
        kind = "contact";
      }
    }
    let body = text;
    if (kind === "location" && m.media instanceof Api.MessageMediaGeo && m.media.geo instanceof Api.GeoPoint) body = `📍 ${m.media.geo.lat},${m.media.geo.long}${text ? ` ${text}` : ""}`;
    if (kind === "contact" && m.media instanceof Api.MessageMediaContact) body = `Contact: ${[m.media.firstName, m.media.lastName].filter(Boolean).join(" ")}, +${m.media.phoneNumber.replace(/^\+/, "")}`;
    if (!body.trim() && !attachments.length) return null;

    const title = await titleFor(chatId, m);
    let sender: ParsedInbound["sender"] = { isMe: true, name: "You" };
    if (!m.out) {
      let name: string | null = null;
      let phone: string | null = null;
      let username: string | null = null;
      try {
        const s = await m.getSender();
        if (s) {
          name = utils.getDisplayName(s) || null;
          if (s instanceof Api.User) {
            phone = s.phone ? `+${s.phone}` : null;
            username = s.username ?? null;
          }
        }
      } catch {
        /* unknown sender */
      }
      const senderId = m.fromId ? utils.getPeerId(m.fromId) : chatId;
      sender = { externalId: username ? `@${username}` : senderId, name, phone };
    }

    // Live media (≤ MAX_MEDIA_BYTES) is stored with the message.
    if (attachments.length && downloadMedia && !historical) {
      const declared = attachments[0].size ?? 0;
      if (declared <= maxMediaBytes()) {
        try {
          const data = await Promise.race([client.downloadMedia(m, {}), new Promise<undefined>((r) => setTimeout(() => r(undefined), 30_000))]);
          if (Buffer.isBuffer(data) && data.length <= maxMediaBytes()) attachments[0] = { ...attachments[0], data, size: data.length };
        } catch {
          ctx.log("warn", "tg_media_download_failed", { kind });
        }
      }
    }

    return {
      externalId: `${chatId}:${m.id}`,
      direction: m.out ? "outbound" : "inbound",
      conversation: { externalId: chatId, title, isGroup },
      sender,
      kind,
      text: body,
      attachments,
      sentAt: new Date((m.date ?? Math.floor(Date.now() / 1000)) * 1000),
      replyToExternalId: m.replyTo?.replyToMsgId ? `${chatId}:${m.replyTo.replyToMsgId}` : null,
      historical,
      raw: { provider: "telegram_user", isGroup, out: Boolean(m.out) },
    };
  };

  /* ----------------------------- History ----------------------------- */

  const importHistory = async () => {
    if (historyDays === 0) return;
    const cursor = await ctx.getCursor();
    if (cursor.historyDoneAt) return;
    const since = Math.floor(Date.now() / 1000) - historyDays * 86_400;
    const startedAt = new Date().toISOString();
    await ctx.update({ state: "syncing", progress: { phase: "history", total: null, done: 0, startedAt, finishedAt: null, message: "Importing recent chats…" } });
    let imported = 0;
    let chats = 0;
    for await (const dialog of client.iterDialogs({ limit: 100 })) {
      if (stopped) return;
      if (!dialog.date || dialog.date < since) break; // dialogs are ordered by last activity
      if (dialog.isChannel && !dialog.isGroup) continue; // broadcast channel
      if (dialog.isGroup && ignoreGroups) continue;
      chats++;
      if (dialog.entity) names.set(utils.getPeerId(dialog.entity), dialog.title ?? dialog.name ?? "");
      const batch: ParsedInbound[] = [];
      for await (const m of client.iterMessages(dialog.entity, { limit: 100 })) {
        if (!(m instanceof Api.Message)) continue;
        if ((m.date ?? 0) < since) break;
        const p = await convert(m, true);
        if (p) batch.push(p);
      }
      batch.reverse(); // oldest first
      const r = await ctx.ingestMany(batch, { historical: true, progress: { total: null, baseDone: imported } });
      imported += r.imported;
    }
    const finishedAt = new Date().toISOString();
    await ctx.setCursor({ historyDoneAt: finishedAt, historyImported: imported });
    await ctx.update({ state: "connected", lastSyncAt: new Date(), progress: { phase: "done", total: imported, done: imported, startedAt, finishedAt, message: `Imported ${imported} messages from ${chats} recent chats.` } });
  };

  /* ------------------------------ Online ----------------------------- */

  const goLive = async () => {
    loggedIn = true;
    const me = await client.getMe();
    await saveSession();
    await ctx.update({ state: "connected", account: { id: String(me.id), name: utils.getDisplayName(me) || undefined, phone: me.phone ? `+${me.phone}` : undefined } });
    unregister = registerLiveSender(ctx.channel.id, {
      sendText: async (to, text) => {
        if (stopped) throw new Error("Telegram is not connected.");
        const sent = await client.sendMessage(to, { message: text });
        return { providerMessageId: `${to}:${sent.id}` };
      },
    });
    client.addEventHandler(async (event: InstanceType<typeof events.NewMessageEvent>) => {
      if (stopped) return;
      try {
        const p = await convert(event.message, false);
        if (p) await ctx.ingest(p);
      } catch (e) {
        ctx.log("warn", "tg_ingest_failed", { message: e instanceof Error ? e.message.slice(0, 160) : "unknown" });
      }
    }, new events.NewMessage({}));
    // Populate the entity cache (needed to reply to ids) and import recent chats.
    void importHistory().catch((e) => ctx.log("warn", "tg_history_failed", { message: e instanceof Error ? e.message.slice(0, 160) : "unknown" }));
  };

  /* ------------------------------ Login ------------------------------ */

  /** teleproto asks whether to stop after an error: retry wrong passwords/codes, stop on anything else. */
  const onError = async (err: Error): Promise<boolean> => {
    if (err instanceof LoginInterrupted) return true;
    const code = rpcCode(err);
    if (code === "PASSWORD_HASH_INVALID") {
      promptError = WRONG_PASSWORD;
      return false;
    }
    if (code === "PHONE_CODE_INVALID" || code === "PHONE_CODE_EMPTY") {
      promptError = WRONG_CODE;
      return false;
    }
    if (code === "PHONE_CODE_EXPIRED") {
      promptError = CODE_EXPIRED; // teleproto requests a new code for the same number
      return false;
    }
    loginError = err;
    return true;
  };

  const askPassword = async (hint?: string) => {
    const error = promptError;
    promptError = null;
    await ctx.update({ state: "pairing", qr: null, qrExpiresAt: null, prompt: { kind: "password", hint: hint?.trim() ? hint.trim().slice(0, 100) : null, error, at: promptStamp() } });
    const password = await waitFor("password");
    await ctx.update({ state: "connecting", prompt: null });
    return password;
  };

  const askCode = async (phone: string, info: { type?: unknown } | undefined) => {
    const error = promptError;
    promptError = null;
    await ctx.update({ state: "pairing", qr: null, qrExpiresAt: null, prompt: { kind: "code", phoneMasked: maskPhone(phone), via: codeVia(info?.type), error, at: promptStamp() } });
    const code = await waitFor("code");
    await ctx.update({ state: "connecting", prompt: null });
    return code;
  };

  /** QR login: a fresh code about every 30 s until it is scanned (teleproto handles the DC migration). */
  const qrLogin = (signal: AbortSignal) =>
    client.signInUserWithQrCode(creds, {
      abortSignal: signal,
      qrCode: async ({ token, expires }) => {
        if (signal.aborted) return;
        const lastError = notice;
        notice = null;
        await ctx.update({ state: "pairing", qr: `tg://login?token=${token.toString("base64url")}`, qrExpiresAt: new Date(expires * 1000), prompt: null, lastError });
      },
      password: askPassword,
      onError,
    });

  /** Phone-number login: Telegram sends a code to the app (or SMS); then the two-step password if set. */
  const phoneLogin = async (phone: string, signal: AbortSignal) => {
    await ctx.update({ state: "connecting", qr: null, qrExpiresAt: null, prompt: null, lastError: null });
    return client.signInUser(creds, {
      phoneNumber: async () => {
        if (signal.aborted || stopped) throw new LoginInterrupted();
        return phone;
      },
      phoneCode: async (_viaApp?: boolean, info?: { type?: unknown }) => askCode(phone, info),
      password: askPassword,
      onError,
    });
  };

  const login = async () => {
    await ctx.update({ state: "connecting", lastError: null, prompt: null });
    await client.connect();
    if (await client.checkAuthorization()) return goLive();
    let retries = 0;
    for (;;) {
      if (stopped) return;
      attempt = new AbortController();
      const signal = attempt.signal;
      const current = mode;
      loginError = null;
      promptError = null;
      try {
        if (current.kind === "qr") await qrLogin(signal);
        else await phoneLogin(current.phone, signal);
        break;
      } catch (e) {
        if (stopped) return;
        if (signal.aborted) continue; // switched to the phone number, or back to a fresh QR code
        const err = loginError ?? e;
        const info = describeLoginError(err);
        if (!info) throw err; // unexpected (network…): the manager restarts us with backoff
        if (info.credentials) throw new Error(info.message); // admin must fix the server env
        ctx.log("info", "tg_login_retry", { mode: current.kind, code: rpcCode(err).slice(0, 40) || "other", waitSeconds: info.waitSeconds ?? 0 });
        // Back to a fresh QR code, with the reason shown above it.
        mode = { kind: "qr" };
        notice = info.message;
        if (info.waitSeconds) {
          await ctx.update({ state: "pairing", qr: null, qrExpiresAt: null, prompt: null, lastError: info.message });
          await pause(info.waitSeconds * 1000, signal);
        } else {
          if (++retries > 8) throw new Error(info.message);
          await pause(1500, signal);
        }
      }
    }
    return goLive();
  };

  void login().catch(async (e) => {
    if (stopped) return;
    const msg = e instanceof Error ? e.message : String(e);
    if ((e instanceof Error && e.name === "AbortError") || /^QR login aborted/.test(msg)) return;
    if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED/i.test(`${rpcCode(e)} ${msg}`)) {
      await ctx.setAuth(null);
      await ctx.update({ state: "logged_out", account: null, qr: null, prompt: null, lastError: "This Telegram session was ended (Settings → Devices). Connect again to link it." });
      ctx.fail(new Error("logged_out"));
      return;
    }
    ctx.fail(e);
  });

  return {
    async stop() {
      stopped = true;
      interrupt();
      unregister?.();
      try {
        await saveSession();
      } catch {
        /* not logged in */
      }
      await Promise.race([client.destroy(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {});
    },
    async command(cmd, arg) {
      // Args are sealed by the connection route; opened only here, never logged.
      if (cmd === "password" && arg) return answer("password", openText(arg));
      if (cmd === "code" && arg) return answer("code", openText(arg).replace(/[\s-]/g, ""));
      if (cmd === "phone_login" && arg) {
        if (loggedIn || stopped) return;
        const phone = openText(arg);
        if (!/^\+\d{7,15}$/.test(phone)) return;
        mode = { kind: "phone", phone };
        notice = null;
        interrupt();
        return;
      }
      if (cmd === "connect") {
        // "New QR code" / "Use QR code instead": restart the QR login right away.
        if (loggedIn || stopped) return;
        mode = { kind: "qr" };
        interrupt();
        return;
      }
      if (cmd === "resync") {
        await ctx.setCursor({ historyDoneAt: null });
        if (!stopped && (await client.checkAuthorization().catch(() => false))) await importHistory();
        return;
      }
      if (cmd === "logout") {
        stopped = true;
        await client.logOut().catch(() => {});
      }
    },
  };
};
