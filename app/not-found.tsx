import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonClass } from "@/components/ui/button-class";

// The root not-found page is bundled into every route's entry JavaScript, so it must stay
// light: a static header instead of the animated marketing <Navbar /> (which pulls in ~150 KB
// of animation code for every console page).
export default function NotFound() {
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-line">
        <nav className="container-x flex h-16 items-center justify-between gap-6" aria-label="Primary">
          <Logo />
          <Link href="/" className="rounded-full px-3.5 py-2 text-sm text-muted transition-colors hover:text-fg">
            Home
          </Link>
        </nav>
      </header>
      <main id="main" className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <p className="font-mono text-sm text-brand">404</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">This row doesn&apos;t exist.</h1>
          <p className="mt-4 text-muted">We searched every collection. The page you&apos;re looking for isn&apos;t here.</p>
          <Link href="/" className={buttonClass("primary", "md", "mt-8")}>
            Back to home
          </Link>
        </div>
      </main>
    </>
  );
}
