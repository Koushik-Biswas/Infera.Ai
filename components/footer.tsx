import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeSegmented } from "@/components/theme-toggle";
import { DemoLink } from "@/components/demo-link";
import { site } from "@/lib/site";

const groups = [
  {
    title: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#collections", label: "Collections" },
      { href: "/#encryption", label: "Encryption" },
      { href: "/#whats-next", label: "What's next" },
      { href: "/download", label: "Download" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/support", label: "Support" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/security", label: "Security" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-8 border-t border-line">
      <div className="container-x py-16">
        <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-muted">
              The intelligent inbox. Clean, structured data from the conversations that run your business.
            </p>
            <div className="mt-6">
              <ThemeSegmented />
            </div>
          </div>
          {groups.map((g) => (
            <div key={g.title}>
              <p className="text-sm font-semibold">{g.title}</p>
              <ul className="mt-4 space-y-2.5">
                {g.title === "Company" && (
                  <li>
                    <DemoLink className="text-sm text-muted transition hover:text-fg">Get a demo</DemoLink>
                  </li>
                )}
                {g.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-sm text-muted transition hover:text-fg">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-line pt-8 text-sm text-muted sm:flex-row sm:items-center">
          <p>
            © {new Date().getFullYear()} {site.name}. All rights reserved.
          </p>
          <p className="flex items-center gap-3">
            <span>v{site.version}</span>
            <span className="h-3 w-px bg-line-strong" />
            <span>Made in India</span>
          </p>
        </div>
        <p className="mt-6 text-xs leading-relaxed text-muted/80">
          WhatsApp is a trademark of its respective owner. Infera.Ai is an independent product and is not affiliated with, endorsed or
          sponsored by WhatsApp or Meta.
        </p>
      </div>

      <div aria-hidden className="pointer-events-none overflow-hidden select-none">
        <p className="text-gradient -mb-[0.22em] text-center text-[22vw] leading-none font-semibold tracking-[-0.06em] opacity-[0.14]">
          Infera
        </p>
      </div>
    </footer>
  );
}
