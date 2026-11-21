import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, CalendarCheck, LifeBuoy, Mail } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { DemoLink } from "@/components/demo-link";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Support", description: "Get help with Infera." };

const cards = [
  { icon: Mail, title: "Email support", body: "We usually reply within a few hours on business days.", cta: site.supportEmail, href: `mailto:${site.supportEmail}` },
  { icon: BookOpen, title: "FAQ", body: "Pricing, history backfill, connecting WhatsApp and more.", cta: "Read the FAQ", href: "/#faq" },
  { icon: LifeBuoy, title: "Security", body: "How we encrypt and protect your conversations.", cta: "Security overview", href: "/security" },
];

const troubleshooting: [string, string][] = [
  [
    "The QR code won't scan",
    "Make sure your phone is online, update WhatsApp, and try WhatsApp → Linked devices → Link a device again. Increase screen brightness if the camera struggles.",
  ],
  [
    "My WhatsApp session disconnected",
    "WhatsApp may unlink devices after long inactivity. Open Infera and tap Re-link — your collections and history stay intact, and syncing resumes where it stopped.",
  ],
  [
    "Older messages are missing",
    "Infera backfills as far as WhatsApp makes history available on your device and backup. The Backfill panel shows exactly how far back it reached.",
  ],
  [
    "A row has the wrong value",
    "Click the cell to correct it. Manual edits are never overwritten by later automatic updates without asking you.",
  ],
];

export default function SupportPage() {
  return (
    <>
      <Navbar />
      <main id="main" className="relative pt-36 pb-24">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]">
          <div className="bg-grid mask-fade-b absolute inset-0 opacity-60" />
        </div>
        <div className="container-x">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-brand">Support</p>
            <h1 className="mt-3 text-4xl leading-[1.05] font-semibold tracking-[-0.035em] sm:text-5xl">How can we help?</h1>
            <p className="mt-5 text-lg text-muted">Real people, fast answers. Pick whatever works for you.</p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {cards.map((c) => (
              <Link key={c.title} href={c.href} className="surface group rounded-3xl p-6 transition hover:-translate-y-0.5">
                <c.icon className="size-5 text-brand" />
                <p className="mt-4 font-semibold">{c.title}</p>
                <p className="mt-1 text-sm text-muted">{c.body}</p>
                <p className="mt-5 text-sm font-medium text-fg group-hover:underline">{c.cta} →</p>
              </Link>
            ))}
          </div>

          <div className="surface mt-4 flex flex-col items-start justify-between gap-4 rounded-3xl p-6 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <CalendarCheck className="size-5 text-brand-2" />
              <p className="text-sm">
                <strong>Setting Infera up for a team?</strong> <span className="text-muted">We&apos;ll walk you through it.</span>
              </p>
            </div>
            <DemoLink className="inline-flex h-10 items-center rounded-full bg-fg px-5 text-sm font-medium text-bg hover:opacity-90">
              Get a demo
            </DemoLink>
          </div>

          <h2 className="mt-20 text-2xl font-semibold tracking-tight">Troubleshooting</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {troubleshooting.map(([q, a]) => (
              <div key={q} className="rounded-3xl border border-line p-6">
                <p className="font-semibold">{q}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
