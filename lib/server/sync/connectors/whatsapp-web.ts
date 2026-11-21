/**
 * WhatsApp linked device (EXPERIMENTAL, unofficial) via Baileys.
 *
 * Infera becomes one of the account's "Linked devices" (like WhatsApp Web):
 * the admin scans a QR code (or enters an 8-character pairing code) on the
 * phone, then every chat syncs live — new messages within a second, plus the
 * recent history WhatsApp shares with a newly linked device.
 *
 * This is NOT Meta's official API; WhatsApp may restrict or ban accounts that
 * use unofficial clients. The connection API refuses to start it until the
 * admin acknowledged that (`channel.config.riskAcknowledged === true`).
 *
 * Storage: the linked-device credentials (`creds`) live in the encrypted auth
 * blob; Signal session/pre-keys live in the encrypted per-channel KV
 * (`<type>:<id>`). Nothing is written to disk, so any instance that takes over
 * the lease resumes the same session.
 *
 * Channel config (all optional):
 *   historyDays  — import history up to N days back (default 90, 0 = no history, max 3650)
 *   ignoreGroups — skip group chats (default false)
 *   downloadMedia — store photos/documents/voice notes ≤ MAX_MEDIA_BYTES for live messages (default true)
 */
import type { AuthenticationCreds, AuthenticationState, BaileysEventMap, Contact, SignalDataSet, SignalDataTypeMap, WAMessage, WASocket, proto as Proto } from "baileys";
import type { ConnectorFactory, ConnectorContext } from "../types";
import type { ParsedInbound } from "../../channels/types";
import { maxMediaBytes } from "../../env";
import { registerLiveSender } from "../live";
import { isGroupJid, isIgnoredJid, mediaInfo, parseLinkedDeviceMessage, phoneFromJid, toNum, unwrapContent, type LinkedDeviceMessage } from "../../channels/adapters/whatsapp-web";

type Baileys = typeof import("baileys");

const AUTH_VERSION = 1;
const MAX_RECONNECTS = 6;
const MEDIA_TIMEOUT_MS = 30_000;
const HISTORY_IDLE_MS = 90_000;
const SENT_CACHE = 300;

type StoredAuth = { v: number; creds: string };

const cfgNum = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

/** Shape Baileys expects (pino-compatible); not exported from the package root. */
type WaLogger = {
  level: string;
  child(obj: Record<string, unknown>): WaLogger;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
};

/** Baileys logs carry JIDs and message metadata: drop everything below error, and scrub numbers from what's left. */
function makeLogger(ctx: ConnectorContext): WaLogger {
  const scrub = (v: unknown) =>
    String(typeof v === "string" ? v : v instanceof Error ? v.message : ((v as { msg?: unknown; err?: { message?: unknown } })?.err?.message ?? (v as { msg?: unknown })?.msg ?? ""))
      .replace(/\d{6,}/g, "#")
      .slice(0, 200);
  const logger: WaLogger = {
    level: "error",
    child: () => logger,
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (obj: unknown, msg?: string) => ctx.log("warn", "wa_lib_error", { message: scrub(msg ?? obj) }),
  };
  return logger;
}

/**
 * Baileys auth state backed by the connector's encrypted auth blob + KV.
 * Writes are serialised so creds/keys never land out of order.
 */
async function dbAuthState(ctx: ConnectorContext, B: Baileys): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; flush: () => Promise<void> }> {
  const { BufferJSON, initAuthCreds, proto } = B;
  const enc = (v: unknown) => JSON.stringify(v, BufferJSON.replacer);
  const dec = <T>(v: string): T => JSON.parse(v, BufferJSON.reviver) as T;

  const stored = await ctx.getAuth<StoredAuth>();
  const creds: AuthenticationCreds = stored?.v === AUTH_VERSION && stored.creds ? dec<AuthenticationCreds>(stored.creds) : initAuthCreds();

  let chain: Promise<unknown> = Promise.resolve();
  const queue = (fn: () => Promise<unknown>) => {
    const next = chain.then(fn, fn);
    chain = next.catch((e) => ctx.log("error", "wa_auth_write_failed", { message: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
    return next;
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        await chain; // read-your-writes
        const rows = await ctx.kv.getMany<string>(ids.map((id) => `${type}:${id}`));
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          const raw = rows[`${type}:${id}`];
          if (raw === undefined) continue;
          let value = dec<SignalDataTypeMap[T]>(raw);
          if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value as object) as unknown as SignalDataTypeMap[T];
          out[id] = value;
        }
        return out;
      },
      set: async (data: SignalDataSet) => {
        const entries: Record<string, unknown | null> = {};
        for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
          for (const [id, value] of Object.entries(data[type] ?? {})) entries[`${type}:${id}`] = value ? enc(value) : null;
        }
        await queue(() => ctx.kv.setMany(entries));
      },
    },
  };
  return {
    state,
    saveCreds: () => queue(() => ctx.setAuth({ v: AUTH_VERSION, creds: enc(creds) } satisfies StoredAuth)) as Promise<void>,
    flush: () => chain.then(() => undefined),
  };
}

export const createConnector: ConnectorFactory = async (ctx) => {
  const B: Baileys = await import("baileys");
  const { Browsers, DisconnectReason, fetchLatestWaWebVersion, jidNormalizedUser, isLidUser, isPnUser, downloadMediaMessage, makeCacheableSignalKeyStore } = B;
  const makeWASocket = B.makeWASocket ?? B.default;
  const logger = makeLogger(ctx);

  const cfg = ctx.channel.config ?? {};
  const historyDays = cfgNum(cfg.historyDays, 90, 0, 3650);
  const ignoreGroups = cfg.ignoreGroups === true;
  const downloadMedia = cfg.downloadMedia !== false;

  const auth = await dbAuthState(ctx, B);
  const keys = makeCacheableSignalKeyStore(auth.state.keys, logger);

  // WhatsApp rejects outdated client versions (405); use the current web version when reachable.
  let version: [number, number, number] | undefined;
  try {
    const latest = await fetchLatestWaWebVersion({ signal: AbortSignal.timeout(6000) });
    if (latest?.version?.length === 3) version = latest.version as [number, number, number];
  } catch {
    /* fall back to the version bundled with Baileys */
  }

  /* ----------------------------- State ----------------------------- */

  let sock: WASocket | null = null;
  let stopped = false;
  let reconnects = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let unregisterSender: (() => void) | null = null;
  let qrWaiters: (() => void)[] = [];
  let qrCount = 0;
  let lastSyncTouch = 0;

  const names = new Map<string, string>(); // jid → best known display name
  const lidToPn = new Map<string, string>();
  const groupSubjects = new Map<string, string>();
  const groupFetches = new Map<string, Promise<string | null>>();
  const sent = new Map<string, Proto.IMessage>(); // recent outgoing messages (for WhatsApp retry requests)

  // History sync bookkeeping
  let history = { active: false, imported: 0, chunks: 0, lastAt: 0, percent: null as number | null };
  let historyTimer: ReturnType<typeof setInterval> | null = null;

  // All ingestion runs through one queue: ordered, and never more than one DB write burst at a time.
  let work: Promise<unknown> = Promise.resolve();
  const enqueue = (fn: () => Promise<unknown>) => {
    work = work.then(fn).catch((e) => ctx.log("error", "wa_ingest_failed", { message: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
    return work;
  };

  const safe = (fn: () => Promise<unknown>) => () => {
    if (!stopped && !ctx.signal.aborted) void fn().catch((e) => ctx.log("error", "wa_handler_failed", { message: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
  };

  /* --------------------------- Identities -------------------------- */

  const rememberContact = (c: Partial<Contact>) => {
    const name = c.name || c.notify || c.verifiedName;
    const ids = [c.id, c.lid, c.phoneNumber].filter((x): x is string => Boolean(x)).map((j) => jidNormalizedUser(j));
    if (name) for (const id of ids) names.set(id, name);
    const lid = ids.find((j) => isLidUser(j));
    const pn = ids.find((j) => isPnUser(j));
    if (lid && pn) lidToPn.set(lid, pn);
  };

  /** LID (hidden number) → phone JID when WhatsApp told us the mapping; otherwise the JID itself. */
  const canonical = async (jid: string | null | undefined, alt?: string | null): Promise<string | null> => {
    if (!jid) return null;
    const j = jidNormalizedUser(jid);
    if (!isLidUser(j)) return j;
    if (alt && isPnUser(alt)) {
      const pn = jidNormalizedUser(alt);
      lidToPn.set(j, pn);
      return pn;
    }
    const known = lidToPn.get(j);
    if (known) return known;
    try {
      const pn = await sock?.signalRepository.lidMapping.getPNForLID(j);
      if (pn) {
        const norm = jidNormalizedUser(pn);
        lidToPn.set(j, norm);
        return norm;
      }
    } catch {
      /* unknown mapping: keep the LID */
    }
    return j;
  };

  const groupSubject = async (jid: string): Promise<string | null> => {
    const known = groupSubjects.get(jid);
    if (known) return known;
    let p = groupFetches.get(jid);
    if (!p) {
      p = (async () => {
        try {
          const meta = await sock?.groupMetadata(jid);
          if (meta?.subject) groupSubjects.set(jid, meta.subject);
          return meta?.subject ?? null;
        } catch {
          return null;
        } finally {
          setTimeout(() => groupFetches.delete(jid), 60_000);
        }
      })();
      groupFetches.set(jid, p);
    }
    return p;
  };

  const nameFor = (jid: string | null, alt?: string | null) => (jid && names.get(jid)) || (alt && names.get(jidNormalizedUser(alt))) || null;

  /** Converts a Baileys message into Infera's shape (null = skip). */
  const convert = async (m: WAMessage, historical: boolean): Promise<ParsedInbound | null> => {
    const key = m.key as (typeof m.key & { remoteJidAlt?: string | null; participantAlt?: string | null }) | null | undefined;
    if (!key?.remoteJid || isIgnoredJid(key.remoteJid)) return null;
    const isGroup = isGroupJid(key.remoteJid);
    if (isGroup && ignoreGroups) return null;
    if (m.messageStubType && !m.message) return null;

    const chatJid = isGroup ? key.remoteJid : await canonical(key.remoteJid, key.remoteJidAlt);
    if (!chatJid) return null;
    if (!key.fromMe && m.pushName) {
      const senderJid = isGroup ? await canonical(key.participant, key.participantAlt) : chatJid;
      if (senderJid && !names.has(senderJid)) names.set(senderJid, m.pushName);
    }

    let sender: { jid: string | null; phone: string | null; name: string | null } | null = null;
    let chatTitle: string | null;
    if (isGroup) {
      chatTitle = await groupSubject(chatJid);
      if (!key.fromMe) {
        const pj = await canonical(key.participant, key.participantAlt);
        sender = { jid: pj, phone: phoneFromJid(pj), name: nameFor(pj, key.participant) ?? m.pushName ?? null };
      }
    } else {
      const name = nameFor(chatJid, key.remoteJid);
      chatTitle = name ?? phoneFromJid(chatJid);
      if (!key.fromMe) sender = { jid: chatJid, phone: phoneFromJid(chatJid), name: name ?? m.pushName ?? null };
    }
    return parseLinkedDeviceMessage(m as LinkedDeviceMessage, { chatJid, chatTitle, sender }, { historical });
  };

  /** Live messages: fetch media bytes (bounded) so photos/PDFs/voice notes are stored with the message. */
  const withMedia = async (m: WAMessage, parsed: ParsedInbound): Promise<ParsedInbound> => {
    if (!downloadMedia || !parsed.attachments?.length || !sock) return parsed;
    const info = mediaInfo(unwrapContent(m.message), parsed.externalId);
    if (!info || info.kind === "sticker" || (info.size !== null && info.size > maxMediaBytes())) return parsed;
    try {
      const s = sock;
      const data = await Promise.race([
        downloadMediaMessage(m, "buffer", {}, { reuploadRequest: (msg) => s.updateMediaMessage(msg), logger }),
        new Promise<null>((r) => setTimeout(() => r(null), MEDIA_TIMEOUT_MS)),
      ]);
      if (data && data.length && data.length <= maxMediaBytes()) parsed.attachments = [{ ...parsed.attachments[0], data, size: data.length }];
    } catch {
      ctx.log("warn", "wa_media_download_failed", { kind: info.kind });
    }
    return parsed;
  };

  const touchSync = () => {
    const now = Date.now();
    if (now - lastSyncTouch < 30_000) return;
    lastSyncTouch = now;
    void ctx.update({ lastSyncAt: new Date() }).catch(() => {});
  };

  /* ---------------------------- History ---------------------------- */

  const finishHistory = async () => {
    if (!history.active) return;
    history.active = false;
    if (historyTimer) clearInterval(historyTimer);
    historyTimer = null;
    const now = new Date().toISOString();
    await ctx.setCursor({ historyDoneAt: now, historyImported: history.imported });
    await ctx.update({ state: "connected", lastSyncAt: new Date(), progress: { phase: "done", total: history.imported, done: history.imported, startedAt: null, finishedAt: now, message: `Imported ${history.imported} messages from history.` } });
    ctx.log("info", "wa_history_done", { imported: history.imported, chunks: history.chunks });
  };

  const onHistory = async (ev: BaileysEventMap["messaging-history.set"]) => {
    for (const c of ev.contacts ?? []) rememberContact(c);
    for (const c of ev.chats ?? []) if (c.id && isGroupJid(c.id) && c.name) groupSubjects.set(c.id, c.name);
    for (const map of ev.lidPnMappings ?? []) if (map.lid && map.pn) lidToPn.set(jidNormalizedUser(map.lid), jidNormalizedUser(map.pn));
    if (historyDays === 0) return;

    const cutoff = Date.now() / 1000 - historyDays * 86_400;
    const msgs = (ev.messages ?? []).filter((m) => (toNum(m.messageTimestamp) ?? 0) >= cutoff);
    if (!history.active) {
      history = { active: true, imported: 0, chunks: 0, lastAt: Date.now(), percent: null };
      await ctx.update({ state: "syncing", progress: { phase: "history", total: null, done: 0, startedAt: new Date().toISOString(), finishedAt: null, message: "Importing chat history…" } });
      // WhatsApp doesn't always say it's finished: settle once chunks stop arriving.
      historyTimer = setInterval(() => {
        if (history.active && Date.now() - history.lastAt > HISTORY_IDLE_MS) void enqueue(finishHistory);
      }, 15_000);
      historyTimer.unref?.();
    }
    history.lastAt = Date.now();
    history.chunks++;
    if (typeof ev.progress === "number") history.percent = ev.progress;

    const parsed: ParsedInbound[] = [];
    // History arrives newest-first; import oldest-first so contacts and conversations form naturally.
    for (const m of [...msgs].reverse()) {
      if (stopped) return;
      const p = await convert(m, true);
      if (p) parsed.push(p);
    }
    const r = await ctx.ingestMany(parsed, { historical: true, progress: { total: null, baseDone: history.imported } });
    history.imported += r.imported;
    history.lastAt = Date.now();
    await ctx.update({
      progress: { phase: "history", total: null, done: history.imported, startedAt: null, finishedAt: null, message: history.percent !== null ? `Importing chat history… ${Math.round(history.percent)}%` : "Importing chat history…" },
    });
    if (history.percent !== null && history.percent >= 100) await finishHistory();
  };

  /* ---------------------------- Socket ----------------------------- */

  const connect = async () => {
    if (stopped) return;
    qrCount = 0;
    const s = makeWASocket({
      auth: { creds: auth.state.creds, keys },
      logger,
      // A Chrome (WhatsApp Web) identity: WhatsApp currently terminates registration (428) for the "Desktop" app identity.
      browser: Browsers.macOS("Chrome"),
      syncFullHistory: historyDays > 0,
      shouldSyncHistoryMessage: () => historyDays > 0,
      markOnlineOnConnect: false, // don't suppress notifications on the user's phone
      fireInitQueries: true,
      generateHighQualityLinkPreview: false,
      emitOwnEvents: true,
      ...(version ? { version } : {}),
      getMessage: async (key) => (key.id ? sent.get(key.id) : undefined),
    });
    sock = s;

    s.ev.on("creds.update", () => void auth.saveCreds());

    s.ev.on("connection.update", (u) =>
      safe(async () => {
        if (s !== sock) return;
        if (u.qr) {
          qrCount++;
          // First QR lives ~60 s, later ones ~20 s.
          await ctx.update({ state: "pairing", qr: u.qr, qrExpiresAt: new Date(Date.now() + (qrCount === 1 ? 58_000 : 19_000)) });
          const waiters = qrWaiters;
          qrWaiters = [];
          for (const w of waiters) w();
        }
        if (u.connection === "open") {
          reconnects = 0;
          const me = s.user;
          const meJid = me?.id ? jidNormalizedUser(me.id) : null;
          await ctx.update({ state: history.active ? "syncing" : "connected", account: { id: meJid ?? undefined, name: me?.name || me?.notify || undefined, phone: phoneFromJid(meJid) ?? undefined } });
          unregisterSender?.();
          unregisterSender = registerLiveSender(ctx.channel.id, {
            sendText: async (to, text) => {
              if (!sock || sock !== s || stopped) throw new Error("WhatsApp is not connected.");
              const res = await s.sendMessage(to, { text });
              if (res?.key.id && res.message) {
                sent.set(res.key.id, res.message);
                if (sent.size > SENT_CACHE) sent.delete(sent.keys().next().value!);
              }
              return { providerMessageId: res?.key.id ?? null };
            },
          });
          ctx.log("info", "wa_connected", { reconnects });
        }
        if (u.connection === "close") {
          unregisterSender?.();
          unregisterSender = null;
          if (stopped) return;
          const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
          ctx.log("info", "wa_closed", { code: code ?? null, registered: Boolean(auth.state.creds.registered) });
          await onClose(code);
        }
      })(),
    );

    s.ev.on("messaging-history.set", (ev) => void enqueue(() => onHistory(ev)));
    s.ev.on("contacts.upsert", (list) => list.forEach(rememberContact));
    s.ev.on("contacts.update", (list) => list.forEach((c) => rememberContact(c)));
    s.ev.on("chats.upsert", (list) => list.forEach((c) => c.id && isGroupJid(c.id) && c.name && groupSubjects.set(c.id, c.name)));
    s.ev.on("groups.update", (list) => list.forEach((g) => g.id && g.subject && groupSubjects.set(g.id, g.subject)));
    s.ev.on("lid-mapping.update", (map) => map.lid && map.pn && lidToPn.set(jidNormalizedUser(map.lid), jidNormalizedUser(map.pn)));

    s.ev.on("messages.upsert", ({ messages, type }) =>
      void enqueue(async () => {
        if (s !== sock || stopped) return;
        const dayAgo = Date.now() / 1000 - 86_400;
        for (const m of messages) {
          // "notify" = new message; "append" = sent from the phone / another linked device, or a late delivery.
          const old = type === "append" && (toNum(m.messageTimestamp) ?? 0) < dayAgo;
          const parsed = await convert(m, old);
          if (!parsed) continue;
          await ctx.ingest(old ? parsed : await withMedia(m, parsed), old ? { historical: true } : {});
          touchSync();
        }
      }),
    );
  };

  const onClose = async (code: number | undefined) => {
    const registered = Boolean(auth.state.creds.registered);
    if (code === DisconnectReason.loggedOut) {
      // Removed from Linked devices on the phone (or logged out from Infera): the session is gone for good.
      stopped = true;
      await auth.flush();
      await ctx.setAuth(null);
      await ctx.kv.clear();
      await ctx.setCursor({ historyDoneAt: null });
      await ctx.update({ state: "logged_out", qr: null, pairingCode: null, account: null, progress: null, lastError: "This device was logged out of WhatsApp. Connect again and scan a new QR code." });
      // Hand the runtime back to the manager now (it keeps the logged_out state and won't restart until "Connect").
      ctx.fail(new Error("logged_out"));
      return;
    }
    if (code === DisconnectReason.restartRequired) {
      // Normal right after pairing: WhatsApp asks the new device to reconnect.
      await connect();
      return;
    }
    if (!registered && code === DisconnectReason.timedOut) {
      // QR codes ran out without a scan: stop and wait for the admin.
      stopped = true;
      await ctx.update({ state: "disconnected", qr: null, pairingCode: null, lastError: "The QR code expired before it was scanned. Click Connect to get a new one." });
      // Stop now so a new "Connect" starts a fresh runtime (the manager leaves the disconnected state as is).
      ctx.fail(new Error("qr_expired"));
      return;
    }
    if (code === DisconnectReason.connectionReplaced) {
      ctx.fail(new Error("Another session replaced this WhatsApp connection (is the same channel running on another server?)."));
      return;
    }
    if (code === DisconnectReason.forbidden) {
      ctx.fail(new Error("WhatsApp refused the connection (403). The account may be restricted for using an unofficial client."));
      return;
    }
    if (code === DisconnectReason.badSession || code === DisconnectReason.multideviceMismatch) {
      ctx.fail(new Error(`WhatsApp rejected the stored session (${code}). If this keeps happening, log out and link the device again.`));
      return;
    }
    // Network drop, server restart, keep-alive timeout …: reconnect quickly, then hand over to the manager's backoff.
    if (++reconnects > MAX_RECONNECTS) {
      ctx.fail(new Error(`WhatsApp connection keeps dropping (last code ${code ?? "unknown"}).`));
      return;
    }
    await ctx.update({ state: "connecting" });
    const delay = Math.min(30_000, 1000 * 2 ** (reconnects - 1));
    reconnectTimer = setTimeout(() => void connect().catch(ctx.fail), delay);
  };

  await ctx.update({ state: "connecting", lastError: null });
  await connect();

  return {
    async stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (historyTimer) clearInterval(historyTimer);
      unregisterSender?.();
      unregisterSender = null;
      const s = sock;
      sock = null;
      try {
        s?.end(undefined);
      } catch {
        /* already closed */
      }
      await Promise.race([Promise.all([work, auth.flush()]), new Promise((r) => setTimeout(r, 5000))]);
    },

    async command(cmd, arg) {
      if (cmd === "pair_code") {
        if (!arg) return;
        if (auth.state.creds.registered) return; // already linked
        if (!sock || stopped) throw new Error("WhatsApp connection is not running.");
        // A pairing code can only be requested once the socket is waiting for a login (first QR issued).
        if (qrCount === 0) await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("WhatsApp did not offer a login in time.")), 25_000);
          qrWaiters.push(() => {
            clearTimeout(t);
            resolve();
          });
        });
        const code = await sock.requestPairingCode(arg.replace(/\D/g, ""));
        const pretty = code?.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
        await ctx.update({ state: "pairing", pairingCode: pretty ?? null });
        return;
      }
      if (cmd === "resync") {
        // Reconnect: WhatsApp redelivers everything received while the device was offline.
        if (!auth.state.creds.registered) return;
        reconnects = 0;
        const s = sock;
        sock = null;
        try {
          s?.end(undefined);
        } catch {
          /* ignore */
        }
        await connect();
        return;
      }
      if (cmd === "logout") {
        stopped = true;
        try {
          await sock?.logout();
        } catch {
          /* the manager clears the stored session either way */
        }
      }
    },
  };
};
