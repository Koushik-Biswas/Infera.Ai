/**
 * `process_message` job handler. Transient failures (AI rate limits, lost DB
 * connections, an event being processed by another worker) are rethrown so
 * the queue retries with backoff; permanent ones are already recorded on the
 * event (status "failed") and end the job without retries.
 */
import { z } from "zod";
import { log } from "../http";
import { PermanentJobError } from "../jobs/queue";
import { PipelineError, isRetryable, safeErrorMessage } from "./errors";
import { processEvent } from "./run";

const Payload = z.object({ eventId: z.string().min(1).max(100), force: z.boolean().optional() });

export async function handleProcessMessage(payload: { eventId: string; force?: boolean }): Promise<void> {
  const p = Payload.safeParse(payload);
  if (!p.success) throw new PermanentJobError("Invalid process_message payload.");
  try {
    await processEvent(p.data.eventId, { force: p.data.force });
  } catch (e) {
    if (isRetryable(e)) throw e;
    // The event (or its message) was deleted, e.g. by the retention sweep: nothing left to do.
    if (e instanceof PipelineError && (e.code === "event_not_found" || e.code === "message_not_found" || e.code === "workspace_not_found")) {
      log("info", "process_message_gone", { eventId: p.data.eventId, code: e.code });
      return;
    }
    throw new PermanentJobError(safeErrorMessage(e));
  }
}
