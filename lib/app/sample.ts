/** A realistic sample workspace (a Kochi clothing boutique) so the app is useful before you import anything. */
import type { Chat, Message } from "./types";

type Att = { name: string; kind: "image" | "document" | "audio" | "contact"; art?: Art; pdf?: string[] };
type Art = { label: string; price: string; bg: string; fg: string; shape: "shirt" | "dress" | "pants" | "sweater" | "receipt" };
type Line = [day: number, time: string, who: string, text: string, att?: Att];

const ME = "me";

const convs: { name: string; group?: boolean; color: string; unread?: number; pinned?: boolean; lines: Line[] }[] = [
  {
    name: "Anjali Menon",
    color: "#ff8a3d",
    pinned: true,
    lines: [
      [-8, "10:12", "Anjali Menon", "Hi! I want to order 3 linen co-ord sets in sage, size M. What's the total?"],
      [-8, "10:20", ME, "Hi Anjali 😊 3 linen co-ord sets come to ₹7,497. Delivery in 3-4 days."],
      [-8, "10:24", "Anjali Menon", "Perfect, confirmed. Deliver to Panampilly Nagar, Kochi 682036"],
      [-8, "10:31", "Anjali Menon", "Paid ₹7,497 via GPay ✅", { name: "IMG-pay-anjali.jpg", kind: "image", art: { label: "GPay · Paid", price: "₹7,497", bg: "#e8f5ee", fg: "#12814f", shape: "receipt" } }],
      [-7, "16:05", ME, "Your order is packed and shipped! Tracking: https://www.delhivery.com/track/package/1428830021"],
      [-5, "12:40", "Anjali Menon", "Received the parcel, the fabric is lovely. Thank you!"],
    ],
  },
  {
    name: "Rahul Varghese",
    color: "#0090ff",
    unread: 2,
    lines: [
      [-2, "18:10", "Rahul Varghese", "Hello, do you have the oversized shirts in white? Size L"],
      [-2, "18:22", ME, "Yes! Oversized cotton shirt, white, L is in stock. ₹1,299 each."],
      [-1, "09:15", "Rahul Varghese", "Great. I want 2 oversized shirts. Total ₹2,598 right? I will pay tomorrow."],
      [0, "09:41", "Rahul Varghese", "Can you deliver by Saturday? My number is +91 98470 12345"],
    ],
  },
  {
    name: "Fathima Rasheed",
    color: "#12b76a",
    unread: 1,
    lines: [
      [-4, "11:02", "Fathima Rasheed", "I'd like to know if you have this in black", { name: "IMG-midi-dress.jpg", kind: "image", art: { label: "Summer midi dress", price: "₹2,150", bg: "#fdebd3", fg: "#a85a12", shape: "dress" } }],
      [-4, "11:30", ME, "Yes, the summer midi dress is available in black, sizes S–L. ₹2,150."],
      [-3, "15:44", "Fathima Rasheed", "Go ahead, book 1 black summer midi dress in S."],
      [-3, "15:52", "Fathima Rasheed", "Paid ₹2,150 on PhonePe. UTR 412233445566"],
      [-2, "13:00", ME, "Packed and ready to ship tomorrow morning 📦"],
    ],
  },
  {
    name: "Kochi Retail Group",
    group: true,
    color: "#5b4bff",
    unread: 12,
    lines: [
      [-6, "09:00", "Priya Sharma", "Need 40 cotton kurtis for the Edappally store. Please deliver to Edappally, Kochi 682024"],
      [-6, "09:20", ME, "Sure Priya, 40 cotton kurtis at ₹390 each, total ₹15,600. Confirm?"],
      [-6, "09:26", "Priya Sharma", "Confirmed 👍 send the invoice please"],
      [-5, "14:10", "Sandeep Rao", "Please send the price list PDF for the winter range"],
      [-5, "14:18", ME, "Here you go", { name: "Winter range price list.pdf", kind: "document", pdf: ["Studio Linen — Winter range 2026", "Cable knit sweater (cream) .... Rs 2,299", "Wool blend overshirt .......... Rs 2,899", "Relaxed linen trousers ........ Rs 1,799", "Classic polo (olive) .......... Rs 999", "Wholesale: 12+ pcs, 15% off"] }],
      [-4, "10:05", "Meera Krishnan", "2 pieces from yesterday's batch arrived damaged, need replacement please"],
      [-4, "10:30", ME, "So sorry Meera! Replacement dispatched today, tracking shared shortly."],
      [-2, "17:45", "Meera Krishnan", "Received the replacement, all good now. Thanks!"],
      [-1, "11:11", "Sandeep Rao", "Book 24 classic polo t-shirts in olive for our Kakkanad outlet. Can you deliver next week?"],
      [0, "08:50", "Priya Sharma", "Payment of ₹15,600 done via NEFT. Ref NEFT88219034"],
    ],
  },
  {
    name: "Arjun Nair",
    color: "#e5484d",
    lines: [
      [-3, "12:00", "Arjun Nair", "Hi, I run a café in Kakkanad. Interested in staff uniforms — 30 linen aprons and shirts."],
      [-3, "12:15", ME, "Lovely! We do custom uniforms. What's your budget and timeline?"],
      [-3, "12:20", "Arjun Nair", "Budget around ₹45,000. Need them before 15 Dec. Can we schedule a call tomorrow?"],
      [-2, "16:00", ME, "Sharing the quotation for 30 sets. Let me know!"],
    ],
  },
  {
    name: "Vendors – Coimbatore",
    group: true,
    color: "#a855f7",
    unread: 5,
    lines: [
      [-7, "10:00", "Senthil (Mill)", "Invoice for November fabric supply", { name: "Invoice_NOV.pdf", kind: "document", pdf: ["Sri Murugan Textiles, Coimbatore", "Invoice INV-2026-1142", "Linen 60s count — 400 m", "Cotton slub — 300 m", "Total: Rs 1,20,000", "Due: 30 days"] }],
      [-7, "10:02", "Senthil (Mill)", "Payment of ₹1,20,000 pending. Please clear by Friday."],
      [-6, "19:30", ME, "Received, will pay by Friday."],
      [-1, "10:15", "Senthil (Mill)", "Next lot dispatched. Track here https://www.dtdc.in/tracking/D7783301124"],
    ],
  },
  {
    name: "Neha Gupta",
    color: "#d97706",
    lines: [
      [-1, "20:05", "Neha Gupta", "Do you have the pleated pants in beige? Size 30"],
      [-1, "20:12", ME, "Pleated wide-leg pants — beige ₹1,899", { name: "IMG-pleated.jpg", kind: "image", art: { label: "Pleated wide-leg pants", price: "₹1,899", bg: "#efe7da", fg: "#7a6347", shape: "pants" } }],
      [0, "08:30", "Neha Gupta", "Book 2 please! Sending payment now"],
      [0, "08:41", "Neha Gupta", "Paid ₹3,798 via PhonePe UTR 418812239901", { name: "IMG-pay-neha.jpg", kind: "image", art: { label: "PhonePe · Paid", price: "₹3,798", bg: "#efe6fb", fg: "#5f259f", shape: "receipt" } }],
    ],
  },
  {
    name: "Divya Pillai",
    color: "#0ea5a4",
    unread: 6,
    lines: [
      [0, "11:20", "Divya Pillai", "Hi! Here are the product images and details for the new collections. Can you add these to the sheets?"],
      [0, "11:26", "Divya Pillai", "Linen shirt – sage ₹1,499", { name: "IMG-linen-shirt.jpg", kind: "image", art: { label: "Linen shirt · sage", price: "₹1,499", bg: "#e3ece2", fg: "#4c6b4a", shape: "shirt" } }],
      [0, "11:26", "Divya Pillai", "Classic polo – olive ₹999", { name: "IMG-polo.jpg", kind: "image", art: { label: "Classic polo · olive", price: "₹999", bg: "#e6e8d8", fg: "#5d6332", shape: "shirt" } }],
      [0, "11:26", "Divya Pillai", "Cable knit sweater – cream ₹2,299", { name: "IMG-sweater.jpg", kind: "image", art: { label: "Cable knit sweater", price: "₹2,299", bg: "#f3eee4", fg: "#8a7a5c", shape: "sweater" } }],
      [0, "11:26", "Divya Pillai", "Relaxed linen trousers – stone ₹1,799", { name: "IMG-trousers.jpg", kind: "image", art: { label: "Relaxed linen trousers", price: "₹1,799", bg: "#ebe5dc", fg: "#6e604c", shape: "pants" } }],
      [0, "11:27", "Divya Pillai", "", { name: "Product details.pdf", kind: "document", pdf: ["New collection — product details", "Linen shirt (sage) — 100% linen — S to XXL — Rs 1,499", "Classic polo (olive) — pique cotton — S to XL — Rs 999", "Cable knit sweater (cream) — wool blend — Rs 2,299", "Relaxed linen trousers (stone) — Rs 1,799", "All items in stock"] }],
      [0, "11:28", "Divya Pillai", "Also, please update the pricing in the sheet and mark them as in stock."],
    ],
  },
  {
    name: "Vikram Iyer",
    color: "#64748b",
    lines: [
      [-5, "15:00", "Vikram Iyer", "Hi, Vikram from Iyer Events. Looking for 120 printed linen t-shirts for a corporate offsite in Bengaluru. Email: vikram@iyerevents.in"],
      [-5, "15:40", ME, "Hi Vikram! Sending a quotation: ₹540 per tee, total ₹64,800."],
      [-4, "10:10", "Vikram Iyer", "Looks good. Let's go ahead — sending the advance of ₹20,000 today."],
      [-4, "17:30", "Vikram Iyer", "Paid the advance ₹20,000 via IMPS. Please share the invoice."],
      [-1, "12:00", "Vikram Iyer", "Could you send the print proofs by Friday?"],
    ],
  },
];

/* ------------------------------ Artwork ----------------------------- */

const SHAPES: Record<Art["shape"], string> = {
  shirt: "M140 70 L200 50 Q240 80 280 50 L340 70 L390 140 L345 165 L330 145 L330 330 L150 330 L150 145 L135 165 L90 140 Z",
  dress: "M200 50 L280 50 L295 110 L270 150 L350 330 L130 330 L210 150 L185 110 Z",
  pants: "M165 60 L315 60 L330 330 L265 330 L240 150 L215 330 L150 330 Z",
  sweater: "M145 75 L205 55 Q240 75 275 55 L335 75 L395 250 L350 262 L330 170 L330 330 L150 330 L150 170 L130 262 L85 250 Z",
  receipt: "M150 50 L330 50 L330 330 L310 315 L290 330 L270 315 L250 330 L230 315 L210 330 L190 315 L170 330 L150 315 Z",
};

function svgFor(a: Art) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480"><rect width="480" height="480" fill="${a.bg}"/><path d="${SHAPES[a.shape]}" transform="translate(0 20)" fill="${a.fg}" opacity="0.85"/>${
    a.shape === "receipt"
      ? `<g fill="#fff" opacity="0.9"><rect x="180" y="120" width="120" height="10" rx="5"/><rect x="180" y="150" width="90" height="10" rx="5"/><rect x="180" y="180" width="110" height="10" rx="5"/><circle cx="240" cy="260" r="26"/></g>`
      : `<path d="M240 90 L240 340" transform="translate(0 20)" stroke="#fff" stroke-opacity="0.18" stroke-width="3"/>`
  }<rect x="24" y="398" width="432" height="58" rx="16" fill="#fff" fill-opacity="0.85"/><text x="44" y="434" font-family="Inter,Arial,sans-serif" font-size="20" font-weight="600" fill="#1f2937">${esc(a.label)}</text><text x="436" y="434" text-anchor="end" font-family="Inter,Arial,sans-serif" font-size="20" font-weight="700" fill="${a.fg}">${esc(a.price)}</text></svg>`;
}

/** A small but valid one-page PDF. */
export function makePdf(lines: string[]) {
  const text = lines
    .map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 56 ${770 - i * 26} Td (${l.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "-")}) Tj ET`)
    .join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out], { type: "application/pdf" });
}

/* ------------------------------ Builder ----------------------------- */

export function buildSample(now = Date.now()) {
  const chats: Chat[] = [];
  const messages: Message[] = [];
  const blobs: { id: string; blob: Blob }[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  convs.forEach((c, ci) => {
    const chatId = `sample_${ci}`;
    const participants = new Set<string>();
    c.lines.forEach(([day, time, who, text, att], li) => {
      const [h, m] = time.split(":").map(Number);
      let at = today.getTime() + day * 86_400_000 + (h * 60 + m) * 60_000;
      if (at > now) at = now - (c.lines.length - li) * 60_000; // keep "today" messages in the past
      const id = `${chatId}_m${li}`;
      if (who !== ME) participants.add(who);
      const msg: Message = { id, chatId, at, sender: who === ME ? "You" : who, fromMe: who === ME, text, kind: att?.kind ?? "text" };
      if (att) {
        const blobId = `${id}_a`;
        const blob = att.art ? new Blob([svgFor(att.art)], { type: "image/svg+xml" }) : att.pdf ? makePdf(att.pdf) : null;
        if (blob) blobs.push({ id: blobId, blob });
        msg.attachment = { id: blob ? blobId : undefined, name: att.name, mime: blob?.type ?? "application/octet-stream", size: blob?.size };
      }
      messages.push(msg);
    });
    const last = messages.filter((m) => m.chatId === chatId).at(-1)!;
    chats.push({
      id: chatId,
      name: c.name,
      isGroup: Boolean(c.group),
      color: c.color,
      participants: [...participants],
      lastAt: last.at,
      preview: previewOf(last, c.group),
      unread: c.unread ?? 0,
      pinned: c.pinned,
      source: "sample",
    });
  });
  return { chats, messages, blobs };
}

export function previewOf(m: Message, group?: boolean) {
  const label: Record<string, string> = { image: "📷 Photo", video: "🎥 Video", audio: "🎙️ Voice message", document: "📄 " + (m.attachment?.name ?? "Document"), contact: "👤 Contact", sticker: "Sticker", deleted: "🚫 Message deleted" };
  const body = m.text || label[m.kind] || "";
  const prefix = m.fromMe ? "You: " : group && m.sender ? `${m.sender.split(" ")[0]}: ` : "";
  return (prefix + body).slice(0, 90);
}
