/**
 * Job type → handler. Imported lazily by the queue (avoids import cycles).
 */
import type { JobHandler, JobType } from "./queue";
import { handleProcessMessage } from "../pipeline/job";
import { handleBackfillCollection } from "../pipeline/backfill";
import { handleDeliverWebhook, handleDomainEventJob, handleReminder, handleRetentionSweep, handleScheduleTick } from "../automations/jobs";
import { handleSendReply } from "../channels/jobs";

export const handlers: Record<JobType, JobHandler> = {
  process_message: (p) => handleProcessMessage(p as { eventId: string }),
  backfill_collection: (p) => handleBackfillCollection(p as { workspaceId: string; collectionId: string; since?: string | null; until?: string | null }),
  domain_event: (p) => handleDomainEventJob(p),
  deliver_webhook: (p) => handleDeliverWebhook(p as { deliveryId: string }),
  reminder: (p) => handleReminder(p),
  retention_sweep: () => handleRetentionSweep(),
  schedule_tick: () => handleScheduleTick(),
  send_reply: (p) => handleSendReply(p as { workspaceId: string; conversationId: string; text: string; actor: unknown }),
};
