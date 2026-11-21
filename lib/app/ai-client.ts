/** Browser side of the optional Claude integration (POST /api/ai). */
import type { CellValue, Chat, Collection, Field, Message, Plan, Row } from "./types";
import type { Extracted } from "./extract";
import { searchMessages } from "./assistant";

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Cloud AI failed.");
  return data as T;
}

export async function cloudStatus(): Promise<boolean> {
  try {
    const res = await fetch("/api/ai", { cache: "no-store" });
    return Boolean((await res.json()).available);
  } catch {
    return false;
  }
}

const stamp = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function line(m: Message, short: string) {
  const who = m.fromMe ? "You" : m.sender || "Unknown";
  const att = m.attachment ? ` [${m.kind}: ${m.attachment.name}]` : m.kind !== "text" ? ` [${m.kind}]` : "";
  return `[${short}] ${stamp(m.at)} ${who}:${att} ${m.text.replace(/\n/g, " ")}`.trimEnd();
}

/** Assigns short IDs (m1, m2…) so the model can cite messages cheaply. */
function idMapper() {
  const toShort = new Map<string, string>();
  const toLong = new Map<string, string>();
  return {
    short(id: string) {
      let s = toShort.get(id);
      if (!s) {
        s = `m${toShort.size + 1}`;
        toShort.set(id, s);
        toLong.set(s, id);
      }
      return s;
    },
    long: (s: string) => toLong.get(s),
  };
}

export async function cloudPlan(prompt: string, chats: Chat[], messages: Message[]): Promise<Plan> {
  const ids = idMapper();
  const names = new Map(chats.map((c) => [c.id, c.name]));
  const recent = [...messages].filter((m) => m.kind !== "system").sort((a, b) => b.at - a.at).slice(0, 200).reverse();
  let sample = "";
  for (const m of recent) {
    const l = `(${names.get(m.chatId)}) ${line(m, ids.short(m.id))}\n`;
    if (sample.length + l.length > 50_000) break;
    sample += l;
  }
  const { plan } = await post<{ plan: Omit<Plan, "template" | "scope"> }>({ action: "plan", prompt, sample });
  const named = chats.filter((c) => c.name.length > 2 && prompt.toLowerCase().includes(c.name.toLowerCase()));
  const seen = new Set<string>();
  return {
    ...plan,
    template: "custom",
    scope: named.length ? named.map((c) => c.id) : "all",
    fields: plan.fields
      .filter((f) => f.key && !seen.has(f.key) && seen.add(f.key))
      .map((f) => ({ ...f, options: f.type === "status" ? f.options : undefined })),
  };
}

function coerce(field: Field, raw: string): CellValue {
  const v = raw.trim();
  if (!v) return null;
  if (field.type === "number" || field.type === "currency") {
    const n = Number(v.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === "status" && field.options?.length) return field.options.find((o) => o.toLowerCase() === v.toLowerCase()) ?? field.options[0];
  if (field.type === "date") return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  return v.slice(0, 500);
}

const BATCH = 180_000;

export async function cloudExtract(col: Collection, chats: Chat[], messages: Message[], onProgress?: (done: number, total: number) => void): Promise<Extracted[]> {
  const scoped = col.scope === "all" ? chats : chats.filter((c) => (col.scope as string[]).includes(c.id));
  const ids = idMapper();
  const blocks: string[] = [];
  for (const chat of scoped) {
    const msgs = messages.filter((m) => m.chatId === chat.id && m.kind !== "system").sort((a, b) => a.at - b.at);
    if (!msgs.length) continue;
    let block = `### Chat id=${chat.id} name="${chat.name}"${chat.isGroup ? " (group)" : ""}\n`;
    for (const m of msgs.slice(-600)) block += line(m, ids.short(m.id)) + "\n";
    blocks.push(block.slice(0, BATCH));
  }
  const batches: string[] = [];
  let cur = "";
  for (const b of blocks) {
    if (cur && cur.length + b.length > BATCH) {
      batches.push(cur);
      cur = "";
    }
    cur += b + "\n";
  }
  if (cur) batches.push(cur);

  const out: Extracted[] = [];
  const fieldByKey = new Map(col.fields.map((f) => [f.key, f]));
  const valid = new Set(scoped.map((c) => c.id));
  for (let i = 0; i < batches.length; i++) {
    onProgress?.(i, batches.length);
    const res = await post<{ rows: { chatId: string; entity: string; values: { key: string; value: string }[]; sourceIds: string[] }[] }>({
      action: "extract",
      name: col.name,
      description: col.description,
      fields: col.fields,
      transcript: batches[i],
    });
    for (const r of res.rows) {
      if (!valid.has(r.chatId)) continue;
      const values: Record<string, CellValue> = Object.fromEntries(col.fields.map((f) => [f.key, null]));
      for (const { key, value } of r.values) {
        const f = fieldByKey.get(key);
        if (f && f.type !== "image") values[key] = coerce(f, value);
      }
      const sourceIds = r.sourceIds.map((s) => ids.long(s)).filter((x): x is string => Boolean(x));
      const imageField = col.fields.find((f) => f.type === "image");
      if (imageField) {
        const img = messages.find((m) => sourceIds.includes(m.id) && m.kind === "image" && m.attachment?.id);
        values[imageField.key] = img?.attachment?.id ?? null;
      }
      out.push({ key: `ai:${r.chatId}:${r.entity.toLowerCase().replace(/\s+/g, " ").trim()}`, chatId: r.chatId, values, sourceIds });
    }
  }
  onProgress?.(batches.length, batches.length);
  return out;
}

export async function cloudAsk(
  question: string,
  ctx: { chats: Chat[]; messages: Message[]; collections: Collection[]; rows: Row[] },
): Promise<{ text: string; citations: string[] }> {
  const ids = idMapper();
  const names = new Map(ctx.chats.map((c) => [c.id, c.name]));
  const hits = searchMessages(question, ctx.messages, ctx.chats, { limit: 150 }).map((h) => h.message);
  const recent = [...ctx.messages].filter((m) => m.kind !== "system").sort((a, b) => b.at - a.at).slice(0, 120);
  const pool = [...new Map([...hits, ...recent].map((m) => [m.id, m])).values()].sort((a, b) => a.at - b.at);
  let context = "";
  for (const m of pool) {
    const l = `(${names.get(m.chatId)}) ${line(m, ids.short(m.id))}\n`;
    if (context.length + l.length > 200_000) break;
    context += l;
  }
  let collections = "";
  for (const c of ctx.collections) {
    const rows = ctx.rows.filter((r) => r.collectionId === c.id).slice(0, 80);
    const fields = c.fields.filter((f) => f.type !== "image");
    collections += `## ${c.name} (${rows.length} rows)\n${fields.map((f) => f.label).join(" | ")}\n`;
    collections += rows.map((r) => fields.map((f) => r.values[f.key] ?? "").join(" | ")).join("\n") + "\n\n";
    if (collections.length > 50_000) break;
  }
  const res = await post<{ answer: string; citations: string[] }>({ action: "ask", question, context, collections });
  return { text: res.answer, citations: res.citations.map((s) => ids.long(s)).filter((x): x is string => Boolean(x)) };
}
