"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as db from "@/lib/app/db";
import { buildSample, previewOf } from "@/lib/app/sample";
import { extractLocal, isoDate, mergeRows, type Extracted } from "@/lib/app/extract";
import { cloudExtract, cloudStatus } from "@/lib/app/ai-client";
import type { ParsedChat } from "@/lib/app/whatsapp";
import { defaultSettings, type AssistantMsg, type CellValue, type Chat, type Collection, type Message, type Plan, type Row, type Settings, type Thread } from "@/lib/app/types";

/** Media types a restored backup may keep; anything else becomes application/octet-stream. */
const SAFE_MEDIA = /^(image\/(jpeg|png|webp|gif|heic|svg\+xml)|video\/(mp4|3gpp|quicktime)|audio\/(ogg|mp4|mpeg|aac)|application\/(pdf|msword|zip|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.[a-z.]+)|text\/(csv|plain|vcard))$/i;
/** Types that are safe to open inline as a top-level page (no script can run). */
const INLINE_OK = /^(image\/(jpeg|png|webp|gif|heic)|video\/|audio\/|application\/pdf$|text\/plain$)/;
/** Largest single media file a JSON backup can hold (base64 grows it by a third). */
const MAX_BACKUP_BLOB = 300 * 1024 * 1024;

function blobToBase64(b: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error ?? new Error("Couldn't read a media file."));
    r.readAsDataURL(b);
  });
}

const COLORS = ["#5b4bff", "#ff8a3d", "#12b76a", "#e5484d", "#0090ff", "#a855f7", "#d97706", "#0ea5a4", "#db2777", "#64748b"];

type Store = {
  ready: boolean;
  chats: Chat[];
  messages: Message[];
  collections: Collection[];
  rows: Row[];
  threads: Thread[];
  settings: Settings;
  cloudAvailable: boolean;
  /** Collection ids currently being (re)built. */
  busy: Record<string, string>;
  messageById: Map<string, Message>;
  chatById: Map<string, Chat>;
  useCloud: boolean;

  loadSample: () => Promise<void>;
  importChat: (parsed: ParsedChat, me: string | null, opts?: { into?: string }) => Promise<{ chatId: string; added: number }>;
  deleteChat: (id: string) => Promise<void>;
  markRead: (id: string) => void;
  togglePin: (id: string) => void;

  createCollection: (plan: Plan) => Promise<string>;
  updateCollection: (id: string, patch: Partial<Collection>) => void;
  deleteCollection: (id: string) => Promise<void>;
  refreshCollection: (id: string) => Promise<void>;
  addRow: (collectionId: string, values?: Record<string, CellValue>) => Promise<string>;
  updateCell: (rowId: string, key: string, value: CellValue) => void;
  deleteRows: (ids: string[]) => Promise<void>;
  addMessageToCollection: (messageId: string, collectionId: string) => Promise<string>;

  saveThread: (t: Thread) => void;
  deleteThread: (id: string) => void;

  updateSettings: (patch: Partial<Settings>) => void;
  resetAll: () => Promise<void>;
  exportBackup: () => Promise<Blob>;
  restoreBackup: (file: File) => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside <StoreProvider>");
  return s;
}

export function StoreProvider({ children, onError }: { children: ReactNode; onError: (title: string, body?: string) => void }) {
  const [ready, setReady] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [cloudAvailable, setCloudAvailable] = useState(false);
  const [busy, setBusy] = useState<Record<string, string>>({});

  // Refs so async actions always see the latest data.
  const ref = useRef({ chats, messages, collections, rows, settings, cloudAvailable });
  ref.current = { chats, messages, collections, rows, settings, cloudAvailable };

  // Resolves once the initial IndexedDB load has finished; mutating actions wait on it
  // so they see the stored data and the load can't overwrite their results.
  const [loadGate] = useState(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  });
  const loadStarted = useRef(false);
  // Bumped by reset/restore so in-flight extractions don't write stale rows afterwards.
  const epoch = useRef(0);
  // Collections deleted this session; a re-render can briefly restore them in `ref`, this can't.
  const deletedCols = useRef(new Set<string>());

  useEffect(() => {
    cloudStatus().then(setCloudAvailable);
    if (loadStarted.current) return;
    loadStarted.current = true;
    (async () => {
      try {
        const [c, m, col, r, t, s] = await Promise.all([
          db.getAll("chats"),
          db.getAll("messages"),
          db.getAll("collections"),
          db.getAll("rows"),
          db.getAll("threads"),
          db.getSetting(),
        ]);
        const sortedMessages = m.sort((a, b) => a.at - b.at);
        const sortedCollections = col.sort((a, b) => a.createdAt - b.createdAt);
        const loadedSettings = { ...defaultSettings, ...s };
        setChats(c);
        setMessages(sortedMessages);
        setCollections(sortedCollections);
        setRows(r);
        setThreads(t.sort((a, b) => b.updatedAt - a.updatedAt));
        setSettings(loadedSettings);
        Object.assign(ref.current, { chats: c, messages: sortedMessages, collections: sortedCollections, rows: r, settings: loadedSettings });
      } catch (e) {
        onError("Couldn't open your on-device storage", e instanceof Error ? e.message : undefined);
      } finally {
        setReady(true);
        loadGate.resolve();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useCloud = cloudAvailable && settings.cloudAI;

  /* --------------------------- Collections -------------------------- */

  const applyExtraction = useCallback(async (col: Collection, extracted: Extracted[], startEpoch: number) => {
    const colGone = (id: string) => deletedCols.current.has(id) || !ref.current.collections.some((c) => c.id === id);
    if (epoch.current !== startEpoch || colGone(col.id)) return;
    // Never bring back rows the user deleted.
    const latest = ref.current.collections.find((c) => c.id === col.id) ?? col;
    const dismissed = new Set(latest.dismissedKeys ?? []);
    const kept = dismissed.size ? extracted.filter((e) => !dismissed.has(e.key)) : extracted;
    const existing = ref.current.rows.filter((r) => r.collectionId === col.id);
    const { upserts, deletes } = mergeRows(col.id, existing, kept);
    await db.putMany("rows", upserts);
    // A reset/restore that started meanwhile queues its clear after this write, so just stop.
    if (epoch.current !== startEpoch) return;
    if (colGone(col.id)) {
      // The collection was deleted while we were writing: remove the orphan rows.
      await db.deleteMany("rows", upserts.map((r) => r.id));
      return;
    }
    await db.deleteMany("rows", deletes);
    const up = new Map(upserts.map((r) => [r.id, r]));
    const del = new Set(deletes);
    setRows((prev) => {
      const next = prev.filter((r) => !del.has(r.id)).map((r) => up.get(r.id) ?? r);
      const have = new Set(next.map((r) => r.id));
      for (const r of upserts) if (!have.has(r.id)) next.push(r);
      ref.current.rows = next;
      return next;
    });
  }, []);

  const run = useCallback(
    async (col: Collection, chatsArg?: Chat[], messagesArg?: Message[]) => {
      const cs = chatsArg ?? ref.current.chats;
      const ms = messagesArg ?? ref.current.messages;
      const startEpoch = epoch.current;
      const cloud = col.engine === "claude" && ref.current.cloudAvailable && ref.current.settings.cloudAI;
      setBusy((b) => ({ ...b, [col.id]: cloud ? "Claude is reading your chats…" : "Reading your chats…" }));
      try {
        let extracted: Extracted[];
        if (cloud) {
          try {
            extracted = await cloudExtract(col, cs, ms, (d, t) =>
              setBusy((b) => ({ ...b, [col.id]: t > 1 ? `Claude is reading your chats… ${d}/${t}` : "Claude is reading your chats…" })),
            );
          } catch (e) {
            onError("Cloud AI couldn't build this collection", `${e instanceof Error ? e.message : ""} Used the on-device engine instead.`);
            extracted = extractLocal(col, cs, ms);
          }
        } else {
          extracted = extractLocal(col, cs, ms);
        }
        await applyExtraction(col, extracted, startEpoch);
      } finally {
        setBusy((b) => {
          const { [col.id]: _, ...rest } = b;
          return rest;
        });
      }
    },
    [applyExtraction, onError],
  );

  const runAutopilot = useCallback(
    async (chatsNow: Chat[], messagesNow: Message[], changedChatIds: string[]) => {
      for (const col of ref.current.collections) {
        if (!col.autopilot) continue;
        if (col.scope !== "all" && !changedChatIds.some((id) => (col.scope as string[]).includes(id))) continue;
        await run(col, chatsNow, messagesNow);
      }
    },
    [run],
  );

  const createCollection = useCallback(
    async (plan: Plan) => {
      await loadGate.promise;
      const now = Date.now();
      const col: Collection = {
        id: db.uid("c_"),
        name: plan.name,
        description: plan.description,
        icon: plan.icon,
        template: plan.template,
        fields: plan.fields,
        autopilot: true,
        scope: plan.scope,
        view: plan.fields.some((f) => f.type === "image") ? "gallery" : "table",
        engine: plan.template === "custom" && ref.current.cloudAvailable && ref.current.settings.cloudAI ? "claude" : "local",
        createdAt: now,
        updatedAt: now,
      };
      await db.putMany("collections", [col]);
      setCollections((p) => {
        const next = [...p, col];
        ref.current.collections = next;
        return next;
      });
      await run(col);
      return col.id;
    },
    [run, loadGate],
  );

  const updateCollection = useCallback((id: string, patch: Partial<Collection>) => {
    setCollections((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c));
      const col = next.find((c) => c.id === id);
      if (col) db.putMany("collections", [col]);
      ref.current.collections = next;
      return next;
    });
  }, []);

  const deleteCollection = useCallback(async (id: string) => {
    // Mark it gone first so in-flight extractions see the deletion and don't write rows.
    deletedCols.current.add(id);
    ref.current.collections = ref.current.collections.filter((c) => c.id !== id);
    const rowIds = ref.current.rows.filter((r) => r.collectionId === id).map((r) => r.id);
    await db.deleteMany("rows", rowIds);
    await db.deleteMany("collections", [id]);
    setRows((p) => {
      const next = p.filter((r) => r.collectionId !== id);
      ref.current.rows = next;
      return next;
    });
    setCollections((p) => {
      const next = p.filter((c) => c.id !== id);
      ref.current.collections = next;
      return next;
    });
  }, []);

  const refreshCollection = useCallback(
    async (id: string) => {
      const col = ref.current.collections.find((c) => c.id === id);
      if (col) await run(col);
    },
    [run],
  );

  const addRow = useCallback(async (collectionId: string, values: Record<string, CellValue> = {}) => {
    const col = ref.current.collections.find((c) => c.id === collectionId);
    const now = Date.now();
    const row: Row = {
      id: db.uid("r_"),
      collectionId,
      values: Object.fromEntries((col?.fields ?? []).map((f) => [f.key, values[f.key] ?? (f.type === "date" ? isoDate(now) : f.type === "status" ? (f.options?.[0] ?? null) : null)])),
      sourceIds: [],
      manual: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.putMany("rows", [row]);
    setRows((p) => [...p, row]);
    return row.id;
  }, []);

  const updateCell = useCallback((rowId: string, key: string, value: CellValue) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, [key]: value }, edited: { ...r.edited, [key]: true as const }, updatedAt: Date.now() } : r));
      const row = next.find((r) => r.id === rowId);
      if (row) db.putMany("rows", [row]);
      return next;
    });
  }, []);

  const deleteRows = useCallback(
    async (ids: string[]) => {
      const s = new Set(ids);
      // Remember the keys of auto-extracted rows so autopilot doesn't re-create them.
      const keysByCol = new Map<string, string[]>();
      for (const r of ref.current.rows) {
        if (!s.has(r.id) || r.manual || !r.key) continue;
        keysByCol.set(r.collectionId, [...(keysByCol.get(r.collectionId) ?? []), r.key]);
      }
      for (const [colId, keys] of keysByCol) {
        const col = ref.current.collections.find((c) => c.id === colId);
        if (col) updateCollection(colId, { dismissedKeys: [...new Set([...(col.dismissedKeys ?? []), ...keys])] });
      }
      await db.deleteMany("rows", ids);
      setRows((p) => {
        const next = p.filter((r) => !s.has(r.id));
        ref.current.rows = next;
        return next;
      });
    },
    [updateCollection],
  );

  const addMessageToCollection = useCallback(
    async (messageId: string, collectionId: string) => {
      const col = ref.current.collections.find((c) => c.id === collectionId);
      const msg = ref.current.messages.find((m) => m.id === messageId);
      if (!col || !msg) throw new Error("Not found");
      const chat = ref.current.chats.find((c) => c.id === msg.chatId);
      // Try the extractor on this chat; keep the row that used this message.
      const scoped = { ...col, scope: [msg.chatId] };
      const hit = extractLocal(scoped, ref.current.chats, ref.current.messages).find((e) => e.sourceIds.includes(messageId));
      const now = Date.now();
      const values: Record<string, CellValue> = hit?.values ?? {};
      if (!hit) {
        for (const f of col.fields) {
          if (f.type === "date") values[f.key] = isoDate(msg.at);
          else if (f.type === "image") values[f.key] = msg.kind === "image" ? (msg.attachment?.id ?? null) : null;
          else if (f.type === "status") values[f.key] = f.options?.[0] ?? null;
          else if (f.type === "text" && values[col.fields.find((x) => x.type === "text")!.key] === undefined)
            values[f.key] = msg.fromMe ? (chat?.name ?? "") : msg.sender || chat?.name || "";
          else if (f.type === "text" && !Object.values(values).includes(msg.text)) values[f.key] = msg.text.slice(0, 200) || msg.attachment?.name || null;
        }
      }
      const row: Row = {
        id: db.uid("r_"),
        collectionId,
        values,
        chatId: msg.chatId,
        sourceIds: hit?.sourceIds ?? [messageId],
        imageId: msg.kind === "image" ? msg.attachment?.id : hit?.imageId,
        manual: true,
        edited: Object.fromEntries(Object.keys(values).map((k) => [k, true as const])),
        createdAt: now,
        updatedAt: now,
      };
      await db.putMany("rows", [row]);
      setRows((p) => [...p, row]);
      return row.id;
    },
    [],
  );

  /* ------------------------------ Chats ----------------------------- */

  const loadSample = useCallback(async () => {
    await loadGate.promise;
    const { chats: c, messages: m, blobs } = buildSample();
    await db.putMany("blobs", blobs);
    await db.putMany("chats", c);
    await db.putMany("messages", m);
    const nextChats = [...ref.current.chats.filter((x) => x.source !== "sample"), ...c];
    const nextMessages = [...ref.current.messages.filter((x) => !x.chatId.startsWith("sample_")), ...m].sort((a, b) => a.at - b.at);
    setChats(nextChats);
    setMessages(nextMessages);
    ref.current.chats = nextChats;
    ref.current.messages = nextMessages;
    await runAutopilot(nextChats, nextMessages, c.map((x) => x.id));
  }, [runAutopilot, loadGate]);

  const importChat = useCallback(
    async (parsed: ParsedChat, me: string | null, opts?: { into?: string }) => {
      await loadGate.promise;
      const firstImport = !ref.current.chats.some((c) => c.source === "import");
      const existing =
        (opts?.into ? ref.current.chats.find((c) => c.id === opts.into) : undefined) ??
        ref.current.chats.find((c) => c.source === "import" && c.name === parsed.name);
      const chatId = existing?.id ?? db.uid("chat_");
      // Count what is already stored, so a re-import only skips as many identical lines as it already has,
      // while identical lines inside this file (same minute, same sender, e.g. several photos) are all kept.
      const keyOf = (at: number, sender: string, kind: string, text: string, att?: string) => `${at}|${sender}|${kind}|${text}|${att ?? ""}`;
      const existingCount = new Map<string, number>();
      const usedIds = new Set<string>();
      for (const m of ref.current.messages) {
        if (m.chatId !== chatId) continue;
        usedIds.add(m.id);
        const att = m.attachment && !m.attachment.name.endsWith("(not included in export)") ? m.attachment.name : undefined;
        const k = keyOf(m.at, m.sender, m.kind, m.text, att);
        existingCount.set(k, (existingCount.get(k) ?? 0) + 1);
      }
      const blobs: { id: string; blob: Blob }[] = [];
      const fresh: Message[] = [];
      parsed.messages.forEach((pm, i) => {
        const sig = keyOf(pm.at, pm.sender, pm.kind, pm.text, pm.attachmentName);
        const left = existingCount.get(sig) ?? 0;
        if (left > 0) {
          existingCount.set(sig, left - 1);
          return;
        }
        let id = `${chatId}_${pm.at.toString(36)}_${i.toString(36)}`;
        for (let n = 1; usedIds.has(id); n++) id = `${chatId}_${pm.at.toString(36)}_${i.toString(36)}_${n.toString(36)}`;
        usedIds.add(id);
        const msg: Message = { id, chatId, at: pm.at, sender: pm.sender, fromMe: Boolean(me && pm.sender === me), text: pm.text, kind: pm.kind };
        if (pm.attachmentName) {
          const blob = parsed.media.get(pm.attachmentName);
          const blobId = blob ? `${id}_a` : undefined;
          if (blob && blobId) blobs.push({ id: blobId, blob });
          msg.attachment = { id: blobId, name: pm.attachmentName, mime: blob?.type ?? "application/octet-stream", size: blob?.size };
        } else if (pm.kind !== "text" && pm.kind !== "system" && pm.kind !== "deleted") {
          msg.attachment = { name: `${pm.kind} (not included in export)`, mime: "application/octet-stream" };
        }
        fresh.push(msg);
      });
      const all = [...ref.current.messages.filter((m) => m.chatId === chatId), ...fresh].sort((a, b) => a.at - b.at);
      const last = [...all].reverse().find((m) => m.kind !== "system") ?? all[all.length - 1];
      const chat: Chat = {
        id: chatId,
        name: parsed.name,
        isGroup: parsed.isGroup,
        color: existing?.color ?? COLORS[ref.current.chats.length % COLORS.length],
        participants: parsed.senders.filter((s) => s !== me),
        lastAt: last?.at ?? Date.now(),
        preview: last ? previewOf(last, parsed.isGroup) : "",
        unread: (existing?.unread ?? 0) + fresh.filter((m) => !m.fromMe && m.kind !== "system").length,
        pinned: existing?.pinned,
        source: existing?.source ?? "import",
      };
      await db.putMany("blobs", blobs);
      await db.putMany("messages", fresh);
      await db.putMany("chats", [chat]);
      const nextChats = [...ref.current.chats.filter((c) => c.id !== chatId), chat];
      const nextMessages = [...ref.current.messages, ...fresh].sort((a, b) => a.at - b.at);
      setChats(nextChats);
      setMessages(nextMessages);
      ref.current.chats = nextChats;
      ref.current.messages = nextMessages;
      if (me && !ref.current.settings.userName) updateSettings({ userName: me });
      // Guess the currency from the first few amounts — only on the first import, never over a user's choice.
      const sample = parsed.messages.slice(0, 400).map((m) => m.text).join(" ");
      if (firstImport && ref.current.settings.currency === defaultSettings.currency && /\$\s?\d/.test(sample) && !/₹|rs\.?\s?\d/i.test(sample))
        updateSettings({ currency: "USD" });
      await runAutopilot(nextChats, nextMessages, [chatId]);
      return { chatId, added: fresh.length };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runAutopilot, loadGate],
  );

  const deleteChat = useCallback(
    async (id: string) => {
      await loadGate.promise;
      const ids = ref.current.messages.filter((m) => m.chatId === id).map((m) => m.id);
      const blobIds = ref.current.messages.filter((m) => m.chatId === id && m.attachment?.id).map((m) => m.attachment!.id!);
      await db.deleteMany("messages", ids);
      await db.deleteMany("blobs", blobIds);
      await db.deleteMany("chats", [id]);
      const nextChats = ref.current.chats.filter((c) => c.id !== id);
      const nextMessages = ref.current.messages.filter((m) => m.chatId !== id);
      setChats(nextChats);
      setMessages(nextMessages);
      ref.current.chats = nextChats;
      ref.current.messages = nextMessages;
      await runAutopilot(nextChats, nextMessages, [id]);
    },
    [runAutopilot, loadGate],
  );

  const patchChat = useCallback((id: string, fn: (c: Chat) => Chat) => {
    setChats((prev) => {
      const next = prev.map((c) => (c.id === id ? fn(c) : c));
      const c = next.find((x) => x.id === id);
      if (c) db.putMany("chats", [c]);
      return next;
    });
  }, []);
  const markRead = useCallback((id: string) => patchChat(id, (c) => (c.unread ? { ...c, unread: 0 } : c)), [patchChat]);
  const togglePin = useCallback((id: string) => patchChat(id, (c) => ({ ...c, pinned: !c.pinned })), [patchChat]);

  /* ----------------------------- Threads ---------------------------- */

  const saveThread = useCallback((t: Thread) => {
    db.putMany("threads", [t]);
    setThreads((prev) => [t, ...prev.filter((x) => x.id !== t.id)].sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);
  const deleteThread = useCallback((id: string) => {
    db.deleteMany("threads", [id]);
    setThreads((prev) => prev.filter((x) => x.id !== id));
  }, []);

  /* ----------------------------- Settings --------------------------- */

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      db.saveSettings(next);
      ref.current.settings = next;
      return next;
    });
  }, []);

  const resetAll = useCallback(async () => {
    epoch.current++;
    await loadGate.promise;
    await db.clearAll();
    deletedCols.current.clear();
    setChats([]);
    setMessages([]);
    setCollections([]);
    setRows([]);
    setThreads([]);
    setSettings(defaultSettings);
    Object.assign(ref.current, { chats: [], messages: [], collections: [], rows: [], settings: defaultSettings });
  }, [loadGate]);

  const exportBackup = useCallback(async () => {
    try {
      const blobs = await db.getAll("blobs");
      const tooBig = blobs.find((b) => b.blob.size > MAX_BACKUP_BLOB);
      if (tooBig) throw new Error(`A media file is too large to back up (${Math.round(tooBig.blob.size / 1048576)} MB; the limit is ${MAX_BACKUP_BLOB / 1048576} MB per file).`);
      const data = { app: "infera", version: 1, exportedAt: new Date().toISOString(), ...ref.current, threads, cloudAvailable: undefined };
      const head = JSON.stringify(data);
      // Build the file from parts (one base64 string per media file) so no single string grows with the whole library.
      const parts: BlobPart[] = [head.slice(0, -1), ',"media":{'];
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        const base64 = await blobToBase64(b.blob);
        parts.push(`${i ? "," : ""}${JSON.stringify(b.id)}:{"type":${JSON.stringify(b.blob.type)},"data":"`, base64, '"}');
      }
      parts.push("}}");
      return new Blob(parts, { type: "application/json" });
    } catch (e) {
      onError("Backup failed", e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, [threads, onError]);

  const restoreBackup = useCallback(async (file: File) => {
    await loadGate.promise;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error("This backup file is damaged or isn't valid JSON.");
    }
    if (data?.app !== "infera") throw new Error("This isn't an Infera backup file.");
    // Decode and validate everything before touching the database.
    const list = <T,>(v: unknown, what: string): T[] => {
      if (v == null) return [];
      if (!Array.isArray(v)) throw new Error(`The backup's ${what} are damaged.`);
      for (const x of v) if (!x || typeof x !== "object" || typeof (x as { id?: unknown }).id !== "string") throw new Error(`The backup's ${what} are damaged.`);
      return v as T[];
    };
    const chatsIn = list<Chat>(data.chats, "chats");
    const messagesIn = list<Message>(data.messages, "messages");
    const collectionsIn = list<Collection>(data.collections, "collections");
    const rowsIn = list<Row>(data.rows, "collection rows");
    const threadsIn = list<Thread>(data.threads, "assistant threads");
    const mediaIn = data.media ?? {};
    if (typeof mediaIn !== "object" || Array.isArray(mediaIn)) throw new Error("The backup's media is damaged.");
    const blobs = Object.entries(mediaIn as Record<string, unknown>).map(([id, raw]) => {
      const v = raw as { type?: unknown; data?: unknown } | null;
      if (!v || typeof v.data !== "string") throw new Error("The backup's media is damaged.");
      let bin: string;
      try {
        bin = atob(v.data);
      } catch {
        throw new Error("The backup's media is damaged.");
      }
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      // Only keep known display types, so a crafted backup can't smuggle in HTML or script.
      const type = typeof v.type === "string" && SAFE_MEDIA.test(v.type.split(";")[0].trim()) ? v.type : "application/octet-stream";
      return { id, blob: new Blob([bytes], { type }) };
    });
    const rawSettings = data.settings && typeof data.settings === "object" && !Array.isArray(data.settings) ? data.settings : {};
    const s: Settings = { ...defaultSettings, ...rawSettings };
    // Discard any extraction still running against the data being replaced.
    epoch.current++;
    // One transaction: if anything fails, the existing data stays as it was.
    await db.replaceAll({ blobs, chats: chatsIn, messages: messagesIn, collections: collectionsIn, rows: rowsIn, threads: threadsIn, kv: [{ id: "settings", value: s }] });
    deletedCols.current.clear();
    const sortedMessages = [...messagesIn].sort((a, b) => a.at - b.at);
    setChats(chatsIn);
    setMessages(sortedMessages);
    setCollections(collectionsIn);
    setRows(rowsIn);
    setThreads(threadsIn);
    setSettings(s);
    Object.assign(ref.current, { chats: chatsIn, messages: sortedMessages, collections: collectionsIn, rows: rowsIn, settings: s });
  }, [loadGate]);

  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const chatById = useMemo(() => new Map(chats.map((c) => [c.id, c])), [chats]);

  const value: Store = {
    ready,
    chats,
    messages,
    collections,
    rows,
    threads,
    settings,
    cloudAvailable,
    busy,
    messageById,
    chatById,
    useCloud,
    loadSample,
    importChat,
    deleteChat,
    markRead,
    togglePin,
    createCollection,
    updateCollection,
    deleteCollection,
    refreshCollection,
    addRow,
    updateCell,
    deleteRows,
    addMessageToCollection,
    saveThread,
    deleteThread,
    updateSettings,
    resetAll,
    exportBackup,
    restoreBackup,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* --------------------------- Blob object URLs --------------------------- */

const urlCache = new Map<string, string>();

export function useBlobUrl(id?: string | null) {
  const [url, setUrl] = useState<string | null>(id ? (urlCache.get(id) ?? null) : null);
  useEffect(() => {
    if (!id) return setUrl(null);
    const cached = urlCache.get(id);
    if (cached) return setUrl(cached);
    let alive = true;
    db.getBlob(id).then((b) => {
      if (!b || !alive) return;
      const u = URL.createObjectURL(b);
      urlCache.set(id, u);
      setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}

export async function openBlob(id: string, name: string, download = false) {
  const b = await db.getBlob(id);
  if (!b) return false;
  // Never open types that can run script (html, svg, xml, js, unknown) as a same-origin page; download them instead.
  const t = b.type.split(";")[0].trim().toLowerCase();
  const inlineOk = INLINE_OK.test(t);
  if (!inlineOk) download = true;
  const u = URL.createObjectURL(inlineOk ? b : new Blob([b], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = u;
  if (download) a.download = name;
  else a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60_000);
  return true;
}

export type { AssistantMsg };
