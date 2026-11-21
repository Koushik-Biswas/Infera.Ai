import type { ReactNode } from "react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";

export function LegalPage({
  eyebrow,
  title,
  updated,
  intro,
  sections,
  aside,
}: {
  eyebrow: string;
  title: string;
  updated?: string;
  intro: ReactNode;
  sections: { id: string; title: string; body: ReactNode }[];
  aside?: ReactNode;
}) {
  return (
    <>
      <Navbar />
      <main id="main" className="relative pt-36 pb-24">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]">
          <div className="bg-grid mask-fade-b absolute inset-0 opacity-60" />
        </div>
        <div className="container-x">
          <header className="max-w-3xl">
            <p className="text-sm font-medium text-brand">{eyebrow}</p>
            <h1 className="mt-3 text-4xl leading-[1.05] font-semibold tracking-[-0.035em] sm:text-5xl">{title}</h1>
            {updated && <p className="mt-4 text-sm text-muted">Last updated {updated}</p>}
            <div className="mt-6 text-lg leading-relaxed text-muted">{intro}</div>
          </header>

          <div className="mt-14 grid gap-12 lg:grid-cols-[220px_1fr]">
            <nav aria-label="On this page" className="hidden lg:block">
              <div className="sticky top-28">
                <p className="text-xs font-medium tracking-wider text-muted uppercase">On this page</p>
                <ul className="mt-3 space-y-2 border-l border-line">
                  {sections.map((s) => (
                    <li key={s.id}>
                      <a href={`#${s.id}`} className="-ml-px block border-l border-transparent pl-4 text-sm text-muted transition hover:border-fg hover:text-fg">
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
                {aside && <div className="mt-8">{aside}</div>}
              </div>
            </nav>

            <article className="max-w-3xl space-y-12">
              {sections.map((s) => (
                <section key={s.id} id={s.id} className="scroll-mt-28">
                  <h2 className="text-2xl font-semibold tracking-tight">{s.title}</h2>
                  <div className="mt-4 space-y-4 leading-relaxed text-fg-soft [&_li]:pl-1 [&_strong]:text-fg [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:marker:text-muted">
                    {s.body}
                  </div>
                </section>
              ))}
            </article>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
