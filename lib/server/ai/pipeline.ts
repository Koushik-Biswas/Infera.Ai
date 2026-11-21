/**
 * AI step of the processing pipeline (step 4): ONE structured call that
 * classifies the message and extracts field values for the workspace's
 * collections, with the recent conversation as context (rule 17).
 *
 * Guarantees for the caller:
 *  - The model sees message text as untrusted data (DATA_RULE) rendered as
 *    JSON strings, so it cannot break out of the prompt structure.
 *  - Messages and collections are referenced by short indexes (m0..mN, c1..cN);
 *    the model never sees or produces database ids.
 *  - Phone numbers / emails are replaced by placeholders when the workspace
 *    enables `redactPII`, and restored in the output.
 *  - Every value comes with a confidence and a verbatim evidence quote, which
 *    the pipeline verifies before using it (pipeline/verify-evidence.ts).
 */
import { z } from "zod";
import { CATEGORIES, INTENTS, PRIORITIES, type CellValue, type Field, type Category, type Intent, type Priority } from "@/lib/shared/types";
import { DATA_RULE, runStructured } from "./client";
import { redactPII, restorePII } from "./redact";

const AiEntity = z.object({
  field: z.string(),
  value: z.string().nullable(),
  confidence: z.number(),
  evidence: z.string().nullable(),
  message: z.string().nullable(),
});

const AiOutput = z.object({
  category: z.enum(CATEGORIES),
  intent: z.enum(INTENTS),
  priority: z.enum(PRIORITIES),
  confidence: z.number(),
  collections: z.array(z.object({ collection: z.string(), fields: z.array(AiEntity) })),
  suggestions: z.array(z.object({ type: z.enum(["follow_up", "reply"]), text: z.string() })),
});

export type PipelineAiInput = {
  workspaceId: string;
  currency: string;
  timezone: string;
  redact: boolean;
  /** Pre-formatted local timestamps keep the prompt deterministic and timezone-correct. */
  message: { text: string; senderName: string; direction: "inbound" | "outbound"; sentAtLocal: string; kind: string; attachments: string[]; source: string };
  /** Oldest first; referenced as m1 (most recent) … mN (oldest). */
  context: { text: string; senderName: string; direction: "inbound" | "outbound"; sentAtLocal: string }[];
  collections: { ref: string; name: string; description: string; fields: Field[] }[];
  openRecords: { collectionRef: string; values: Record<string, CellValue> }[];
};

export type PipelineAiEntity = { collectionRef: string; field: string; value: string | null; confidence: number; evidence: string | null; messageRef: string | null };

export type PipelineAiOutput = {
  classification: { category: Category; intent: Intent; priority: Priority; confidence: number };
  entities: PipelineAiEntity[];
  suggestions: { type: "follow_up" | "reply"; text: string }[];
  model: string;
};

const SYSTEM = `You are the extraction engine of Infera, a system that turns business conversations (WhatsApp, Telegram, email, Slack, SMS) into structured records.
${DATA_RULE}

Analyse the message labelled m0. Earlier messages (m1 = most recent, higher numbers = older) are context only. Return:

1. Classification of m0:
   - category: sales_enquiry (asking about products, prices, availability), order (placing, changing, cancelling or tracking an order), payment (payment made, promised, requested or refunded), support (complaint, problem, refund request, delivery issue), follow_up (a request or promise to do something), appointment (meeting, visit or call scheduling), contact_share, document_share (files, photos, links), feedback, spam (unsolicited promotions, scams), general (greetings, acknowledgements, anything else).
   - intent: the closest listed intent.
   - priority: urgent (explicit urgency, emergencies, legal threats, angry refund demands), high (ready to buy with a budget or quantity, new orders, complaints, payment problems), medium, low (greetings, acknowledgements, chit-chat, spam).
   - confidence: 0 to 1.

2. collections: for each listed collection that m0 is relevant to, the field values m0 states (use earlier messages only when m0 clearly refers back to them, e.g. "paid the total"):
   - value: the value as plain text — numbers as digits only ("1200", "50000"), dates as YYYY-MM-DD resolved against the date of the message that states them, status values copied exactly from the listed options. Use null when the value is not stated. Never guess, estimate, compute totals that are not stated, or fill in typical values.
   - evidence: a short exact quote (at most about 20 words) copied character for character from the message that states the value. Never paraphrase or translate. Use null only when the value comes from the sender details rather than the text.
   - message: the label (m0, m1, …) of the message the evidence is quoted from.
   - confidence: 0 to 1 — how sure you are the value is stated and correct.
   Leave out collections m0 is not about and fields that are not stated. Only use the message labels given. Never output database ids, record ids or URLs that are not in the messages.

3. suggestions: at most two short follow-up actions or reply ideas for the business, or an empty list. They are shown as AI suggestions, never stored as facts.

Placeholders such as [PHONE_1] or [EMAIL_1] stand for redacted personal data; copy them exactly if you quote them.`;

const q = (s: string) => JSON.stringify(s);

function fieldLine(f: Field): string {
  const bits: string[] = [f.type];
  if (f.required) bits.push("required");
  if (f.type === "status" && f.options?.length) bits.push(`one of: ${f.options.map(q).join(", ")}`);
  return `  - ${f.key} (${bits.join("; ")}): ${f.label}${f.description ? ` — ${f.description}` : ""}`;
}

export function renderPipelinePrompt(input: PipelineAiInput, texts: { message: string; context: string[]; senderNames: string[]; openRecords: string[] }): string {
  const lines: string[] = [];
  lines.push(`Workspace: currency ${input.currency}, timezone ${input.timezone}.`);
  lines.push("");
  lines.push("Collections:");
  for (const c of input.collections) {
    lines.push(`${c.ref} ${q(c.name)}${c.description ? ` — ${c.description}` : ""}`);
    for (const f of c.fields) lines.push(fieldLine(f));
  }
  if (input.openRecords.length) {
    lines.push("");
    lines.push("Open records of this contact (current values, context only):");
    input.openRecords.forEach((r, i) => lines.push(`${r.collectionRef}: ${texts.openRecords[i]}`));
  }
  const n = input.context.length;
  if (n) {
    lines.push("");
    lines.push("Earlier messages (oldest first):");
    input.context.forEach((m, i) => {
      const ref = `m${n - i}`;
      lines.push(`${ref} [${m.sentAtLocal}] ${m.direction === "outbound" ? "business" : "customer"} ${q(texts.senderNames[i + 1] ?? "")}: ${q(texts.context[i] ?? "")}`);
    });
  }
  lines.push("");
  lines.push("Message to analyse:");
  const att = input.message.attachments.length ? ` attachments: ${input.message.attachments.map(q).join(", ")};` : "";
  lines.push(
    `m0 [${input.message.sentAtLocal}] via ${input.message.source}, ${input.message.direction === "outbound" ? "business" : "customer"} ${q(texts.senderNames[0] ?? "")}, kind ${input.message.kind};${att} text: ${q(texts.message)}`,
  );
  return lines.join("\n");
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export async function runPipelineAi(input: PipelineAiInput): Promise<PipelineAiOutput> {
  const message = input.message.text.slice(0, 8000);
  const context = input.context.map((m) => m.text.slice(0, 1500));
  const senderNames = [input.message.senderName, ...input.context.map((m) => m.senderName)].map((s) => s.slice(0, 120));
  const openRecords = input.openRecords.map((r) => JSON.stringify(r.values).slice(0, 1500));

  let texts = { message, context, senderNames, openRecords };
  let map = new Map<string, string>();
  if (input.redact) {
    const all = [message, ...context, ...senderNames, ...openRecords];
    const r = redactPII(all);
    map = r.map;
    let i = 0;
    texts = {
      message: r.texts[i++],
      context: context.map(() => r.texts[i++]),
      senderNames: senderNames.map(() => r.texts[i++]),
      openRecords: openRecords.map(() => r.texts[i++]),
    };
  }

  const res = await runStructured({
    schema: AiOutput,
    system: SYSTEM,
    user: renderPipelinePrompt(input, texts),
    effort: "low",
    maxTokens: 6000,
    workspaceId: input.workspaceId,
    purpose: "pipeline",
  });
  const out = restorePII(res.output, map);
  const refs = new Set(input.collections.map((c) => c.ref));
  const entities: PipelineAiEntity[] = [];
  for (const c of out.collections) {
    if (!refs.has(c.collection)) continue;
    for (const f of c.fields.slice(0, 40)) {
      entities.push({
        collectionRef: c.collection,
        field: f.field,
        value: f.value === null ? null : f.value.slice(0, 2000),
        confidence: clamp01(f.confidence),
        evidence: f.evidence === null ? null : f.evidence.slice(0, 1000),
        messageRef: f.message && /^m\d{1,2}$/.test(f.message) ? f.message : null,
      });
    }
  }
  return {
    classification: { category: out.category, intent: out.intent, priority: out.priority, confidence: clamp01(out.confidence) },
    entities,
    suggestions: out.suggestions.slice(0, 2).map((s) => ({ type: s.type, text: s.text.slice(0, 300) })),
    model: res.model,
  };
}
