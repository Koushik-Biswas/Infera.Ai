import { and, eq, ne } from "drizzle-orm";
import { conflict, jsonResponse, notFound, workspaceRoute } from "@/lib/server/api/handler";
import { writeAudit } from "@/lib/server/audit";
import { events } from "@/lib/server/db/schema";
import { enqueue } from "@/lib/server/jobs/queue";
import { kickSoon } from "@/lib/server/jobs/kick";
import { toEventDTO } from "@/lib/server/pipeline/dto";
import { PipelineError } from "@/lib/server/pipeline/errors";
import { processEvent } from "@/lib/server/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An event stuck in "processing" longer than this can be re-processed (crashed worker). */
const STALE_MS = 10 * 60_000;

/**
 * POST /api/v1/events/:id/reprocess — re-run the pipeline for a stored event.
 * Default: queued → 202 { eventId, status: "queued" }. `?sync=1`: processed inline → EventDTO.
 */
export const POST = workspaceRoute<{ id: string }>({ role: "member", scope: "write", rateLimit: { limit: 60, windowSec: 60 } }, async (c) => {
  const [ev] = await c.db
    .select()
    .from(events)
    .where(and(eq(events.id, c.params.id), eq(events.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!ev) throw notFound("Event");
  if (ev.status === "processing" && ev.startedAt && Date.now() - ev.startedAt.getTime() < STALE_MS) throw conflict("This event is being processed right now. Try again in a moment.");

  const sync = c.query.get("sync") === "1";
  await writeAudit(c.db, {
    workspaceId: c.auth.workspaceId,
    actor: c.auth.actor,
    action: "event.reprocess",
    targetType: "event",
    targetId: ev.id,
    before: { status: ev.status },
    meta: { messageId: ev.messageId, sync },
  });

  if (sync) {
    try {
      await processEvent(ev.id, { force: true, noAiRetry: true });
    } catch (e) {
      if (e instanceof PipelineError && e.code === "busy") throw conflict("This event is being processed right now. Try again in a moment.");
      // Anything else is recorded on the event (status "failed" + error) and returned below.
    }
    const [row] = await c.db
      .select()
      .from(events)
      .where(and(eq(events.id, ev.id), eq(events.workspaceId, c.auth.workspaceId)))
      .limit(1);
    if (!row) throw notFound("Event");
    return toEventDTO(row);
  }

  await c.db
    .update(events)
    .set({ status: "queued", error: null })
    .where(and(eq(events.id, ev.id), eq(events.workspaceId, c.auth.workspaceId), ne(events.status, "processing")));
  await enqueue(c.db, { type: "process_message", payload: { eventId: ev.id, force: true }, workspaceId: c.auth.workspaceId, priority: 20 });
  kickSoon();
  return jsonResponse({ eventId: ev.id, status: "queued" }, 202);
});
