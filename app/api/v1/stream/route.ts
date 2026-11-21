/**
 * GET /api/v1/stream — Server-Sent Events with live workspace updates
 * (message.received, message.processed, record.*, review.*, channel.status).
 *
 * Each event: `event: <type>\ndata: <RealtimeEvent JSON>\n\n` (ids only, no
 * message text). Heartbeat comments every 20 s keep proxies from closing the
 * connection; the stream ends after 5 minutes and EventSource reconnects on
 * its own (keeps serverless functions and load balancers happy).
 */
import { workspaceRoute } from "@/lib/server/api/handler";
import { subscribeRealtime } from "@/lib/server/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HEARTBEAT_MS = 20_000;
const MAX_LIFETIME_MS = 290_000;

export const GET = workspaceRoute({ role: "viewer", scope: "read", rateLimit: { limit: 60, windowSec: 60 } }, async (c) => {
  const workspaceId = c.auth.workspaceId;
  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const unsubscribe = await subscribeRealtime(workspaceId, (e) => {
        if (e.workspaceId !== workspaceId) return;
        send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      });
      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
      const lifetime = setTimeout(() => close(), MAX_LIFETIME_MS);
      function close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
      cleanup = close;
      c.req.signal.addEventListener("abort", close, { once: true });
      // Reconnect delay hint for EventSource, then an initial hello so clients know the stream is live.
      send(`retry: 3000\n\n`);
      send(`event: ready\ndata: {}\n\n`);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform stops compression middleware from buffering the stream.
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
