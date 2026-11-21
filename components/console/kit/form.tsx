"use client";

/**
 * Buttons and form controls for the console. Every control is labelled,
 * shows its error, and uses ≤150 ms CSS transitions.
 */
import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Spinner } from "./surface";

/* ------------------------------ Buttons ----------------------------- */

export type ButtonVariant = "primary" | "brand" | "secondary" | "ghost" | "danger" | "danger-ghost";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const variantCls: Record<ButtonVariant, string> = {
  primary: "bg-fg text-bg hover:bg-fg/88 shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset,0_6px_16px_-8px_rgba(0,0,0,0.45)]",
  brand:
    "text-white bg-[linear-gradient(135deg,var(--brand),color-mix(in_oklab,var(--brand)_60%,var(--brand-2)))] hover:brightness-110 shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset,0_8px_24px_-12px_var(--brand)]",
  secondary: "surface text-fg hover:border-line-strong hover:bg-sunken/60",
  ghost: "text-fg-soft hover:bg-sunken hover:text-fg",
  danger: "bg-rose-600 text-white hover:bg-rose-500 dark:bg-rose-500 dark:hover:bg-rose-400",
  "danger-ghost": "text-rose-700 hover:bg-rose-500/10 dark:text-rose-400",
};

const sizeCls: Record<ButtonSize, string> = {
  xs: "h-7 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5",
  sm: "h-8 gap-1.5 px-3 text-[13px] [&_svg]:size-4",
  md: "h-10 gap-2 px-4 text-sm [&_svg]:size-4",
  lg: "h-11 gap-2 px-5 text-sm [&_svg]:size-4",
};

/**
 * Class string for console buttons (also for `<Link>`s styled as buttons):
 * `buttonCls("secondary", "sm", "w-full")`. Same look as the site's `buttonClass`, console sizes, 150 ms transitions.
 */
export function buttonCls(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = "") {
  return `relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,filter,transform,opacity] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 ${variantCls[variant]} ${sizeCls[size]} ${extra}`;
}

/**
 * Button with an instant pending state. Pass `pending`, or return a Promise from `onClick` — the button then
 * shows a spinner and ignores clicks until it settles (no double submits). `icon` sits before the label and is
 * swapped for the spinner while pending, so the width never changes.
 */
export function Button({
  variant = "secondary",
  size = "md",
  pending: pendingProp,
  icon,
  iconRight,
  className = "",
  children,
  onClick,
  disabled,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pending?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => unknown;
}) {
  const [busy, setBusy] = useState(false);
  const pending = Boolean(pendingProp) || busy;
  const handle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (pending) {
      e.preventDefault();
      return;
    }
    const r = onClick?.(e);
    if (r && typeof (r as Promise<unknown>).then === "function") {
      setBusy(true);
      (r as Promise<unknown>).then(
        () => setBusy(false),
        () => setBusy(false),
      );
    }
  };
  const spin = <Spinner className={size === "xs" ? "size-3" : "size-3.5"} />;
  return (
    <button
      type={type}
      {...rest}
      onClick={handle}
      disabled={disabled}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      className={buttonCls(variant, size, `${pending ? "cursor-progress" : ""} ${className}`)}
    >
      {icon ? (pending ? spin : <span className="contents" aria-hidden>{icon}</span>) : null}
      {!icon && pending ? (
        <>
          <span className="invisible contents">{children}</span>
          <span className="absolute inset-0 grid place-items-center">{spin}</span>
        </>
      ) : (
        children
      )}
      {iconRight && <span className="contents" aria-hidden>{iconRight}</span>}
    </button>
  );
}

/** Round icon-only button with an accessible label (also shown as a tooltip). */
export function IconButton({
  label,
  children,
  size = "md",
  active,
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "sm" | "md"; active?: boolean }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      {...rest}
      className={`grid shrink-0 place-items-center rounded-full text-fg-soft transition-colors duration-150 hover:bg-sunken hover:text-fg disabled:pointer-events-none disabled:opacity-50 ${size === "sm" ? "size-7 [&_svg]:size-3.5" : "size-9 [&_svg]:size-4"} ${active ? "bg-sunken text-fg" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------- Fields ----------------------------- */

/** Base class for text inputs/selects (matches the app's `inputCls`, plus error and disabled states). */
export const fieldCls =
  "h-10 w-full rounded-xl border border-line bg-elev px-3 text-sm text-fg outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70 [&[readonly]]:bg-sunken/60 aria-invalid:border-rose-500 aria-invalid:focus:ring-rose-500/30";

/**
 * Label + control + hint + error. Use directly around custom controls, or let
 * `TextField`/`TextArea`/`Select` render it via their `label` prop.
 */
export function FieldRow({
  label,
  htmlFor,
  hint,
  error,
  required,
  aside,
  children,
  hintId,
  errorId,
  className = "",
}: {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  aside?: ReactNode;
  children: ReactNode;
  hintId?: string;
  errorId?: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      {(label || aside) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {label && (
            <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg-soft">
              {label}
              {required && (
                <span className="ml-0.5 text-rose-600" aria-hidden>
                  *
                </span>
              )}
            </label>
          )}
          {aside && <span className="text-xs text-muted">{aside}</span>}
        </div>
      )}
      {children}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type FieldExtras = { label?: ReactNode; hint?: ReactNode; error?: string | null; aside?: ReactNode; containerClassName?: string };

/** Text input with label, hint and error wiring (`aria-invalid`, `aria-describedby`). `leading`/`trailing` add adornments. */
export function TextField({
  label,
  hint,
  error,
  aside,
  containerClassName = "",
  className = "",
  id,
  leading,
  trailing,
  required,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & FieldExtras & { leading?: ReactNode; trailing?: ReactNode }) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  return (
    <FieldRow label={label} htmlFor={inputId} hint={hint} error={error} aside={aside} required={required} hintId={hintId} errorId={errorId} className={containerClassName}>
      <div className="relative">
        {leading && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted [&_svg]:size-4">{leading}</span>}
        <input
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          {...rest}
          className={`${fieldCls} ${leading ? "pl-9" : ""} ${trailing ? "pr-10" : ""} ${className}`}
        />
        {trailing && <span className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</span>}
      </div>
    </FieldRow>
  );
}

/** Multi-line text input with label, hint and error. */
export function TextArea({ label, hint, error, aside, containerClassName = "", className = "", id, required, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldExtras) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <FieldRow label={label} htmlFor={inputId} hint={hint} error={error} aside={aside} required={required} hintId={`${inputId}-hint`} errorId={`${inputId}-error`} className={containerClassName}>
      <textarea
        id={inputId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        {...rest}
        className={`${fieldCls} h-auto min-h-20 resize-y py-2 leading-relaxed ${className}`}
      />
    </FieldRow>
  );
}

/** One option of a `Select`. */
export type SelectOption = { value: string; label: string; disabled?: boolean };

/** Native select (fast, accessible, mobile-friendly) styled like the inputs. Pass `options` or `<option>` children. */
export function Select({
  label,
  hint,
  error,
  aside,
  containerClassName = "",
  className = "",
  id,
  options,
  children,
  size = "md",
  required,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & FieldExtras & { options?: SelectOption[]; size?: "sm" | "md" }) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <FieldRow label={label} htmlFor={inputId} hint={hint} error={error} aside={aside} required={required} hintId={`${inputId}-hint`} errorId={`${inputId}-error`} className={containerClassName}>
      <div className="relative">
        <select
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          {...rest}
          className={`${fieldCls} cursor-pointer appearance-none pr-9 ${size === "sm" ? "h-8 rounded-lg text-[13px]" : ""} ${className}`}
        >
          {options?.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      </div>
    </FieldRow>
  );
}

/** Checkbox with label and optional description. */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  name,
  value,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  name?: string;
  value?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`flex items-start gap-2.5 ${disabled ? "opacity-60" : ""} ${className}`}>
      <input
        id={id}
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={description ? `${id}-d` : undefined}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded accent-brand disabled:cursor-not-allowed"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-fg select-none">
          {label}
        </label>
        {description && (
          <p id={`${id}-d`} className="text-xs text-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

/** On/off switch (`role="switch"`). Needs an accessible `label`. */
export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-brand" : "bg-line-strong"}`}
    >
      <span aria-hidden className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform duration-150 ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

/** A labelled settings row with a `Switch` on the right. */
export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  className = "",
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        {description && <div className="mt-0.5 text-[13px] text-muted">{description}</div>}
      </div>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} label={typeof label === "string" ? label : "Toggle"} />
    </div>
  );
}

/** One choice of `RadioCards`. */
export type RadioCardOption<V extends string> = { value: V; label: ReactNode; description?: ReactNode; icon?: ReactNode; badge?: ReactNode };

/** Radio group rendered as selectable cards (native radios, keyboard arrows work). */
export function RadioCards<V extends string>({
  name,
  value,
  onChange,
  options,
  disabled,
  columns = 3,
  legend,
  className = "",
}: {
  name: string;
  value: V;
  onChange: (v: V) => void;
  options: RadioCardOption<V>[];
  disabled?: boolean;
  columns?: 1 | 2 | 3;
  legend?: ReactNode;
  className?: string;
}) {
  const cols = columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "";
  return (
    <fieldset className={className} disabled={disabled}>
      {legend && <legend className="mb-1.5 text-[13px] font-medium text-fg-soft">{legend}</legend>}
      <div className={`grid gap-2 ${cols}`}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <label
              key={o.value}
              className={`relative flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-[border-color,background-color,box-shadow] duration-150 has-focus-visible:ring-2 has-focus-visible:ring-[var(--ring)] has-disabled:cursor-not-allowed has-disabled:opacity-70 ${
                active ? "border-brand bg-brand/6 ring-1 ring-brand/40" : "border-line bg-elev hover:border-line-strong"
              }`}
            >
              <input type="radio" name={name} value={o.value} checked={active} onChange={() => onChange(o.value)} className="sr-only" />
              <span className="flex items-center gap-2 text-sm font-medium text-fg">
                {o.icon && <span className={`[&_svg]:size-4 ${active ? "text-brand" : "text-muted"}`}>{o.icon}</span>}
                <span className="flex-1">{o.label}</span>
                {o.badge}
                <span aria-hidden className={`grid size-4 place-items-center rounded-full border ${active ? "border-brand" : "border-line-strong"}`}>
                  {active && <span className="size-2 rounded-full bg-brand" />}
                </span>
              </span>
              {o.description && <span className="text-[13px] leading-snug text-muted">{o.description}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Search box with a magnifier and a clear button. Debounce the value with `useDebounced` before fetching. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  label = "Search",
  className = "",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        className={`${fieldCls} h-9 pr-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none`}
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-sunken hover:text-fg">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
