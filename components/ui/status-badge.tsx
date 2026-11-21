import { statusDot, statusStyle, type OrderStatus } from "@/lib/data";

export function StatusBadge({ status, className = "" }: { status: OrderStatus; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${statusStyle[status]} ${className}`}
    >
      <span className={`size-1.5 rounded-full ${statusDot[status]}`} aria-hidden />
      {status}
    </span>
  );
}

export function Avatar({ name, color, className = "size-7 text-[11px]" }: { name: string; color?: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${className}`}
      style={{ background: color ?? `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + 40) % 360} 70% 48%))` }}
    >
      {initials}
    </span>
  );
}
