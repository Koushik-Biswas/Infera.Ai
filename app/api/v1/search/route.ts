/**
 * GET /api/v1/search?q=&type=all|messages|records|contacts&from=&to=&channelId=&conversationId=&limit= (viewer / API read)
 * → { items: SearchHitDTO[] }. Messages match every word as a prefix ("bask" finds "basketball").
 */
import { unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { search } from "@/lib/server/data/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = ["all", "messages", "records", "contacts"] as const;

const dateParam = (v: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw unprocessable("from/to must be ISO dates.");
  return d;
};

export const GET = workspaceRoute({ role: "viewer", scope: "read", rateLimit: { limit: 120, windowSec: 60 } }, async (c) => {
  const q = (c.query.get("q") ?? "").trim();
  const type = (c.query.get("type") ?? "all") as (typeof TYPES)[number];
  if (!TYPES.includes(type)) throw unprocessable("type: Use all, messages, records or contacts.");
  if (!q) return { items: [] };
  const items = await search(c.db, c.auth.workspaceId, q, {
    type,
    from: dateParam(c.query.get("from")),
    to: dateParam(c.query.get("to")),
    channelId: c.query.get("channelId"),
    conversationId: c.query.get("conversationId"),
    limit: Math.min(100, Math.max(1, Number(c.query.get("limit") ?? 30) || 30)),
  });
  return { items };
});
