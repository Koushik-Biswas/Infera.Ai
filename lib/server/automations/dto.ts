/**
 * DTO mappers for the automations module (automations, runs, outbound webhook
 * endpoints and deliveries, review items, notifications). Secrets are never mapped.
 */
import type { AutomationDTO, AutomationRunDTO, NotificationDTO, ReviewItemDTO, WebhookDeliveryDTO, WebhookEndpointDTO } from "@/lib/shared/types";
import type { automationRuns, notifications, webhookDeliveries } from "../db/schema";
import type { AutomationRow, ReviewItemRow, WebhookEndpointRow } from "../db/schema";

type AutomationRunRow = typeof automationRuns.$inferSelect;
type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
type NotificationRow = typeof notifications.$inferSelect;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toAutomationDTO(a: AutomationRow): AutomationDTO {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    enabled: a.enabled,
    trigger: a.trigger,
    conditions: a.conditions ?? [],
    actions: a.actions,
    runCount: a.runCount,
    lastRunAt: isoOrNull(a.lastRunAt),
    createdAt: iso(a.createdAt),
    updatedAt: iso(a.updatedAt),
  };
}

export function toAutomationRunDTO(r: AutomationRunRow): AutomationRunDTO {
  return {
    id: r.id,
    automationId: r.automationId,
    triggerType: r.triggerType,
    subjectId: r.subjectId ?? null,
    status: r.status,
    output: r.output ?? null,
    error: r.error ?? null,
    createdAt: iso(r.createdAt),
  };
}

/** `secret` is only passed right after creation / rotation (shown once). */
export function toWebhookEndpointDTO(e: WebhookEndpointRow, secret?: string): WebhookEndpointDTO {
  return {
    id: e.id,
    url: e.url,
    description: e.description,
    events: [...e.events],
    enabled: e.enabled,
    lastDeliveryAt: isoOrNull(e.lastDeliveryAt),
    lastStatus: e.lastStatus ?? null,
    failureCount: e.failureCount,
    createdAt: iso(e.createdAt),
    ...(secret ? { secret } : {}),
  };
}

export function toWebhookDeliveryDTO(d: WebhookDeliveryRow): WebhookDeliveryDTO {
  return {
    id: d.id,
    endpointId: d.endpointId,
    eventType: d.eventType,
    status: d.status,
    attempts: d.attempts,
    responseStatus: d.responseStatus ?? null,
    error: d.error ?? null,
    createdAt: iso(d.createdAt),
    deliveredAt: isoOrNull(d.deliveredAt),
  };
}

export function toReviewItemDTO(r: ReviewItemRow): ReviewItemDTO {
  return {
    id: r.id,
    kind: r.kind,
    reason: r.reason,
    status: r.status,
    collectionId: r.collectionId ?? null,
    recordId: r.recordId ?? null,
    messageId: r.messageId ?? null,
    eventId: r.eventId ?? null,
    proposed: r.proposed ?? null,
    current: r.current ?? null,
    conflicts: r.conflicts ?? [],
    createdAt: iso(r.createdAt),
    resolvedAt: isoOrNull(r.resolvedAt),
    resolvedBy: r.resolvedBy ?? null,
    resolutionNote: r.resolutionNote ?? null,
  };
}

export function toNotificationDTO(n: NotificationRow): NotificationDTO {
  return { id: n.id, type: n.type, title: n.title, body: n.body, link: n.link ?? null, readAt: isoOrNull(n.readAt), createdAt: iso(n.createdAt) };
}
