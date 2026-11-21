/**
 * Tiny promise wrapper around IndexedDB. All user data (chats, messages,
 * media, collections) lives here, on the user's device.
 */
import type { Chat, Collection, Message, Row, Settings, Thread } from "./types";

const DB_NAME = "infera";
const DB_VERSION = 1;

type Stores = {
  chats: Chat;
  messages: Message;
  collections: Collection;
  rows: Row;
  threads: Thread;
  blobs: { id: string; blob: Blob };
  kv: { id: string; value: unknown };
};
export type StoreName = keyof Stores;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ["chats", "collections", "threads", "blobs", "kv"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("messages")) {
        db.createObjectStore("messages", { keyPath: "id" }).createIndex("chatId", "chatId");
      }
      if (!db.objectStoreNames.contains("rows")) {
        db.createObjectStore("rows", { keyPath: "id" }).createIndex("collectionId", "collectionId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getAll<K extends StoreName>(store: K): Promise<Stores[K][]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as Stores[K][]);
    req.onerror = () => reject(req.error);
  });
}

export async function get<K extends StoreName>(store: K, id: string): Promise<Stores[K] | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result as Stores[K] | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function putMany<K extends StoreName>(store: K, items: Stores[K][]) {
  if (!items.length) return;
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  for (const item of items) os.put(item);
  await done(tx);
}

export async function deleteMany(store: StoreName, ids: string[]) {
  if (!ids.length) return;
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  for (const id of ids) os.delete(id);
  await done(tx);
}

export async function clearAll() {
  const db = await open();
  const names: StoreName[] = ["chats", "messages", "collections", "rows", "threads", "blobs", "kv"];
  const tx = db.transaction(names, "readwrite");
  for (const n of names) tx.objectStore(n).clear();
  await done(tx);
}

/**
 * Atomically replaces every store's contents. Clear and puts run in one
 * transaction, so any failure (quota, bad key) aborts and keeps the old data.
 */
export async function replaceAll(data: { [K in StoreName]?: Stores[K][] }) {
  const db = await open();
  const names: StoreName[] = ["chats", "messages", "collections", "rows", "threads", "blobs", "kv"];
  const tx = db.transaction(names, "readwrite");
  const finished = done(tx);
  try {
    for (const n of names) {
      const os = tx.objectStore(n);
      os.clear();
      for (const item of data[n] ?? []) os.put(item as never);
    }
  } catch (e) {
    try {
      tx.abort();
    } catch {}
    await finished.catch(() => {});
    throw e;
  }
  await finished;
}

export async function putBlob(id: string, blob: Blob) {
  await putMany("blobs", [{ id, blob }]);
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return (await get("blobs", id))?.blob;
}

export async function getSetting(): Promise<Partial<Settings>> {
  const rec = await get("kv", "settings");
  return (rec?.value as Partial<Settings>) ?? {};
}

export async function saveSettings(s: Settings) {
  await putMany("kv", [{ id: "settings", value: s }]);
}

export function uid(prefix = "") {
  const r =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + r;
}
