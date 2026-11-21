/**
 * Ready-made automation definitions (GET /api/v1/automations/templates). Not persisted:
 * the console pre-fills the editor with one and POSTs it to /api/v1/automations.
 * Record triggers are bound to the workspace's matching collection (by template) when
 * one exists; otherwise the template is returned with `available: false` and a hint.
 */
import type { AutomationAction, AutomationCondition, AutomationTrigger, TemplateId } from "@/lib/shared/types";

export type AutomationTemplateDTO = {
  key: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  /** False when the workspace lacks what the template needs (see `note`). */
  available: boolean;
  note: string | null;
};

type CollectionRef = { id: string; name: string; template: TemplateId; statusOptions: string[] };

export function automationTemplates(collections: CollectionRef[]): AutomationTemplateDTO[] {
  const find = (t: TemplateId) => collections.find((c) => c.template === t) ?? null;
  const payments = find("payments");
  const leads = find("leads");
  const pendingStatus = payments?.statusOptions.find((s) => s.toLowerCase() === "pending") ?? "Pending";
  const wonStatus = leads?.statusOptions.find((s) => s.toLowerCase() === "won") ?? "Won";

  return [
    {
      key: "high_priority_lead",
      name: "Alert admins about high-priority leads",
      description: "When a sales enquiry is classified as high or urgent priority, notify the workspace admins right away.",
      trigger: { type: "message.processed", categories: ["sales_enquiry"] },
      conditions: [{ field: "priority", op: "in", value: ["high", "urgent"] }],
      actions: [{ type: "notify", to: "admins", title: "High-priority lead", body: "A {{priority}}-priority sales enquiry just arrived via {{source}}." }],
      available: true,
      note: null,
    },
    {
      key: "pending_payment_follow_up",
      name: "Follow up on pending payments after 24 hours",
      description: "When a payment is recorded as pending, remind the team to follow up a day later.",
      trigger: { type: "record.created", collectionId: payments?.id ?? null },
      conditions: [{ field: "status", op: "eq", value: pendingStatus }],
      actions: [{ type: "reminder", afterMinutes: 1440, title: "Follow up on a pending payment", body: "{{payer}} still owes {{amount}}. Check whether it has been paid." }],
      available: Boolean(payments),
      note: payments ? null : "Create a Payments collection first.",
    },
    {
      key: "new_complaint",
      name: "Notify the team about new complaints",
      description: "When a support message is a complaint, notify everyone so someone picks it up quickly.",
      trigger: { type: "message.processed", categories: ["support"] },
      conditions: [{ field: "intent", op: "eq", value: "complaint" }],
      actions: [{ type: "notify", to: "all", title: "New complaint", body: "A {{priority}}-priority complaint arrived via {{source}}." }],
      available: true,
      note: null,
    },
    {
      key: "deal_won",
      name: "Celebrate won deals",
      description: "When a lead moves to Won, notify the admins.",
      trigger: { type: "record.status_changed", collectionId: leads?.id ?? null, toStatus: wonStatus },
      conditions: [],
      actions: [{ type: "notify", to: "admins", title: "Deal won: {{name}}", body: "{{name}} moved to {{toStatus}}." }],
      available: Boolean(leads),
      note: leads ? null : "Create a Leads collection first.",
    },
    {
      key: "daily_review_digest",
      name: "Daily review reminder",
      description: "Every morning at 9, remind everyone to clear the review queue.",
      trigger: { type: "schedule.daily", hour: 9 },
      conditions: [],
      actions: [{ type: "notify", to: "all", title: "Review queue check", body: "Take a minute to approve or reject today's open review items." }],
      available: true,
      note: null,
    },
  ];
}
