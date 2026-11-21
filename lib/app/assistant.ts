/**
 * On-device assistant: search, collection planning from a prompt, and
 * answers over chats and collections. Used when cloud AI is off.
 */
import type { Chat, Collection, Field, Message, Plan, Row } from "./types";
import { templateById, templates } from "./templates";
import { extractLocal, findUrls } from "./extract";

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

const STOP = new Set(
  "a an the and or of to in on for with from by at is are was were be been it this that these those my me i you your our we us show find get list all any what which who where when how many much did do does have has please can could would tell give about there their them".split(
    " ",
  ),
);

export function tokens(q: string) {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export type Hit = { message: Message; score: number };

export function searchMessages(query: string, messages: Message[], chats: Chat[], opts: { kinds?: string[]; chatId?: string; from?: number; to?: number; limit?: number } = {}): Hit[] {
  const toks = tokens(query);
  const chatName = new Map(chats.map((c) => [c.id, c.name.toLowerCase()]));
  const hits: Hit[] = [];
  for (const m of messages) {
    if (m.kind === "system") continue;
    if (opts.kinds && !opts.kinds.includes(m.kind) && !(opts.kinds.includes("link") && findUrls(m.text).length)) continue;
    if (opts.chatId && m.chatId !== opts.chatId) continue;
    if (opts.from && m.at < opts.from) continue;
    if (opts.to && m.at > opts.to) continue;
    if (!toks.length) {
      hits.push({ message: m, score: 0 });
      continue;
    }
    const hay = `${m.text} ${m.attachment?.name ?? ""}`.toLowerCase();
    const who = `${m.sender} ${chatName.get(m.chatId) ?? ""}`.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const t of toks) {
      if (new RegExp(`\\b${escape(t)}\\b`).test(hay)) {
        score += 3;
        matched++;
      } else if (hay.includes(t)) {
        score += 1.5;
        matched++;
      } else if (t.length > 4 && hay.includes(t.slice(0, -1))) {
        score += 1;
        matched++;
      } else if (who.includes(t)) {
        score += 1.2;
        matched++;
      }
    }
    if (!matched) continue;
    score *= matched / toks.length;
    hits.push({ message: m, score });
  }
  hits.sort((a, b) => b.score - a.score || b.message.at - a.message.at);
  return hits.slice(0, opts.limit ?? 200);
}

export const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ------------------------------------------------------------------ */
/*  Time ranges                                                        */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000;
function startOfDay(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function timeRange(q: string, now = Date.now()): { from: number; to: number; label: string } | null {
  const t = q.toLowerCase();
  const today = startOfDay(now);
  if (/\btoday\b/.test(t)) return { from: today, to: now, label: "today" };
  if (/\byesterday\b/.test(t)) return { from: today - DAY, to: today, label: "yesterday" };
  if (/\bthis week\b/.test(t)) {
    const dow = (new Date(now).getDay() + 6) % 7;
    return { from: today - dow * DAY, to: now, label: "this week" };
  }
  if (/\blast week\b/.test(t)) {
    const dow = (new Date(now).getDay() + 6) % 7;
    return { from: today - (dow + 7) * DAY, to: today - dow * DAY, label: "last week" };
  }
  if (/\bthis month\b/.test(t)) {
    const d = new Date(now);
    return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: now, label: "this month" };
  }
  if (/\b(last|past) month\b/.test(t)) return { from: today - 30 * DAY, to: now, label: "in the last 30 days" };
  const n = t.match(/\b(?:last|past)\s+(\d{1,3})\s+days?\b/);
  if (n) return { from: today - Number(n[1]) * DAY, to: now, label: `in the last ${n[1]} days` };
  return null;
}

/* ------------------------------------------------------------------ */
/*  Planning                                                           */
/* ------------------------------------------------------------------ */

export const CREATE_INTENT =
  /\b(create|make|build|set ?up|start|organi[sz]e|track|extract|turn\b.*\binto|put\b.*\binto|generate|new)\b[\s\S]*\b(collection|table|sheet|spreadsheet|list|tracker|database|crm|register|log)\b|^\s*(track|organi[sz]e|extract|collect)\b|@\w+/i;

function titleFrom(prompt: string): string | null {
  const at = prompt.match(/@([A-Za-z][\w-]*)/);
  if (at) return at[1].replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
  const q = prompt.match(/(?:titled|called|named)\s+["“']?([^"”'\n.]{2,40})["”']?/i);
  if (q) return q[1].trim();
  const subj = prompt.match(
    /\b(?:track|organi[sz]e|extract|collect|list|log|create (?:a |an )?(?:collection|table|sheet|list|tracker) (?:of|for|with)|make (?:a |an )?(?:collection|table|sheet|list|tracker) (?:of|for))\s+(?:all\s+|my\s+|the\s+|every\s+)*([a-z][a-z\s-]{2,40}?)(?=\s+(?:with|from|in|that|which|including|and their|by|for)\b|[,.]|$)/i,
  );
  if (!subj) return null;
  const words = subj[1].trim().split(/\s+/).slice(0, 4).join(" ");
  if (/^(chats?|messages?|conversations?|data|everything)$/i.test(words)) return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "with budget, BHK and locality" -> ["budget", "BHK", "locality"] */
function requestedColumns(prompt: string): string[] {
  const m = prompt.match(/\b(?:with|including|columns?|fields?)\s*:?\s+(.+)$/i);
  if (!m) return [];
  return m[1]
    .split(/,|\band\b|&|\//i)
    .map((s) => s.replace(/\b(the|their|its|a|an|of each|each)\b/gi, "").trim())
    .filter((s) => s.length > 1 && s.length < 30 && s.split(/\s+/).length <= 3);
}

function customField(label: string): Field {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field";
  return { key, label: label.length <= 4 ? label.toUpperCase() : label.charAt(0).toUpperCase() + label.slice(1), type: "text", description: `${label} mentioned in the chat.` };
}

const FIELD_HINTS: [RegExp, Field][] = [
  [/\bname|customer|client|buyer\b/i, { key: "name", label: "Name", type: "text", description: "Person or business name." }],
  [/\bphone|number|mobile|contact\b/i, { key: "phone", label: "Phone", type: "phone", description: "Phone number." }],
  [/\bemail\b/i, { key: "email", label: "Email", type: "email", description: "Email address." }],
  [/\bproduct|item|purchase|requirement|service|property\b/i, { key: "item", label: "Item", type: "text", description: "Product, service or property discussed." }],
  [/\bqty|quantity|units?\b/i, { key: "qty", label: "Qty", type: "number", description: "Quantity." }],
  [/\bprice|amount|budget|cost|value|total\b/i, { key: "amount", label: "Amount", type: "currency", description: "Price or amount discussed." }],
  [/\blocation|city|area|address|place\b/i, { key: "location", label: "Location", type: "location", description: "Locality, city or area." }],
  [/\bsize\b/i, { key: "size", label: "Size", type: "text", description: "Size mentioned." }],
  [/\bcolou?r\b/i, { key: "color", label: "Colour", type: "text", description: "Colour mentioned." }],
  [/\bdue|deadline|delivery date|visit date|appointment\b/i, { key: "due", label: "Due", type: "date", description: "Date mentioned for delivery, visit or deadline." }],
  [/\bphoto|image|picture\b/i, { key: "image", label: "Photo", type: "image", description: "Latest photo shared." }],
  [/\bnotes?|summary|details?|remarks?\b/i, { key: "notes", label: "Notes", type: "text", description: "Latest relevant message." }],
];

/** Builds a collection plan from a natural-language prompt. */
export function planFromPrompt(prompt: string, chats: Chat[]): Plan {
  const title = titleFrom(prompt);
  // Restrict to chats named in the prompt ("from Kochi Retail Group").
  const named = chats.filter((c) => c.name.length > 2 && prompt.toLowerCase().includes(c.name.toLowerCase()));
  const scope: Plan["scope"] = named.length ? named.map((c) => c.id) : "all";
  const hay = `${prompt} ${title ?? ""}`;
  const tpl = templates.find((t) => t.keywords.test(hay));
  if (tpl) {
    // Extra columns asked for that the template doesn't cover ("…with colour, size and BHK").
    const covered = (s: string) => tpl.fields.some((x) => new RegExp(`\\b${escape(s)}`, "i").test(`${x.key} ${x.label} ${x.description}`));
    const extras: Field[] = [];
    for (const col of requestedColumns(prompt)) {
      if (covered(col)) continue;
      const hint = FIELD_HINTS.find(([re]) => re.test(col))?.[1];
      if (hint && tpl.fields.some((x) => x.type === hint.type && hint.type !== "text")) continue;
      const f = hint ?? customField(col);
      if (!extras.some((e) => e.key === f.key) && !tpl.fields.some((x) => x.key === f.key)) extras.push(f);
    }
    return {
      name: title ?? tpl.name,
      description: tpl.description,
      icon: tpl.icon,
      template: extras.length ? "custom" : tpl.id,
      fields: extras.length ? [...tpl.fields, ...extras] : tpl.fields,
      scope,
    };
  }
  const fields = FIELD_HINTS.filter(([re]) => re.test(prompt)).map(([, f]) => f);
  for (const col of requestedColumns(prompt)) {
    if (FIELD_HINTS.some(([re]) => re.test(col))) continue;
    const f = customField(col);
    if (!fields.some((x) => x.key === f.key)) fields.push(f);
  }
  if (!fields.some((f) => f.key === "name")) fields.unshift(FIELD_HINTS[0][1]);
  fields.push({ key: "status", label: "Status", type: "status", description: "Where it stands.", options: ["New", "In progress", "Done"] });
  fields.push({ key: "date", label: "Last message", type: "date", description: "Date of the latest message." });
  return {
    name: title ?? "My collection",
    description: `Built from your request: “${prompt.trim().slice(0, 120)}”`,
    icon: "table",
    template: "custom",
    fields,
    scope,
  };
}

/* ------------------------------------------------------------------ */
/*  Answers                                                            */
/* ------------------------------------------------------------------ */

const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);

export type Answer = { text: string; citations?: string[]; plan?: Plan; collectionId?: string; steps: string[] };

type Ctx = { chats: Chat[]; messages: Message[]; collections: Collection[]; rows: Row[]; currency: string };

const fmtMoney = (n: number, currency: string) =>
  new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

const when = (t: number) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function answerLocally(q: string, ctx: Ctx): Answer {
  const steps: string[] = ["Understanding your request"];
  const lower = q.toLowerCase();
  const chatById = new Map(ctx.chats.map((c) => [c.id, c]));

  if (!ctx.messages.length) {
    return {
      steps,
      text: "You don't have any chats yet. **Import a WhatsApp chat** (Chats → Import) or load the sample workspace, then ask me again.",
    };
  }

  // 1. Create a collection
  if (CREATE_INTENT.test(q)) {
    steps.push("Analysing your conversations", "Designing the collection");
    const plan = planFromPrompt(q, ctx.chats);
    const scopeText = plan.scope === "all" ? "all your chats" : plan.scope.map((id) => chatById.get(id)?.name).join(", ");
    return {
      steps,
      plan,
      text: `I'll analyse ${scopeText} and organise them into **${plan.name}**. Here's the plan — review the fields, then accept to build it.`,
    };
  }

  const range = timeRange(q);
  const inRange = (t: number) => !range || (t >= range.from && t <= range.to);
  const namedChat = ctx.chats
    .filter((c) => lower.includes(c.name.toLowerCase()) || c.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && new RegExp(`\\b${escape(w)}\\b`).test(lower)))
    .sort((a, b) => b.name.length - a.name.length)[0];

  // 2. Summaries
  if (/\b(summari[sz]e|summary|recap|catch me up|what happened|what did .* say|what'?s new)\b/i.test(q)) {
    steps.push(namedChat ? `Reading ${namedChat.name}` : "Reading recent chats");
    const msgs = ctx.messages
      .filter((m) => m.kind !== "system" && (!namedChat || m.chatId === namedChat.id) && inRange(m.at))
      .sort((a, b) => a.at - b.at);
    if (!msgs.length) return { steps, text: `No messages ${range?.label ?? "found"}${namedChat ? ` in ${namedChat.name}` : ""}.` };
    const byChat = new Map<string, Message[]>();
    for (const m of msgs) byChat.set(m.chatId, [...(byChat.get(m.chatId) ?? []), m]);
    const lines: string[] = [];
    const cites: string[] = [];
    for (const [chatId, list] of [...byChat].sort((a, b) => b[1][b[1].length - 1].at - a[1][a[1].length - 1].at).slice(0, 6)) {
      const c = chatById.get(chatId);
      const theirs = list.filter((m) => !m.fromMe && m.text);
      const media = list.filter((m) => ["image", "video", "audio", "document"].includes(m.kind)).length;
      const key = theirs.slice(-2).map((m) => `“${m.text.slice(0, 90)}”`);
      cites.push(...theirs.slice(-2).map((m) => m.id));
      lines.push(`- **${c?.name}** — ${list.length} ${plural(list.length, "message")}${media ? `, ${media} ${plural(media, "file")}` : ""}. ${key.join(" ")}`);
    }
    return {
      steps,
      citations: cites.slice(0, 8),
      text: `Here's ${range ? `what happened ${range.label}` : namedChat ? `the latest from ${namedChat.name}` : "the latest across your chats"}:\n${lines.join("\n")}`,
    };
  }

  // 3. Collection questions (counts, totals, statuses)
  const aboutFiles = /\b(pdf|file|document|photo|image|picture|link)s?\b/i.test(q);
  let col =
    ctx.collections.find((c) => lower.includes(c.name.toLowerCase())) ??
    ctx.collections.find((c) => templateById[c.template]?.keywords.test(q) && !aboutFiles);
  let virtualRows: Row[] | null = null;
  if (!col && !aboutFiles) {
    // No collection yet: build a temporary one from the chats so the question still gets a real answer.
    const tpl = templates.find((t) => ["orders", "payments", "leads", "tasks", "support"].includes(t.id) && t.keywords.test(q));
    if (tpl) {
      const temp: Collection = { id: `virtual_${tpl.id}`, name: tpl.name, description: tpl.description, icon: tpl.icon, template: tpl.id, fields: tpl.fields, autopilot: false, scope: "all", view: "table", engine: "local", createdAt: 0, updatedAt: 0 };
      col = temp;
      virtualRows = extractLocal(temp, ctx.chats, ctx.messages).map((e, i) => ({
        id: `v${i}`,
        collectionId: temp.id,
        key: e.key,
        values: e.values,
        chatId: e.chatId,
        sourceIds: e.sourceIds,
        createdAt: 0,
        updatedAt: 0,
      }));
      steps.push(`Extracting ${tpl.name.toLowerCase()} from your chats`);
    }
  }
  if (col) {
    if (!virtualRows) steps.push(`Looking in ${col.name}`);
    const colId = col.id;
    const rows = virtualRows ?? ctx.rows.filter((r) => r.collectionId === colId);
    const statusField = col.fields.find((f) => f.type === "status");
    const moneyField = col.fields.find((f) => f.type === "currency");
    const dateField = col.fields.find((f) => f.type === "date");
    let filtered = rows;
    let statusLabel = "";
    if (statusField) {
      const opts = statusField.options ?? [];
      const synonyms: Record<string, RegExp> = {
        Pending: /\b(pending|unpaid|due|owe|outstanding|not paid)\b/i,
        "New order": /\b(new|fresh|unprocessed)\b/i,
        "To do": /\b(open|pending|to ?do|not done|remaining)\b/i,
        Open: /\b(open|unresolved|pending)\b/i,
      };
      const hit = opts.find((o) => new RegExp(`\\b${escape(o.toLowerCase())}\\b`).test(lower)) ?? opts.find((o) => synonyms[o]?.test(q));
      if (hit) {
        filtered = filtered.filter((r) => r.values[statusField.key] === hit);
        statusLabel = hit.toLowerCase();
      } else if (/\bunpaid|not paid|pending\b/i.test(q) && opts.includes("Paid")) {
        filtered = filtered.filter((r) => !/paid|delivered|shipped|packed|cancel/i.test(String(r.values[statusField.key] ?? "")));
        statusLabel = "unpaid";
      }
    }
    if (range && dateField) {
      filtered = filtered.filter((r) => {
        const v = r.values[dateField.key];
        const t = v ? new Date(String(v) + "T12:00:00").getTime() : 0;
        return t >= range.from - DAY && t <= range.to + DAY;
      });
    }
    if (namedChat) filtered = filtered.filter((r) => r.chatId === namedChat.id);
    const title = col.fields[0];
    const total = moneyField ? filtered.reduce((s, r) => s + (Number(r.values[moneyField.key]) || 0), 0) : 0;
    const head = `${filtered.length} ${statusLabel ? statusLabel + " " : ""}${plural(filtered.length, "entry", "entries")} in **${col.name}**${range ? ` ${range.label}` : ""}${namedChat ? ` from ${namedChat.name}` : ""}${moneyField && total ? `, totalling **${fmtMoney(total, ctx.currency)}**` : ""}.`;
    const list = filtered
      .slice(0, 8)
      .map((r) => {
        const bits = col.fields
          .filter((f) => f !== title && f.type !== "image" && r.values[f.key] != null && r.values[f.key] !== "")
          .slice(0, 3)
          .map((f) => (f.type === "currency" ? fmtMoney(Number(r.values[f.key]), ctx.currency) : String(r.values[f.key])));
        return `- **${r.values[title.key] ?? "—"}** · ${bits.join(" · ")}`;
      })
      .join("\n");
    const tip = virtualRows ? `\n\nTip: ask me to “create a collection of ${col.name.toLowerCase()}” to keep this as a live, auto-updating table.` : "";
    return {
      steps,
      collectionId: virtualRows ? undefined : col.id,
      citations: filtered.flatMap((r) => r.sourceIds.slice(-1)).slice(0, 6),
      text: (filtered.length ? `${head}\n${list}${filtered.length > 8 ? `\n…and ${filtered.length - 8} more.` : ""}` : head.replace(/^0/, "No")) + tip,
    };
  }

  // 4. Files, photos, links
  const kindMap: [RegExp, string[], string][] = [
    [/\b(pdfs?|documents?|docs?|files?|invoices?|catalog(?:ue)?s?|brochures?|sheets?)\b/i, ["document"], "documents"],
    [/\b(photos?|images?|pictures?|pics?|screenshots?)\b/i, ["image"], "photos"],
    [/\b(videos?)\b/i, ["video"], "videos"],
    [/\b(voice notes?|voice messages?|audios?)\b/i, ["audio"], "voice notes"],
    [/\b(links?|urls?|websites?)\b/i, ["link"], "links"],
    [/\b(contacts? cards?|vcards?)\b/i, ["contact"], "contact cards"],
  ];
  const km = kindMap.find(([re]) => re.test(q));
  if (km) {
    steps.push(`Searching ${km[2]}`);
    const rest = q.replace(km[0], " ").replace(/\b(find|show|where|is|the|me|send|get|all|latest|last)\b/gi, " ");
    let hits = searchMessages(rest, ctx.messages, ctx.chats, { kinds: km[1], chatId: namedChat?.id, from: range?.from, to: range?.to, limit: 12 });
    if (!hits.length && tokens(rest).length) hits = searchMessages("", ctx.messages, ctx.chats, { kinds: km[1], chatId: namedChat?.id, limit: 8 });
    hits.sort((a, b) => b.score - a.score || b.message.at - a.message.at);
    if (!hits.length) return { steps, text: `I couldn't find any ${km[2]}${namedChat ? ` in ${namedChat.name}` : ""}${range ? ` ${range.label}` : ""}.` };
    return {
      steps,
      citations: hits.slice(0, 8).map((h) => h.message.id),
      text: `Found ${hits.length} ${hits.length === 1 ? km[2].replace(/s$/, "") : km[2]}${namedChat ? ` in ${namedChat.name}` : ""}${range ? ` ${range.label}` : ""}. Tap one to open it in its chat.`,
    };
  }

  // 5. General search
  steps.push("Searching your chats");
  const hits = searchMessages(q, ctx.messages, ctx.chats, { chatId: namedChat?.id, from: range?.from, to: range?.to, limit: 8 });
  if (!hits.length) {
    return {
      steps,
      text: `I couldn't find messages about that. Try different words, or ask me to **create a collection** — for example “Create a collection of all orders”.`,
    };
  }
  const top = hits[0].message;
  return {
    steps,
    citations: hits.map((h) => h.message.id),
    text: `The best match is from **${chatById.get(top.chatId)?.name}** (${when(top.at)}): “${top.text.slice(0, 160)}”${hits.length > 1 ? `\n\n${hits.length - 1} more related messages below.` : ""}`,
  };
}
