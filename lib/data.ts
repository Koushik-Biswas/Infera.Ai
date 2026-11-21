export type OrderStatus = "New" | "Confirmed" | "Paid" | "Shipped" | "Pending";

export type OrderRow = {
  id: string;
  customer: string;
  phone: string;
  purchase: string;
  qty: number;
  value: number;
  status: OrderStatus;
  date: string; // ISO
  source: { chat: string; kind: "text" | "voice" | "image"; text: string };
};

export const orders: OrderRow[] = [
  {
    id: "o1",
    customer: "Anjali Menon",
    phone: "+91 9847• •••••",
    purchase: "Office chairs (ergonomic)",
    qty: 3,
    value: 12000,
    status: "Pending",
    date: "2026-11-16",
    source: { chat: "Anjali Menon", kind: "text", text: "Hi, I want to order 3 office chairs. Total is ₹12,000. I will pay tomorrow. Please deliver by Friday." },
  },
  {
    id: "o2",
    customer: "Rahul Varghese",
    phone: "+91 9037• •••••",
    purchase: "Blue running shoes · UK 9",
    qty: 2,
    value: 5598,
    status: "Paid",
    date: "2026-11-15",
    source: { chat: "Kochi Retail Group", kind: "image", text: "[Payment screenshot] Sent ₹5,598 via UPI for the 2 pairs 👟" },
  },
  {
    id: "o3",
    customer: "Fathima Rasheed",
    phone: "+91 8129• •••••",
    purchase: "Cotton kurtis (assorted)",
    qty: 12,
    value: 9480,
    status: "Confirmed",
    date: "2026-11-15",
    source: { chat: "Fathima Rasheed", kind: "voice", text: "🎙️ “Confirm cheyyunnu, 12 kurtis venam, mixed colours, next week delivery okay.”" },
  },
  {
    id: "o4",
    customer: "Priya Sharma",
    phone: "+91 9901• •••••",
    purchase: "Stainless water bottles",
    qty: 40,
    value: 15600,
    status: "Shipped",
    date: "2026-11-14",
    source: { chat: "Wholesale Buyers 2026", kind: "text", text: "Bhaiya 40 bottles dispatch kar do, tracking bhej dena please" },
  },
  {
    id: "o5",
    customer: "Arjun Nair",
    phone: "+91 9745• •••••",
    purchase: "Basketball · size 7, red",
    qty: 1,
    value: 1499,
    status: "New",
    date: "2026-11-14",
    source: { chat: "Arjun Nair", kind: "text", text: "Is the red basketball size 7 still available? Want one." },
  },
  {
    id: "o6",
    customer: "Meera Krishnan",
    phone: "+91 9446• •••••",
    purchase: "Yoga mats (6mm)",
    qty: 5,
    value: 4250,
    status: "Paid",
    date: "2026-11-13",
    source: { chat: "Meera Krishnan", kind: "image", text: "[GPay receipt] ₹4,250 — for the 5 yoga mats" },
  },
  {
    id: "o7",
    customer: "Sandeep Rao",
    phone: "+91 8884• •••••",
    purchase: "LED desk lamps",
    qty: 8,
    value: 7120,
    status: "Confirmed",
    date: "2026-11-12",
    source: { chat: "Office Supplies – Blr", kind: "text", text: "Go ahead with the 8 LED lamps at ₹890 each. Confirmed." },
  },
  {
    id: "o8",
    customer: "Neha Gupta",
    phone: "+91 9810• •••••",
    purchase: "Blue running shoes · UK 7",
    qty: 1,
    value: 2799,
    status: "New",
    date: "2026-11-12",
    source: { chat: "Neha Gupta", kind: "text", text: "Do you have the blue running shoes in UK 7? Price?" },
  },
];

/** Messages that "arrive" in the live demo and become new or updated rows. */
export const incoming: { message: string; from: string; kind: "text" | "voice" | "image"; row: OrderRow; updates?: string }[] = [
  {
    from: "Anjali Menon",
    kind: "image",
    message: "[UPI screenshot] Paid ₹12,000 for the chairs ✅",
    updates: "o1",
    row: { ...orders[0], status: "Paid" },
  },
  {
    from: "Vikram Iyer",
    kind: "voice",
    message: "🎙️ “Need 20 notebooks and 10 marker sets, send the bill please.”",
    row: {
      id: "n1",
      customer: "Vikram Iyer",
      phone: "+91 9003• •••••",
      purchase: "Notebooks + marker sets",
      qty: 30,
      value: 3650,
      status: "New",
      date: "2026-11-17",
      source: { chat: "Vikram Iyer", kind: "voice", text: "🎙️ “Need 20 notebooks and 10 marker sets, send the bill please.”" },
    },
  },
  {
    from: "Arjun Nair",
    kind: "text",
    message: "Okay confirmed, sending payment for the basketball now",
    updates: "o5",
    row: { ...orders[4], status: "Confirmed" },
  },
  {
    from: "Divya Pillai",
    kind: "text",
    message: "Please book 4 ceramic planters, ₹650 each. Delivery Saturday?",
    row: {
      id: "n2",
      customer: "Divya Pillai",
      phone: "+91 9539• •••••",
      purchase: "Ceramic planters",
      qty: 4,
      value: 2600,
      status: "New",
      date: "2026-11-17",
      source: { chat: "Divya Pillai", kind: "text", text: "Please book 4 ceramic planters, ₹650 each. Delivery Saturday?" },
    },
  },
];

export const chats = [
  { name: "Kochi Retail Group", preview: "Rahul: 📷 Photo", time: "10:42", unread: 12, group: true, color: "#5b4bff" },
  { name: "Anjali Menon", preview: "I will pay tomorrow 🙏", time: "10:31", unread: 2, color: "#ff8a3d" },
  { name: "Fathima Rasheed", preview: "🎙️ Voice message · 0:24", time: "09:58", unread: 1, color: "#12b76a" },
  { name: "Wholesale Buyers 2026", preview: "Priya: tracking bhej dena", time: "09:12", unread: 34, group: true, color: "#e5484d" },
  { name: "Arjun Nair", preview: "Is the red basketball…", time: "Yesterday", unread: 0, color: "#0090ff" },
  { name: "Vendors – Coimbatore", preview: "📄 Invoice_NOV.pdf", time: "Yesterday", unread: 5, group: true, color: "#a855f7" },
  { name: "Meera Krishnan", preview: "📷 GPay receipt", time: "Mon", unread: 0, color: "#d97706" },
];

export const formatINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

export const formatDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export const statusStyle: Record<OrderStatus, string> = {
  New: "bg-brand/12 text-brand ring-brand/25",
  Confirmed: "bg-sky-500/12 text-sky-600 ring-sky-500/25 dark:text-sky-400",
  Pending: "bg-amber-500/14 text-amber-700 ring-amber-500/25 dark:text-amber-400",
  Paid: "bg-brand-2/14 text-emerald-700 ring-brand-2/30 dark:text-brand-2",
  Shipped: "bg-zinc-500/12 text-fg-soft ring-zinc-500/25",
};

export const statusDot: Record<OrderStatus, string> = {
  New: "bg-brand",
  Confirmed: "bg-sky-500",
  Pending: "bg-amber-500",
  Paid: "bg-brand-2",
  Shipped: "bg-zinc-400",
};
