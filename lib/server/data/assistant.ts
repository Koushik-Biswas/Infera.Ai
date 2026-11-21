/**
 * Workspace assistant: plain-language questions over synced chats and collections.
 *
 * Retrieval: each content word of the question is looked up in the blind
 * message index (messages matching more words rank higher), restricted to a
 * time range when the question names one ("today", "last week", "past 30 days");
 * plus matching records and per-collection summaries (counts by status, totals).
 *
 * Answering: with AI, one structured call that may only cite the messages and
 * records it was given (unknown refs are dropped); facts and suggestions are
 * kept apart. Without AI: a rules answer built from the same retrieval.
 * PII is replaced with placeholders before text leaves the server when the
 * workspace has `redactPII` on.
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { AssistantAnswerDTO, CellValue, Field } from "@/lib/shared/types";
import { timeRange, tokens as contentWords } from "@/lib/app/assistant";
import type { Database } from "../db";
import { assistantThreads, collections, conversations, messages, records, workspaces } from "../db/schema";
import { aiConfigured, DATA_RULE, runStructured } from "../ai/client";
import { redactPII, restorePII } from "../ai/redact";
import { newId } from "../ids";
import { settingsOf } from "../pipeline/run";
import { openText, queryTokens, sealText } from "./sealed";
import { tokenFilter } from "./search";
import { collectionStats } from "./stats";

const MAX_MESSAGES = 40;
const MAX_RECORDS = 30;

type Msg = { id: string; conversationId: string; senderName: string; direction: "inbound" | "outbound"; text: string; sentAt: Date; chat: string };
type Rec = { id: string; collection: string; values: Record<string, CellValue>; fields: Field[]; status: string | null; updatedAt: Date };

async function retrieveMessages(db: Database, workspaceId: string, question: string, range: { from: Date; to: Date } | null): Promise<Msg[]> {
  const words = [...new Set(contentWords(question))].filter((w) => w.length >= 2).slice(0, 6);
  const scoped = (extra: ReturnType<typeof and>[]) =>
    db
      .select({ id: messages.id, conversationId: messages.conversationId, senderName: messages.senderName, direction: messages.direction, text: messages.text, sentAt: messages.sentAt, chat: conversations.title })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(messages.workspaceId, workspaceId), sql`${messages.kind} not in ('system', 'deleted')`, ...(range ? [gte(messages.sentAt, range.from), lte(messages.sentAt, range.to)] : []), ...extra))
      .orderBy(desc(messages.sentAt))
      .limit(MAX_MESSAGES);

  const score = new Map<string, { row: Awaited<ReturnType<typeof scoped>>[number]; n: number }>();
  for (const w of words) {
    const t = queryTokens(w);
    if (!t.length) continue;
    for (const row of await scoped([tokenFilter(t)])) {
      const s = score.get(row.id);
      if (s) s.n++;
      else score.set(row.id, { row, n: 1 });
    }
  }
  let rows = [...score.values()].sort((a, b) => b.n - a.n || b.row.sentAt.getTime() - a.row.sentAt.getTime()).map((s) => s.row);
  // "Summarise today" has no searchable words: use the most recent messages in range.
  if (!rows.length && (range || !words.length)) rows = await scoped([]);
  return rows.slice(0, MAX_MESSAGES).map((r) => ({ ...r, text: openText(r.text) }));
}

async function retrieveRecords(db: Database, workspaceId: string, question: string): Promise<Rec[]> {
  const words = contentWords(question).filter((w) => w.length >= 3).slice(0, 6);
  if (!words.length) return [];
  const doc = sql`to_tsvector('simple', ${records.values}::text)`;
  const tsq = sql`to_tsquery('simple', ${words.map((w) => `${w.replace(/[^\p{L}\p{N}]/gu, "")}:*`).filter((w) => w.length > 2).join(" | ") || "x"})`;
  const rows = await db
    .select({ id: records.id, collection: collections.name, values: records.values, fields: collections.fields, status: records.status, updatedAt: records.updatedAt })
    .from(records)
    .innerJoin(collections, eq(collections.id, records.collectionId))
    .where(and(eq(records.workspaceId, workspaceId), isNull(records.deletedAt), isNull(collections.archivedAt), sql`${doc} @@ ${tsq}`))
    .orderBy(desc(sql`ts_rank(${doc}, ${tsq})`), desc(records.updatedAt))
    .limit(MAX_RECORDS);
  return rows;
}

type CollectionSummary = { id: string; name: string; total: number; byStatus: { status: string; count: number }[]; sum: { label: string; value: number } | null };

async function summarizeCollections(db: Database, workspaceId: string): Promise<CollectionSummary[]> {
  const cols = await db.select().from(collections).where(and(eq(collections.workspaceId, workspaceId), isNull(collections.archivedAt))).limit(30);
  if (!cols.length) return [];
  // Two grouped queries for all collections (counts, status split, currency totals).
  const stats = await collectionStats(db, workspaceId, cols);
  return cols.map((c) => {
    const st = stats.get(c.id)!;
    return { id: c.id, name: c.name, total: st.records, byStatus: st.byStatus, sum: st.valueLabel !== null && st.valueSum !== null ? { label: st.valueLabel, value: st.valueSum } : null };
  });
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
const recordLine = (r: Rec) =>
  `${r.collection}: ${r.fields
    .filter((f) => r.values[f.key] !== null && r.values[f.key] !== undefined && r.values[f.key] !== "")
    .map((f) => `${f.label}=${r.values[f.key]}`)
    .join("; ")}`;

const AnswerSchema = z.object({
  answer: z.string().describe("Direct answer in a few short sentences or a short '- ' list. Bold key figures with **."),
  facts: z
    .array(z.object({ text: z.string(), messageRefs: z.array(z.string()).describe("refs like m3"), recordRefs: z.array(z.string()).describe("refs like r2") }))
    .describe("Each factual statement in the answer with the refs that support it"),
  suggestions: z.array(z.string()).describe("Optional next steps or ideas — clearly not facts. 0-3."),
});

export type AskResult = AssistantAnswerDTO & { threadId: string };

export async function ask(db: Database, input: { workspaceId: string; userId: string | null; question: string; threadId?: string | null }): Promise<AskResult> {
  const question = input.question.trim().slice(0, 1000);
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
  const settings = settingsOf(ws?.settings);
  const r = timeRange(question);
  const range = r ? { from: new Date(r.from), to: new Date(r.to) } : null;

  const [msgs, recs, summaries] = await Promise.all([retrieveMessages(db, input.workspaceId, question, range), retrieveRecords(db, input.workspaceId, question), summarizeCollections(db, input.workspaceId)]);
  const citationOf = (m: Msg) => ({ messageId: m.id, text: m.text.slice(0, 500), senderName: m.direction === "outbound" ? "You" : m.senderName, sentAt: m.sentAt.toISOString(), conversationId: m.conversationId });

  let out: AssistantAnswerDTO | null = null;
  if (aiConfigured() && settings.aiMode !== "off" && (msgs.length || recs.length || summaries.length)) {
    try {
      const msgLines = msgs.map((m, i) => `[m${i + 1}] ${fmtDate(m.sentAt)} · ${m.chat} · ${m.direction === "outbound" ? "You" : m.senderName}: ${m.text.slice(0, 600)}`);
      const recLines = recs.map((x, i) => `[r${i + 1}] ${recordLine(x)}`.slice(0, 600));
      const sumLines = summaries.map((c) => `${c.name}: ${c.total} records${c.byStatus.length ? ` (${c.byStatus.map((s) => `${s.status} ${s.count}`).join(", ")})` : ""}${c.sum ? `; total ${c.sum.label} ${c.sum.value}` : ""}`);
      const red = settings.redactPII ? redactPII([...msgLines, ...recLines]) : { texts: [...msgLines, ...recLines], map: new Map<string, string>() };
      const { output } = await runStructured({
        schema: AnswerSchema,
        purpose: "assistant",
        workspaceId: input.workspaceId,
        effort: "low",
        maxTokens: 3000,
        system: `You are Infera's assistant. Answer questions about a business's chats and the collections (tables) built from them, using ONLY the provided messages [m#], records [r#] and collection summaries. If the answer isn't there, say so briefly. Be specific: names, amounts, dates. Today is ${new Date().toDateString()} (timezone ${settings.timezone}, currency ${settings.currency}). ${DATA_RULE}`,
        user: `<collections>\n${sumLines.join("\n") || "(none)"}\n</collections>\n<records>\n${red.texts.slice(msgLines.length).join("\n") || "(none)"}\n</records>\n<messages>\n${red.texts.slice(0, msgLines.length).join("\n") || "(none)"}\n</messages>\n<question>${question}</question>`,
      });
      const restored = restorePII(output, red.map);
      const mRef = (ref: string) => msgs[Number(ref.replace(/\D/g, "")) - 1]?.id;
      const rRef = (ref: string) => recs[Number(ref.replace(/\D/g, "")) - 1]?.id;
      const facts = restored.facts.map((f) => ({ text: f.text, messageIds: f.messageRefs.map(mRef).filter((x): x is string => Boolean(x)), recordIds: f.recordRefs.map(rRef).filter((x): x is string => Boolean(x)) }));
      const cited = new Set(facts.flatMap((f) => f.messageIds));
      out = { answer: restored.answer, facts, suggestions: restored.suggestions.slice(0, 3), citations: msgs.filter((m) => cited.has(m.id)).slice(0, 8).map(citationOf), engine: "ai" };
    } catch {
      out = null; // fall back to rules below
    }
  }

  if (!out) {
    const lines: string[] = [];
    const mentioned = summaries.filter((c) => question.toLowerCase().includes(c.name.toLowerCase()) || contentWords(question).some((w) => c.name.toLowerCase().startsWith(w.replace(/s$/, ""))));
    for (const c of mentioned) {
      lines.push(`**${c.name}**: ${c.total} record${c.total === 1 ? "" : "s"}${c.byStatus.length ? ` — ${c.byStatus.map((s) => `${s.status} ${s.count}`).join(", ")}` : ""}${c.sum ? `; total ${c.sum.label} **${c.sum.value.toLocaleString("en-IN")}**` : ""}.`);
    }
    if (recs.length) lines.push(`Matching records:\n${recs.slice(0, 5).map((x) => `- ${recordLine(x)}`).join("\n")}`);
    if (msgs.length) lines.push(`${msgs.length} message${msgs.length === 1 ? "" : "s"} ${range ? `${r!.label} ` : ""}match. Most relevant:\n${msgs.slice(0, 5).map((m) => `- ${m.direction === "outbound" ? "You" : m.senderName} (${m.chat}): ${m.text.replace(/\s+/g, " ").slice(0, 140)}`).join("\n")}`);
    out = {
      answer: lines.length ? lines.join("\n\n") : "I couldn't find anything about that in your chats or collections yet.",
      facts: [],
      suggestions: aiConfigured() ? [] : ["Turn on AI (ANTHROPIC_API_KEY) for written answers instead of search results."],
      citations: msgs.slice(0, 8).map(citationOf),
      engine: "rules",
    };
  }

  // Thread history — sealed like messages (answers can quote chat text).
  const now = new Date().toISOString();
  const entry = [
    { role: "user" as const, text: sealText(question), at: now },
    { role: "assistant" as const, text: sealText(out.answer), at: now, data: { citations: out.citations.map((c) => c.messageId), engine: out.engine } },
  ];
  let threadId = input.threadId ?? null;
  if (threadId) {
    const updated = await db
      .update(assistantThreads)
      .set({ messages: sql`${assistantThreads.messages} || ${JSON.stringify(entry)}::jsonb`, updatedAt: new Date() })
      .where(and(eq(assistantThreads.id, threadId), eq(assistantThreads.workspaceId, input.workspaceId)))
      .returning({ id: assistantThreads.id });
    if (!updated.length) threadId = null;
  }
  if (!threadId) {
    threadId = newId("thr");
    await db.insert(assistantThreads).values({ id: threadId, workspaceId: input.workspaceId, userId: input.userId, title: sealText(question.slice(0, 80)), messages: entry });
  }
  return { ...out, threadId };
}
