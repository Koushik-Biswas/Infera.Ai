/**
 * Server-side collection templates: the on-device app's templates
 * (lib/app/templates.ts) plus routing (which message categories feed the
 * collection), dedupe identity (`matchFields`) and required fields.
 */
import { templates as appTemplates } from "@/lib/app/templates";
import type { Category, CollectionPlanDTO, Field, TemplateId } from "@/lib/shared/types";

type ServerSpec = { categories: Category[]; matchFields: string[]; required: string[] };

const SPEC: Record<Exclude<TemplateId, "custom">, ServerSpec> = {
  orders: { categories: ["order", "payment"], matchFields: ["$contact", "purchase"], required: ["purchase"] },
  leads: { categories: ["sales_enquiry"], matchFields: ["$contact"], required: ["interest"] },
  payments: { categories: ["payment"], matchFields: ["$contact", "amount"], required: ["amount"] },
  products: { categories: ["document_share"], matchFields: ["name"], required: ["name"] },
  tasks: { categories: ["follow_up", "appointment"], matchFields: ["$conversation", "task"], required: ["task"] },
  support: { categories: ["support"], matchFields: ["$contact", "issue"], required: ["issue"] },
  contacts: { categories: ["contact_share"], matchFields: ["phone"], required: ["phone"] },
  documents: { categories: ["document_share"], matchFields: ["$conversation", "file"], required: ["file"] },
  links: { categories: ["document_share", "general"], matchFields: ["url"], required: ["url"] },
};

export function templatePlan(id: Exclude<TemplateId, "custom">): CollectionPlanDTO {
  const t = appTemplates.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template ${id}`);
  const spec = SPEC[id];
  const fields: Field[] = t.fields.map((f) => ({ ...f, type: f.type as Field["type"], ...(spec.required.includes(f.key) ? { required: true } : {}) }));
  return {
    name: t.name,
    description: t.description,
    icon: t.icon,
    template: id,
    fields,
    routing: { categories: spec.categories },
    matchFields: spec.matchFields,
  };
}

export const serverTemplates = (): CollectionPlanDTO[] => (Object.keys(SPEC) as Exclude<TemplateId, "custom">[]).map(templatePlan);

/** Templates created automatically for a new workspace so the pipeline has somewhere to put data. */
export const DEFAULT_TEMPLATES: Exclude<TemplateId, "custom">[] = ["leads", "orders", "payments", "support", "tasks"];
