import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/** Centered, static frame for /login, /signup, /invite/[token] and /onboarding. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-bg">
      <div aria-hidden className="bg-grid mask-fade-b pointer-events-none absolute inset-x-0 top-0 h-[28rem] opacity-70" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 h-96 bg-[radial-gradient(50%_60%_at_50%_40%,var(--glow-a),transparent)]" />
      <header className="relative flex items-center justify-between px-5 py-4 sm:px-8">
        <Logo />
        <ThemeToggle />
      </header>
      <main id="main" className="relative flex flex-1 justify-center px-4 pt-4 pb-12 sm:items-center sm:pt-0">
        <div className="w-full max-w-[27rem]">{children}</div>
      </main>
      <footer className="relative flex flex-wrap justify-center gap-x-5 gap-y-1 px-4 pb-6 text-xs text-muted">
        <Link href="/privacy" className="hover:text-fg">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-fg">
          Terms
        </Link>
        <Link href="/security" className="hover:text-fg">
          Security
        </Link>
        <Link href="/support" className="hover:text-fg">
          Support
        </Link>
      </footer>
    </div>
  );
}
