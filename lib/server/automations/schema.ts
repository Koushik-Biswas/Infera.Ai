/**
 * Validation of automation definitions: zod shapes (trigger, conditions, actions as a
 * discriminated union) plus workspace-aware checks — every referenced collection,
 * webhook endpoint and user must belong to the caller's workspace (rule 6: unknown or
 * foreign ids → 404), field keys must exist, and literal values are normalised
 * deterministically against the target field (rule 15).
 */
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { CATEGORIES, CONDITION_OPS, DOMAIN_EVENT_TYPES, type AutomationAction, type AutomationCondition, type AutomationTrigger, type CellValue, type Field } from "@/lib/shared/types";
import type { Database } from "../db";
import { collections, memberships, webhookEndpoints, type CollectionRow } from "../db/schema";
import { notFound, unprocessable } from "../api/handler";
import { cleanText } from "../http";
import { normalizeValue } from "../records/coerce";
import { CONTEXT_FIELDS, toNumber, valueKeyOf } from "./conditions";

export const MAX_ACTIONS = 10;
export const MAX_CONDITIONS = 20;
export const MAX_AUTOMATIONS_PER_WORKSPACE = 200;

export const TRIGGER_TYPES = [...DOMAIN_EVENT_TYPES, "schedule.daily"] as const;
const RECORD_WRITE_TRIGGERS = new Set(["record.created", "record.updated", "record.status_changed"]);
const COLLECTION_SCOPED_TRIGGERS = new Set(["record.created", "record.updated", "record.status_changed", "record.deleted", "review.created", "review.resolved"]);

/** A `{{placeholder}}` in a string value (rendered at run time from the event's data). */
export const PLACEHOLDER_RE = /\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]{0,63}\s*\}\}/;

const cell = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);
const id = z.string().trim().min(1).max(64);
const line = (max: number, msg: string) =>
  z
    .string()
    .max(max * 4)
    .transform((v) => cleanText(v, max))
    .pipe(z.string().min(1, msg));
const multiline = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((v) => cleanText(v, max, { multiline: true }));

export const triggerSchema = z
  .object({
    type: z.enum(TRIGGER_TYPES),
    collectionId: id.nullable().optional(),
    toStatus: z.string().trim().max(80).nullable().optional(),
    categories: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length).optional(),
    hour: z.number().int().min(0).max(23).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.type === "schedule.daily" && t.hour === undefined) ctx.addIssue({ code: "custom", path: ["hour"], message: "Pick the hour of day (0-23) for a daily schedule." });
    if (t.type !== "schedule.daily" && t.hour !== undefined) ctx.addIssue({ code: "custom", path: ["hour"], message: "An hour only applies to daily schedules." });
    if (t.toStatus && t.type !== "record.status_changed") ctx.addIssue({ code: "custom", path: ["toStatus"], message: "A target status only applies to “record status changed” triggers." });
    if (t.collectionId && !COLLECTION_SCOPED_TRIGGERS.has(t.type)) ctx.addIssue({ code: "custom", path: ["collectionId"], message: "A collection only applies to record and review triggers." });
    if (t.categories?.length && t.type === "schedule.daily") ctx.addIssue({ code: "custom", path: ["categories"], message: "Categories don't apply to daily schedules." });
  })
  .transform((t): AutomationTrigger => {
    const out: AutomationTrigger = { type: t.type };
    if (t.collectionId) out.collectionId = t.collectionId;
    if (t.toStatus) out.toStatus = t.toStatus;
    if (t.categories?.length) out.categories = [...new Set(t.categories)];
    if (t.hour !== undefined) out.hour = t.hour;
    return out;
  });

const NEEDS_VALUE = new Set(["eq", "neq", "contains", "not_contains", "gt", "gte", "lt", "lte", "in"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export const conditionSchema = z
  .object({
    field: z
      .string()
      .trim()
      .regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,63}$/, "Use a field key such as status, amount or category."),
    op: z.enum(CONDITION_OPS),
    value: z.union([cell, z.array(cell).max(100)]).optional(),
  })
  .superRefine((c, ctx) => {
    const v = c.value;
    if (NEEDS_VALUE.has(c.op) && v === undefined) ctx.addIssue({ code: "custom", path: ["value"], message: `“${c.op}” needs a value.` });
    if (c.op === "in" && v !== undefined && !Array.isArray(v)) ctx.addIssue({ code: "custom", path: ["value"], message: "“in” needs a list of values." });
    if (c.op !== "in" && Array.isArray(v)) ctx.addIssue({ code: "custom", path: ["value"], message: "Only “in” takes a list of values." });
    if ((c.op === "gt" || c.op === "gte" || c.op === "lt" || c.op === "lte") && v !== undefined && !Array.isArray(v)) {
      if (toNumber(v) === null && !(typeof v === "string" && ISO_DATE.test(v.trim()))) ctx.addIssue({ code: "custom", path: ["value"], message: `“${c.op}” compares numbers or dates.` });
    }
    if ((c.op === "contains" || c.op === "not_contains") && (v === null || typeof v === "boolean")) ctx.addIssue({ code: "custom", path: ["value"], message: `“${c.op}” needs text to look for.` });
  })
  .transform((c): AutomationCondition => (c.op === "exists" || c.op === "not_exists" ? { field: c.field, op: c.op } : { field: c.field, op: c.op, value: c.value ?? null }));

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("notify"),
    title: line(200, "Give the notification a title."),
    body: multiline(2000).optional(),
    to: z.union([z.literal("all"), z.literal("admins"), z.array(id).min(1).max(50)]),
  }),
  z.object({ type: z.literal("set_field"), key: z.string().trim().min(1).max(40), value: cell }),
  z.object({
    type: z.literal("create_record"),
    collectionId: id,
    values: z.record(z.string().trim().min(1).max(40), cell).refine((v) => Object.keys(v).length <= 60, "Too many values."),
  }),
  z.object({ type: z.literal("webhook"), endpointId: id }),
  z.object({ type: z.literal("reminder"), afterMinutes: z.number().int().min(1).max(43_200), title: line(200, "Give the reminder a title."), body: multiline(2000).optional() }),
  z.object({ type: z.literal("reply"), text: multiline(4000).pipe(z.string().min(1, "Write the reply text.")) }),
  z.object({ type: z.literal("add_tag"), tag: line(40, "Enter a tag.") }),
]);

const name = line(120, "Give the automation a name.");
const description = multiline(1000);

export const automationCreateSchema = z.object({
  name,
  description: description.optional(),
  enabled: z.boolean().optional(),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(MAX_CONDITIONS, `At most ${MAX_CONDITIONS} conditions.`).optional(),
  actions: z.array(actionSchema).min(1, "Add at least one action.").max(MAX_ACTIONS, `At most ${MAX_ACTIONS} actions.`),
});

export const automationPatchSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    enabled: z.boolean().optional(),
    trigger: triggerSchema.optional(),
    conditions: z.array(conditionSchema).max(MAX_CONDITIONS, `At most ${MAX_CONDITIONS} conditions.`).optional(),
    actions: z.array(actionSchema).min(1, "Add at least one action.").max(MAX_ACTIONS, `At most ${MAX_ACTIONS} actions.`).optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), "Nothing to update.");

export type AutomationDefinition = { trigger: AutomationTrigger; conditions: AutomationCondition[]; actions: AutomationAction[] };

/* ----------------------- Workspace-aware validation ---------------------- */

async function loadCollection(db: Database, workspaceId: string, collectionId: string): Promise<CollectionRow> {
  const [row] = await db
    .select()
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw notFound("Collection");
  return row;
}

const fieldOf = (fields: Field[], key: string) => fields.find((f) => f.key === key) ?? null;

/** Normalises a literal value for a field; rejects values that can't be stored (unless templated). */
function normalizeLiteral(field: Field, value: CellValue, path: string): CellValue {
  if (value === null) return null;
  if (typeof value === "string" && PLACEHOLDER_RE.test(value)) return value;
  const n = normalizeValue(field, value);
  if (n.value === null) throw unprocessable(`${path}: ${n.warning ?? `“${field.label}” can't take this value.`}`, [{ path, message: n.warning ?? "Invalid value." }]);
  return n.value;
}

/**
 * Checks a full definition against the workspace and returns it with literal values
 * normalised. Throws 404 for references outside the workspace, 422 for invalid fields.
 */
export async function validateAutomationDefinition(db: Database, workspaceId: string, def: AutomationDefinition): Promise<AutomationDefinition> {
  const trigger: AutomationTrigger = { ...def.trigger };
  const triggerCollection = trigger.collectionId ? await loadCollection(db, workspaceId, trigger.collectionId) : null;

  if (trigger.type === "schedule.daily" && def.conditions.length) {
    throw unprocessable("conditions: Daily schedules have no event data to check — remove the conditions.", [{ path: "conditions", message: "Not supported for daily schedules." }]);
  }

  if (trigger.toStatus && triggerCollection) {
    const statusField = triggerCollection.fields.find((f) => f.type === "status");
    if (!statusField) throw unprocessable(`trigger.toStatus: “${triggerCollection.name}” has no status field.`, [{ path: "trigger.toStatus", message: "No status field." }]);
    const options = statusField.options ?? [];
    if (options.length) {
      const match = options.find((o) => o.toLowerCase() === trigger.toStatus!.trim().toLowerCase());
      if (!match) throw unprocessable(`trigger.toStatus: Use one of ${options.join(", ")}.`, [{ path: "trigger.toStatus", message: "Unknown status." }]);
      trigger.toStatus = match;
    }
  }

  // Conditions on record values must name a field of the trigger collection (when known).
  if (triggerCollection) {
    def.conditions.forEach((c, i) => {
      if (CONTEXT_FIELDS.has(c.field) && !c.field.includes(".")) return;
      const key = valueKeyOf(c.field);
      if (key && !fieldOf(triggerCollection.fields, key)) {
        throw unprocessable(`conditions.${i}.field: “${c.field}” is not a field of ${triggerCollection.name}.`, [{ path: `conditions.${i}.field`, message: "Unknown field." }]);
      }
    });
  }

  const endpointIds = new Set<string>();
  const userIds = new Set<string>();
  const actions: AutomationAction[] = [];
  for (const [i, a] of def.actions.entries()) {
    const path = `actions.${i}`;
    switch (a.type) {
      case "set_field": {
        if (!RECORD_WRITE_TRIGGERS.has(trigger.type)) {
          throw unprocessable(`${path}: “Set field” only works with record created / updated / status changed triggers.`, [{ path, message: "Needs a record trigger." }]);
        }
        if (triggerCollection) {
          const f = fieldOf(triggerCollection.fields, a.key);
          if (!f) throw unprocessable(`${path}.key: “${a.key}” is not a field of ${triggerCollection.name}.`, [{ path: `${path}.key`, message: "Unknown field." }]);
          actions.push({ ...a, value: normalizeLiteral(f, a.value, `${path}.value`) });
        } else actions.push(a);
        break;
      }
      case "create_record": {
        const target = await loadCollection(db, workspaceId, a.collectionId);
        if (target.archivedAt) throw unprocessable(`${path}.collectionId: “${target.name}” is archived.`, [{ path: `${path}.collectionId`, message: "Archived collection." }]);
        const values: Record<string, CellValue> = {};
        for (const [k, v] of Object.entries(a.values)) {
          const f = fieldOf(target.fields, k);
          if (!f) throw unprocessable(`${path}.values.${k}: “${k}” is not a field of ${target.name}.`, [{ path: `${path}.values.${k}`, message: "Unknown field." }]);
          values[k] = normalizeLiteral(f, v, `${path}.values.${k}`);
        }
        actions.push({ ...a, values });
        break;
      }
      case "webhook":
        endpointIds.add(a.endpointId);
        actions.push(a);
        break;
      case "notify":
        if (Array.isArray(a.to)) {
          a.to.forEach((u) => userIds.add(u));
          actions.push({ ...a, to: [...new Set(a.to)] });
        } else actions.push(a);
        break;
      case "reply":
      case "add_tag":
        if (trigger.type === "schedule.daily") {
          throw unprocessable(`${path}: “${a.type === "reply" ? "Reply" : "Add tag"}” needs a message or record — daily schedules have none.`, [{ path, message: "Not supported for daily schedules." }]);
        }
        actions.push(a);
        break;
      default:
        actions.push(a);
    }
  }

  if (endpointIds.size) {
    const rows = await db
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.workspaceId, workspaceId), inArray(webhookEndpoints.id, [...endpointIds])));
    if (rows.length !== endpointIds.size) throw notFound("Webhook endpoint");
  }
  if (userIds.size) {
    const rows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), inArray(memberships.userId, [...userIds])));
    if (rows.length !== userIds.size) throw notFound("Member");
  }

  return { trigger, conditions: def.conditions, actions };
}
