/**
 * Product data comes straight from the website's source of truth (lib/data.ts,
 * lib/site.ts, lib/faqs.ts) so the video never shows invented UI content.
 */
export { orders, incoming, chats, formatINR, formatDate } from "../../../lib/data";
export type { OrderRow, OrderStatus } from "../../../lib/data";
export { site } from "../../../lib/site";
