/**
 * Step 5 — which collections a message feeds.
 *
 * Eligible: non-archived, autopilot on, and (if the collection restricts
 * channels) the message's channel is listed. A collection is targeted when its
 * `routing.categories` include the message category or one of its
 * `routing.keywords` appears in the text.
 *
 * Update-only routes: some template routes may change an existing record but
 * never create one — a payment message marks the customer's open order Paid,
 * it doesn't open a new order. Messages sent by the business (outbound) are
 * also update-only: customers' messages create records, replies move them on.
 */
import type { Category, TemplateId } from "@/lib/shared/types";
import type { CollectionRow } from "../db/schema";
import { escapeRe } from "./text";

const UPDATE_ONLY: Partial<Record<TemplateId, Category[]>> = {
  orders: ["payment"],
};

export type Route = { collection: CollectionRow; via: "category" | "keyword" | "forced"; updateOnly: boolean };

export function eligibleCollections(all: CollectionRow[], channelId: string | null): CollectionRow[] {
  return all.filter((c) => !c.archivedAt && c.autopilot && (!c.routing.channelIds?.length || (channelId !== null && c.routing.channelIds.includes(channelId))));
}

export function keywordHit(c: CollectionRow, text: string): boolean {
  const kws = (c.routing.keywords ?? []).map((k) => k.trim()).filter((k) => k.length >= 2);
  if (!kws.length || !text) return false;
  return kws.some((k) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(k)}(?![\\p{L}\\p{N}])`, "iu").test(text));
}

export function routeCollections(eligible: CollectionRow[], input: { category: Category; text: string; outbound: boolean; forced?: boolean }): Route[] {
  const out: Route[] = [];
  for (const c of eligible) {
    const byCategory = (c.routing.categories ?? []).includes(input.category);
    const byKeyword = !byCategory && keywordHit(c, input.text);
    if (!byCategory && !byKeyword && !input.forced) continue;
    const secondary = byCategory && (UPDATE_ONLY[c.template] ?? []).includes(input.category);
    out.push({ collection: c, via: byCategory ? "category" : byKeyword ? "keyword" : "forced", updateOnly: input.outbound || secondary });
  }
  return out;
}
