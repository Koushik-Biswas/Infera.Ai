import type { EventDTO } from "@/lib/shared/types";
import type { EventRow } from "../db/schema";

/** Event row → API shape (private to the pipeline routes; the data module has its own). */
export function toEventDTO(row: EventRow): EventDTO {
  return {
    id: row.id,
    messageId: row.messageId,
    source: row.source,
    status: row.status,
    attempts: row.attempts,
    result: row.result ?? null,
    error: row.error ?? null,
    durationMs: row.durationMs ?? null,
    model: row.model ?? null,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt ? row.processedAt.toISOString() : null,
  };
}
