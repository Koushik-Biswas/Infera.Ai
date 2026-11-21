"use client";

/**
 * Overlays: modal Dialog, side Drawer, ConfirmDialog, Popover and Menu.
 * Dialogs use the native `<dialog>` element (focus trap, Esc, inert page and
 * focus restore for free) with 150 ms CSS enter/exit transitions.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { errorMessage } from "@/lib/client/errors";
import { Button, IconButton, TextField } from "./form";
import { Callout } from "./surface";

/* ------------------------------ Dialog ------------------------------ */

/** Opens/closes a native dialog in sync with `open`, keeping content mounted through the exit transition. */
function useNativeDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  const [render, setRender] = useState(open);
  if (open && !render) setRender(true);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      if (!d.open) d.showModal();
      return;
    }
    if (d.open) d.close();
    const t = setTimeout(() => setRender(false), 160);
    return () => clearTimeout(t);
  }, [open]);
  return { ref, render };
}

/** Closes on a click that both started and ended on the backdrop (not on text-selection drags). */
function useBackdropClose(onClose: () => void, enabled: boolean) {
  const downOnBackdrop = useRef(false);
  return {
    onPointerDown: (e: React.PointerEvent<HTMLDialogElement>) => {
      downOnBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e: React.MouseEvent<HTMLDialogElement>) => {
      if (enabled && downOnBackdrop.current && e.target === e.currentTarget) onClose();
      downOnBackdrop.current = false;
    },
  };
}

const dialogSize = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" } as const;

/**
 * Modal dialog (bottom sheet on phones). Content mounts when opened, so form state resets each time.
 * Put a `<form id="x">` in `children` and submit buttons with `form="x"` in `footer`.
 * `dismissible={false}` ignores Esc/backdrop (e.g. while a request is pending).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof dialogSize;
  dismissible?: boolean;
}) {
  const { ref, render } = useNativeDialog(open);
  const backdrop = useBackdropClose(onClose, dismissible);
  const id = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      aria-describedby={description ? `${id}-d` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      {...backdrop}
      className={`mx-0 mt-auto mb-0 max-h-full w-full max-w-full translate-y-3 bg-transparent p-0 text-fg opacity-0 transition-[opacity,translate,display,overlay] transition-discrete duration-150 ease-out backdrop:bg-black/45 open:translate-y-0 open:opacity-100 sm:m-auto sm:w-[calc(100%-2rem)] starting:open:translate-y-3 starting:open:opacity-0 ${dialogSize[size]}`}
    >
      {render && (
        <div className="surface-lg relative flex max-h-[92dvh] flex-col overflow-hidden rounded-t-2xl sm:max-h-[85dvh] sm:rounded-2xl">
          <div className="border-b border-line py-3.5 pr-14 pl-5">
            <h2 id={`${id}-t`} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={`${id}-d`} className="mt-0.5 text-[13px] text-muted">
                {description}
              </p>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-sunken/40 px-5 py-3">{footer}</div>}
          {/* Last in DOM order so the first form field (not "Close") receives focus on open. */}
          <IconButton label="Close" onClick={onClose} disabled={!dismissible} className="absolute top-2.5 right-3">
            <X />
          </IconButton>
        </div>
      )}
    </dialog>
  );
}

const drawerWidth = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-xl", xl: "sm:max-w-3xl" } as const;

/**
 * Side panel (full screen on phones) for details such as a processing result or delivery log.
 * Same behaviour as `Dialog`; `side="left"` for navigation drawers.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  actions,
  children,
  footer,
  width = "lg",
  side = "right",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: keyof typeof drawerWidth;
  side?: "left" | "right";
}) {
  const { ref, render } = useNativeDialog(open);
  const backdrop = useBackdropClose(onClose, true);
  const id = useId();
  const sideCls =
    side === "right"
      ? `mr-0 ml-auto w-full max-w-full translate-x-8 open:translate-x-0 starting:open:translate-x-8 ${drawerWidth[width]}`
      : "mr-auto ml-0 w-[min(20rem,85vw)] max-w-[85vw] -translate-x-8 open:translate-x-0 starting:open:-translate-x-8";
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      aria-describedby={description ? `${id}-d` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      {...backdrop}
      className={`my-0 h-dvh max-h-dvh bg-transparent p-0 text-fg opacity-0 transition-[opacity,translate,display,overlay] transition-discrete duration-150 ease-out backdrop:bg-black/40 open:opacity-100 starting:open:opacity-0 ${sideCls}`}
    >
      {render && (
        <div className={`relative flex h-full flex-col bg-elev shadow-2xl ${side === "right" ? "border-l" : "border-r"} border-line`}>
          <div className="flex items-start gap-3 border-b border-line py-3.5 pr-14 pl-5">
            <div className="min-w-0 flex-1">
              <h2 id={`${id}-t`} className="truncate text-base font-semibold text-fg">
                {title}
              </h2>
              {description && (
                <div id={`${id}-d`} className="mt-0.5 text-[13px] text-muted">
                  {description}
                </div>
              )}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-sunken/40 px-5 py-3">{footer}</div>}
          <IconButton label="Close" onClick={onClose} className="absolute top-2.5 right-3">
            <X />
          </IconButton>
        </div>
      )}
    </dialog>
  );
}

/* --------------------------- ConfirmDialog -------------------------- */

/**
 * Confirmation for consequential actions. `onConfirm` may be async: the button shows pending, errors are shown
 * inline and the dialog stays open; it closes on success. `requireText` makes the user type a value
 * (e.g. the workspace slug) before confirming. `danger` paints the confirm button red.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onClose,
  requireText,
}: {
  open: boolean;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => unknown | Promise<unknown>;
  onClose: () => void;
  requireText?: string;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setText("");
      setError(null);
    }
  }
  const formId = useId();
  const ok = !requireText || text.trim() === requireText;

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!pending}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button type="submit" form={formId} variant={danger ? "danger" : "primary"} size="sm" pending={pending} disabled={!ok}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={confirm} className="flex flex-col gap-4">
        {body && <div className="text-sm leading-relaxed text-fg-soft">{body}</div>}
        {requireText && (
          <TextField
            label={
              <>
                Type <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[12px] text-fg">{requireText}</code> to confirm
              </>
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        )}
        {error && <Callout tone="danger">{error}</Callout>}
      </form>
    </Dialog>
  );
}

/* --------------------------- Popover / Menu -------------------------- */

const PopoverContext = createContext<{ close: () => void } | null>(null);

/** Props the trigger must spread on its button. */
export type PopoverTriggerProps = {
  "aria-expanded": boolean;
  "aria-haspopup": "menu" | "dialog";
  "aria-controls": string | undefined;
  onClick: () => void;
};

const placement = {
  "bottom-start": "top-full left-0 mt-1.5 origin-top-left",
  "bottom-end": "top-full right-0 mt-1.5 origin-top-right",
  "top-start": "bottom-full left-0 mb-1.5 origin-bottom-left",
  "top-end": "bottom-full right-0 mb-1.5 origin-bottom-right",
  "right-start": "left-full top-0 ml-2 origin-top-left",
  "right-end": "left-full bottom-0 ml-2 origin-bottom-left",
} as const;

/** Where a popover opens relative to its trigger. */
export type Placement = keyof typeof placement;

/**
 * Anchored floating panel (closes on outside click and Esc, returning focus to the trigger).
 *
 *   <Popover label="Notifications" trigger={({ props }) => <button {...props}>…</button>}>
 *     {(close) => …}
 *   </Popover>
 *
 * The panel is positioned with CSS (`placement`), so keep it out of `overflow: hidden` ancestors.
 */
export function Popover({
  trigger,
  children,
  placement: where = "bottom-start",
  label,
  role = "dialog",
  className = "",
  panelClassName = "",
}: {
  trigger: (t: { open: boolean; toggle: () => void; close: () => void; props: PopoverTriggerProps }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
  label?: string;
  role?: "dialog" | "menu";
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = () => setOpen(false);
  const closeAndFocus = () => {
    setOpen(false);
    wrap.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        wrap.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    const first = role === "menu" ? panel.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') : null;
    (first ?? panel.current)?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, role]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (role !== "menu") return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      items[next].focus();
    }
  }

  return (
    <div ref={wrap} className={`relative ${className}`}>
      {trigger({
        open,
        toggle: () => setOpen((v) => !v),
        close,
        props: { "aria-expanded": open, "aria-haspopup": role, "aria-controls": open ? id : undefined, onClick: () => setOpen((v) => !v) },
      })}
      {open && (
        <PopoverContext.Provider value={{ close: closeAndFocus }}>
          <div
            ref={panel}
            id={id}
            role={role}
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className={`surface-lg absolute z-50 min-w-56 rounded-2xl p-1.5 outline-none transition-[opacity,scale] duration-100 ease-out starting:scale-95 starting:opacity-0 ${placement[where]} ${panelClassName}`}
          >
            {typeof children === "function" ? children(closeAndFocus) : children}
          </div>
        </PopoverContext.Provider>
      )}
    </div>
  );
}

/** Close the enclosing `Popover`/`Menu` (no-op outside one). */
export function usePopoverClose(): () => void {
  return useContext(PopoverContext)?.close ?? (() => {});
}

/** Action menu: a `Popover` with `role="menu"` and arrow-key navigation. Fill it with `MenuItem`s. */
export function Menu(props: Omit<Parameters<typeof Popover>[0], "role">) {
  return <Popover {...props} role="menu" />;
}

/**
 * Menu entry. `onSelect` runs then the menu closes; `href` renders a client-side link. `checked` shows a tick
 * (single-choice lists such as a workspace switcher); `hint` is right-aligned muted text.
 */
export function MenuItem({
  icon,
  children,
  onSelect,
  href,
  danger,
  hint,
  disabled,
  checked,
  description,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  hint?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
  description?: ReactNode;
}) {
  const close = usePopoverClose();
  const cls = `flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-sunken focus-visible:bg-sunken aria-disabled:pointer-events-none aria-disabled:opacity-50 ${
    danger ? "text-rose-700 dark:text-rose-400" : "text-fg"
  }`;
  const inner = (
    <>
      {icon && <span className={`shrink-0 [&>svg]:size-4 ${danger ? "" : "text-muted"}`}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {description && <span className="block truncate text-xs text-muted">{description}</span>}
      </span>
      {hint && <span className="shrink-0 text-xs text-muted">{hint}</span>}
      {checked !== undefined && <Check className={`size-4 shrink-0 text-brand ${checked ? "" : "invisible"}`} aria-hidden />}
    </>
  );
  if (href) {
    return (
      <Link href={href} role="menuitem" tabIndex={-1} aria-disabled={disabled || undefined} className={cls} onClick={() => close()}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role={checked !== undefined ? "menuitemradio" : "menuitem"}
      aria-checked={checked}
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      className={cls}
      onClick={() => {
        if (disabled) return;
        close();
        onSelect?.();
      }}
    >
      {inner}
    </button>
  );
}

/** Small uppercase heading inside a menu. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{children}</div>;
}

/** Divider between menu groups. */
export function MenuSeparator() {
  return <div role="separator" className="-mx-1.5 my-1.5 h-px bg-line" />;
}
