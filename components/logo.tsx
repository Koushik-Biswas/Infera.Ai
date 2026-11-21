import Link from "next/link";

export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="infera-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand)" />
          <stop offset="1" stopColor="var(--brand-2)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#infera-g)" />
      <path d="M19 21h26M19 32h26M19 43h14" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <circle cx="44.5" cy="43" r="4.2" fill="#fff" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="Infera.Ai home">
      <LogoMark className="size-8 transition-transform duration-300 group-hover:rotate-[-6deg]" />
      <span className="text-[17px] font-semibold tracking-tight">
        Infera<span className="text-muted">.Ai</span>
      </span>
    </Link>
  );
}
