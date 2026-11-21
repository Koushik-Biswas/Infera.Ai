/**
 * Collections: input validation and "describe it in words" planning.
 *
 *   planFromPrompt("Find all leads from my chats for the last month")
 *     → { plan: CollectionPlanDTO, since: <30 days ago>, engine: "ai" | "rules" }
 *
 * The plan is shown to the user to accept / edit; accepting creates the
 * collection and (when the prompt names a time range) backfills past messages
 * from that range into it.
 */
import { z } from "zod";
import { CATEGORIES, FIELD_TYPES, TEMPLATE_IDS, type Category, type CollectionPlanDTO, type Field, type TemplateId } from "@/lib/shared/types";
import { planFromPrompt as rulesPlan, timeRange } from "@/lib/app/assistant";
import { templates as appTemplates } from "@/lib/app/templates";
import { unprocessable } from "../api/handler";
import { aiConfigured, DATA_RULE, runStructured } from "../ai/client";
import { templatePlan } from "../templates";

export const FIELD_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
export const ICONS = ["shopping-bag", "users", "wallet", "package", "list-checks", "life-buoy", "contact", "folder-open", "link", "table", "home", "calendar", "truck", "star"] as const;

export const FieldSchema = z.object({
  key: z.string().trim().regex(FIELD_KEY_RE, "Field keys start with a letter and use letters, digits or _ (max 40)."),
  label: z.string().trim().min(1).max(60),
  type: z.enum(FIELD_TYPES),
  description: z.string().trim().max(500).default(""),
  options: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  required: z.boolean().optional(),
});

export const RoutingSchema = z.object({
  categories: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length),
  channelIds: z.array(z.string().max(64)).max(50).optional(),
  keywords: z.array(z.string().trim().min(2).max(40)).max(30).optional(),
});

export const CollectionCreateBody = z.object({
  template: z.enum(TEMPLATE_IDS).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  icon: z.string().trim().max(30).optional(),
  fields: z.array(FieldSchema).min(1).max(30).optional(),
  routing: RoutingSchema.optional(),
  matchFields: z.array(z.string().max(41)).max(5).optional(),
  autopilot: z.boolean().optional(),
  /** Also process past messages since this date into the new collection ("leads from the last month"). */
  backfillSince: z.string().max(40).nullish(),
});

export const CollectionPatchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  icon: z.string().trim().max(30).optional(),
  fields: z.array(FieldSchema).min(1).max(30).optional(),
  routing: RoutingSchema.optional(),
  matchFields: z.array(z.string().max(41)).max(5).optional(),
  autopilot: z.boolean().optional(),
  archived: z.boolean().optional(),
});

/** Unique keys, status fields have options, match fields exist. */
export function validateFields(fields: Field[], matchFields: string[] = []): void {
  const seen = new Set<string>();
  for (const f of fields) {
    const k = f.key.toLowerCase();
    if (seen.has(k)) throw unprocessable(`fields: Duplicate field key "${f.key}".`);
    seen.add(k);
    if (f.type === "status" && !f.options?.length) throw unprocessable(`fields: Status field "${f.label}" needs at least one option.`);
  }
  if (fields.filter((f) => f.type === "status").length > 1) throw unprocessable("fields: A collection can have only one status field.");
  for (const m of matchFields) {
    if (m === "$contact" || m === "$conversation") continue;
    if (!fields.some((f) => f.key === m)) throw unprocessable(`matchFields: "${m}" is not a field of this collection.`);
  }
}

/** Full plan for a create request: template defaults, overridden by explicit values. */
export function resolveCreate(body: z.infer<typeof CollectionCreateBody>): CollectionPlanDTO & { autopilot: boolean } {
  const base: CollectionPlanDTO =
    body.template && body.template !== "custom"
      ? templatePlan(body.template)
      : { name: "Untitled collection", description: "", icon: "table", template: "custom", fields: [], routing: { categories: [] }, matchFields: [] };
  const fields = (body.fields as Field[] | undefined) ?? base.fields;
  if (!fields.length) throw unprocessable("fields: Add at least one field.");
  const plan: CollectionPlanDTO = {
    name: body.name ?? base.name,
    description: body.description ?? base.description,
    icon: body.icon ?? base.icon,
    template: body.template ?? base.template,
    fields,
    routing: body.routing ?? base.routing,
    // A template's match fields may not exist any more if the caller replaced the fields.
    matchFields: (body.matchFields ?? base.matchFields).filter((m) => m.startsWith("$") || fields.some((f) => f.key === m)),
  };
  validateFields(plan.fields, plan.matchFields);
  return { ...plan, autopilot: body.autopilot ?? true };
}

/* ------------------------------ Planning ----------------------------- */

const KEYWORD_CATEGORIES: [RegExp, Category[]][] = [
  [/\b(lead|enquir|inquir|prospect|interest|customer|client|buyer|property|rent|flat|bhk)/i, ["sales_enquiry"]],
  [/\b(order|purchase|booking|bought|shipment|delivery)/i, ["order"]],
  [/\b(payment|paid|invoice|upi|refund|due|pending amount|money)/i, ["payment"]],
  [/\b(complain|issue|problem|support|ticket|return|defect)/i, ["support"]],
  [/\b(follow.?up|task|todo|to-do|reminder|commitment|promise|deadline)/i, ["follow_up"]],
  [/\b(appointment|meeting|visit|call back|schedule)/i, ["appointment"]],
  [/\b(contact|phone number|vcard)/i, ["contact_share"]],
  [/\b(document|pdf|file|catalog|catalogue|brochure|photo|image)/i, ["document_share"]],
  [/\b(feedback|review|rating|testimonial)/i, ["feedback"]],
];

const STOP = new Set(["all", "my", "the", "from", "for", "with", "and", "of", "in", "last", "past", "this", "week", "month", "year", "today", "chats", "chat", "messages", "find", "track", "create", "collection", "table", "list", "make", "every", "their", "them", "that", "which"]);

function categoriesFor(text: string): Category[] {
  const out = new Set<Category>();
  for (const [re, cats] of KEYWORD_CATEGORIES) if (re.test(text)) cats.forEach((c) => out.add(c));
  return out.size ? [...out] : ["general"];
}

export type PlanResult = { plan: CollectionPlanDTO; since: string | null; rangeLabel: string | null; engine: "ai" | "rules" };

const AiPlanSchema = z.object({
  name: z.string().describe("Short collection title, 1-4 words"),
  description: z.string().describe("One sentence on what the collection contains"),
  icon: z.enum(ICONS),
  template: z.enum(TEMPLATE_IDS).describe('The closest built-in template, or "custom"'),
  categories: z.array(z.enum(CATEGORIES)).describe("Message categories that should feed this collection (1-3)"),
  keywords: z.array(z.string()).describe("0-8 specific words that mark a relevant message (e.g. product names); empty if categories suffice"),
  fields: z
    .array(
      z.object({
        key: z.string().describe("camelCase identifier, unique, starts with a letter"),
        label: z.string().describe("Column header shown to the user"),
        type: z.enum(FIELD_TYPES),
        description: z.string().describe("Extraction instruction for this column"),
        options: z.array(z.string()).describe("Allowed values for a status field, in pipeline order; empty for other types"),
      }),
    )
    .describe("4 to 9 columns; at most one status column"),
});

const toKey = (s: string, i: number) => {
  const k = s.replace(/[^a-zA-Z0-9_]/g, "").replace(/^[^a-zA-Z]+/, "");
  return FIELD_KEY_RE.test(k) ? k : `field${i + 1}`;
};

function cleanAiFields(fields: z.infer<typeof AiPlanSchema>["fields"]): Field[] {
  const seen = new Set<string>();
  let status = false;
  const out: Field[] = [];
  fields.forEach((f, i) => {
    let key = toKey(f.key, i);
    while (seen.has(key.toLowerCase())) key = `${key}_${i}`;
    seen.add(key.toLowerCase());
    const isStatus = f.type === "status" && f.options.length > 0 && !status;
    if (isStatus) status = true;
    out.push({ key, label: f.label.slice(0, 60) || key, type: isStatus ? "status" : f.type === "status" ? "text" : f.type, description: f.description.slice(0, 500), ...(isStatus ? { options: f.options.slice(0, 20).map((o) => o.slice(0, 40)) } : {}) });
  });
  return out.slice(0, 30);
}

/** Collection plan from a sentence. AI when the workspace allows it, else deterministic rules. */
export async function planFromPrompt(input: { prompt: string; workspaceId: string; aiMode: "off" | "assist" | "full" }): Promise<PlanResult> {
  const prompt = input.prompt.trim();
  const range = timeRange(prompt);
  const since = range ? new Date(range.from).toISOString() : null;
  const rangeLabel = range?.label ?? null;

  if (aiConfigured() && input.aiMode !== "off") {
    try {
      const { output } = await runStructured({
        schema: AiPlanSchema,
        purpose: "collection_plan",
        workspaceId: input.workspaceId,
        effort: "low",
        maxTokens: 4000,
        system: `You design "collections" — spreadsheets that Infera fills automatically from a business's chats (WhatsApp etc.). A message classifier tags every message with one category: ${CATEGORIES.join(", ")}. Given the user's request, design the columns and say which categories (and optional keywords) should feed the collection. Prefer concrete, extractable columns (name, item, amount, status, location, date). Use "currency" for money, "date" for dates. ${DATA_RULE}`,
        user: `<request>${prompt.slice(0, 2000)}</request>`,
      });
      const fields = cleanAiFields(output.fields);
      if (fields.length) {
        const keywords = output.keywords.map((k) => k.trim()).filter((k) => k.length >= 2 && k.length <= 40).slice(0, 8);
        const tpl = output.template !== "custom" ? templatePlan(output.template) : null;
        return {
          plan: {
            name: output.name.slice(0, 80) || "My collection",
            description: output.description.slice(0, 300),
            icon: output.icon,
            template: "custom",
            fields,
            routing: { categories: output.categories.length ? output.categories : (tpl?.routing.categories ?? categoriesFor(prompt)), ...(keywords.length ? { keywords } : {}) },
            matchFields: ["$contact"],
          },
          since,
          rangeLabel,
          engine: "ai",
        };
      }
    } catch {
      /* fall back to rules */
    }
  }

  const p = rulesPlan(prompt, []);
  const tplId = appTemplates.find((t) => t.keywords.test(`${prompt} ${p.name}`))?.id as Exclude<TemplateId, "custom"> | undefined;
  const tpl = tplId ? templatePlan(tplId) : null;
  // Specific subject words ("red basketball", "property") help route messages the classifier files elsewhere.
  const keywords = tpl
    ? []
    : [...new Set(p.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)))].slice(0, 5);
  const seen = new Set<string>();
  let hasStatus = false;
  const fields: Field[] = [];
  p.fields.forEach((f, i) => {
    const key = FIELD_KEY_RE.test(f.key) ? f.key : toKey(f.key, i);
    if (seen.has(key.toLowerCase()) || (f.type === "status" && hasStatus)) return;
    if (f.type === "status") hasStatus = true;
    seen.add(key.toLowerCase());
    fields.push({ ...f, key });
  });
  const plan: CollectionPlanDTO = {
    name: p.name,
    description: p.description,
    icon: p.icon,
    template: tpl && p.template === tpl.template ? tpl.template : "custom",
    fields: tpl && p.template === tpl.template ? tpl.fields : fields,
    routing: { categories: tpl?.routing.categories ?? categoriesFor(prompt), ...(keywords.length ? { keywords } : {}) },
    matchFields: tpl && p.template === tpl.template ? tpl.matchFields : ["$contact"],
  };
  validateFields(plan.fields, plan.matchFields);
  return { plan, since, rangeLabel, engine: "rules" };
}
