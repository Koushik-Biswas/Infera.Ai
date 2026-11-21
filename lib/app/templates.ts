import type { Field, TemplateId } from "./types";

export type Template = {
  id: TemplateId;
  name: string;
  description: string;
  icon: string;
  keywords: RegExp;
  fields: Field[];
};

const f = (key: string, label: string, type: Field["type"], description: string, options?: string[]): Field => ({
  key,
  label,
  type,
  description,
  ...(options ? { options } : {}),
});

export const ORDER_STATUSES = ["New order", "Confirmed", "Paid", "Packed", "Shipped", "Delivered", "Cancelled"];
export const LEAD_STATUSES = ["New lead", "Contacted", "Qualified", "Proposal sent", "Won", "Lost"];
export const PAYMENT_STATUSES = ["Pending", "Paid", "Refunded"];
export const TASK_STATUSES = ["To do", "Done"];
export const SUPPORT_STATUSES = ["Open", "In progress", "Resolved"];

export const templates: Template[] = [
  {
    id: "orders",
    name: "Orders",
    description: "Every order customers place over chat — item, quantity, amount and where it stands.",
    icon: "shopping-bag",
    keywords: /\b(orders?|purchases?|sales?|bookings?|buy|bought)\b/i,
    fields: [
      f("customer", "Customer name", "text", "Who placed the order. Use the contact or sender name."),
      f("phone", "Phone", "phone", "Customer's phone number if shared in the chat."),
      f("purchase", "Purchase", "text", "The item(s) ordered, with size or colour if mentioned."),
      f("qty", "Qty", "number", "Number of units ordered."),
      f("amount", "Amount", "currency", "Order value or total price agreed."),
      f("status", "Status", "status", "Latest stage of the order based on the conversation.", ORDER_STATUSES),
      f("address", "Delivery", "location", "Delivery address, city or area if mentioned."),
      f("date", "Date", "date", "Date of the latest message about this order."),
    ],
  },
  {
    id: "leads",
    name: "Leads and deals",
    description: "Prospects who asked about your products or services, what they want and how close they are to buying.",
    icon: "users",
    keywords: /\b(leads?|deals?|prospects?|enquir(y|ies)|inquir(y|ies)|clients?|properties|property|pipeline|crm)\b/i,
    fields: [
      f("name", "Lead name", "text", "Name of the person or business."),
      f("phone", "Phone", "phone", "Phone number."),
      f("interest", "Interested in", "text", "Product, service or property the lead is asking about."),
      f("budget", "Budget", "currency", "Budget or price discussed."),
      f("location", "Location", "location", "Locality, city or area mentioned. Standardise place names."),
      f("status", "Stage", "status", "Pipeline stage based on the conversation.", LEAD_STATUSES),
      f("next", "Next step", "text", "The next action promised or requested (call, visit, send quote…)."),
      f("date", "Last contact", "date", "Date of the most recent message."),
    ],
  },
  {
    id: "payments",
    name: "Payments",
    description: "Payments received or promised — UPI screenshots, receipts, dues and references.",
    icon: "wallet",
    keywords: /\b(payments?|paid|unpaid|dues?|invoices?|receipts?|upi|transactions?|money|collections? of money|outstanding)\b/i,
    fields: [
      f("payer", "Payer", "text", "Who paid or owes the money."),
      f("amount", "Amount", "currency", "Amount paid or due."),
      f("method", "Method", "text", "UPI, GPay, PhonePe, bank transfer, cash or card."),
      f("status", "Status", "status", "Whether the payment is done or still pending.", PAYMENT_STATUSES),
      f("reference", "Reference", "text", "UTR, transaction ID or invoice number if present."),
      f("date", "Date", "date", "When the payment message was sent."),
    ],
  },
  {
    id: "products",
    name: "Product catalogue",
    description: "Product photos and documents shared in chats, with names and prices — ready for your sheet or store.",
    icon: "package",
    keywords: /\b(products?|catalog(ue)?|inventory|stock|items?|listings?|collections? of products|sku)\b/i,
    fields: [
      f("image", "Photo", "image", "The product photo."),
      f("name", "Product", "text", "Product name from the caption or nearby message."),
      f("price", "Price", "currency", "Price mentioned with the product."),
      f("details", "Details", "text", "Sizes, colours, material or other details."),
      f("from", "Shared by", "text", "Who shared it."),
      f("date", "Date", "date", "When it was shared."),
    ],
  },
  {
    id: "tasks",
    name: "Follow-ups",
    description: "Requests and promises from your chats — what someone asked you to do, and by when.",
    icon: "list-checks",
    keywords: /\b(tasks?|to-?dos?|follow[- ]?ups?|reminders?|requests?|action items?|promises?)\b/i,
    fields: [
      f("task", "Task", "text", "What needs to be done, written as an action."),
      f("from", "Requested by", "text", "Who asked."),
      f("due", "Due", "date", "Deadline if one was mentioned."),
      f("status", "Status", "status", "Done once you replied that it's done or sent.", TASK_STATUSES),
      f("date", "Asked on", "date", "When it was asked."),
    ],
  },
  {
    id: "support",
    name: "Complaints and support",
    description: "Problems customers raised — damaged items, wrong sizes, refunds — and whether they're resolved.",
    icon: "life-buoy",
    keywords: /\b(complaints?|support|issues?|problems?|tickets?|returns?|refunds?|grievances?)\b/i,
    fields: [
      f("customer", "Customer", "text", "Who raised the issue."),
      f("issue", "Issue", "text", "Short description of the problem."),
      f("status", "Status", "status", "Resolution status.", SUPPORT_STATUSES),
      f("date", "Raised on", "date", "When the issue was raised."),
    ],
  },
  {
    id: "contacts",
    name: "Contacts",
    description: "Everyone you talk to, with numbers, emails and when you last spoke.",
    icon: "contact",
    keywords: /\b(contacts?|people|customers? list|directory|phone numbers?|emails?)\b/i,
    fields: [
      f("name", "Name", "text", "Contact name."),
      f("phone", "Phone", "phone", "Phone number shared in chat."),
      f("email", "Email", "email", "Email address shared in chat."),
      f("chats", "Messages", "number", "Number of messages exchanged."),
      f("last", "Last message", "text", "Most recent message."),
      f("date", "Last active", "date", "Date of the last message."),
    ],
  },
  {
    id: "documents",
    name: "Files and media",
    description: "Every PDF, photo, video and voice note across your chats, in one place.",
    icon: "folder-open",
    keywords: /\b(documents?|files?|pdfs?|attachments?|media|photos?|images?|invoices? pdf)\b/i,
    fields: [
      f("image", "Preview", "image", "Preview for images."),
      f("file", "File", "text", "File name."),
      f("type", "Type", "text", "Document, image, video or audio."),
      f("from", "Shared by", "text", "Who shared it."),
      f("chat", "Chat", "text", "Which chat it came from."),
      f("caption", "Caption", "text", "Message sent with the file."),
      f("date", "Date", "date", "When it was shared."),
    ],
  },
  {
    id: "links",
    name: "Links",
    description: "Every link shared in your chats — with who sent it and why.",
    icon: "link",
    keywords: /\b(links?|urls?|websites?)\b/i,
    fields: [
      f("url", "Link", "url", "The URL."),
      f("domain", "Site", "text", "Website domain."),
      f("from", "Shared by", "text", "Who shared it."),
      f("context", "Context", "text", "The message around the link."),
      f("date", "Date", "date", "When it was shared."),
    ],
  },
];

export const templateById = Object.fromEntries(templates.map((t) => [t.id, t])) as Record<TemplateId, Template | undefined>;

/** Colour for a status badge, matched by meaning so custom statuses look right too. */
export function statusTone(value: string): { bg: string; dot: string } {
  const v = value.toLowerCase();
  const tone = (bg: string, dot: string) => ({ bg, dot });
  if (/deliver|won|resolved|done|complete|paid|closed/.test(v))
    return tone("bg-emerald-500/14 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300", "bg-emerald-500");
  if (/cancel|lost|overdue|failed|refund/.test(v)) return tone("bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300", "bg-rose-500");
  if (/ship|transit|dispatch/.test(v)) return tone("bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300", "bg-sky-500");
  if (/pack/.test(v)) return tone("bg-fuchsia-500/12 text-fuchsia-700 ring-fuchsia-500/25 dark:text-fuchsia-300", "bg-fuchsia-500");
  if (/qualif|proposal|confirm|progress|contacted/.test(v)) return tone("bg-lime-500/16 text-lime-800 ring-lime-500/30 dark:text-lime-300", "bg-lime-500");
  if (/pending|process|waiting|to do|open/.test(v)) return tone("bg-amber-500/14 text-amber-800 ring-amber-500/25 dark:text-amber-300", "bg-amber-500");
  return tone("bg-brand/12 text-brand ring-brand/25", "bg-brand");
}
