export type Variant = "primary" | "secondary" | "ghost" | "brand";
export type Size = "sm" | "md" | "lg";

const variantCls: Record<Variant, string> = {
  primary:
    "bg-fg text-bg hover:bg-fg/90 shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset,0_8px_20px_-8px_rgba(0,0,0,0.45)]",
  brand:
    "text-white bg-[linear-gradient(135deg,var(--brand),color-mix(in_oklab,var(--brand)_60%,var(--brand-2)))] hover:brightness-110 shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset,0_10px_30px_-10px_var(--brand)]",
  secondary: "surface text-fg hover:border-line-strong",
  ghost: "text-fg-soft hover:text-fg hover:bg-sunken",
};

const sizeCls: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-13 px-7 text-[15px]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `group inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${variantCls[variant]} ${sizeCls[size]} ${extra}`;
}
