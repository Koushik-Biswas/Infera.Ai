"use client";

/**
 * Console navigation link: next/link (default viewport prefetch of the route)
 * + data warm-up on intent (hover / focus / touch → `prefetchApi`) + an
 * instant pending hint via `useLinkStatus()` + `aria-current` for the active
 * route.
 *
 *   <ConsoleNavLink href="/console/inbox" prefetchData={["/api/v1/conversations"]} className={({ active }) => …}>
 *     Inbox
 *   </ConsoleNavLink>
 */
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import { prefetchApi } from "@/lib/client/api";

/** True when `pathname` is `href` or below it. `/console` (and `exact`) only match exactly. */
export function isActivePath(pathname: string | null, href: string, exact = false): boolean {
  if (!pathname) return false;
  const path = href.split(/[?#]/)[0];
  if (exact || path === "/console") return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * Fixed-size dot that fades in (after 100 ms, so fast navigations don't flash) while the enclosing
 * `<Link>`'s navigation is pending. Must be rendered inside a `next/link` `Link`.
 */
export function LinkPendingDot({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`size-1.5 shrink-0 rounded-full bg-brand transition-opacity ${pending ? "animate-pulse opacity-100 delay-100 duration-150" : "opacity-0 duration-0"} ${className}`}
    />
  );
}

/** Wraps link content and pulses it while the navigation is pending (no extra element, no layout shift). */
export function LinkPendingPulse({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={`inline-flex items-center gap-[inherit] ${pending ? "animate-pulse [animation-delay:100ms]" : ""}`}>{children}</span>;
}

export type ConsoleNavLinkProps = Omit<ComponentProps<typeof Link>, "href" | "className" | "children"> & {
  href: string;
  /** API paths to warm on hover/focus/touch (the destination page's main reads). */
  prefetchData?: (string | null | undefined)[];
  /** Active only on an exact path match (default: prefix match, except `/console`). */
  exact?: boolean;
  /** Force the active state (e.g. tabs that know their value). */
  activeOverride?: boolean;
  className?: string | ((state: { active: boolean }) => string);
  children: ReactNode | ((state: { active: boolean }) => ReactNode);
  /** `dot` (default) appends `LinkPendingDot`; `pulse` pulses the content; `none` lets you place `LinkPendingDot` yourself. */
  pendingIndicator?: "dot" | "pulse" | "none";
};

/** In-app link for console navigation. See the module comment. */
export function ConsoleNavLink({
  href,
  prefetchData,
  exact,
  activeOverride,
  className,
  children,
  pendingIndicator = "dot",
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...rest
}: ConsoleNavLinkProps) {
  const pathname = usePathname();
  const active = activeOverride ?? isActivePath(pathname, href, exact);
  const warm = () => {
    for (const p of prefetchData ?? []) prefetchApi(p);
  };
  const content = typeof children === "function" ? children({ active }) : children;
  return (
    <Link
      href={href}
      {...rest}
      aria-current={active ? "page" : undefined}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        warm();
        onTouchStart?.(e);
      }}
      className={typeof className === "function" ? className({ active }) : className}
    >
      {pendingIndicator === "pulse" ? <LinkPendingPulse>{content}</LinkPendingPulse> : content}
      {pendingIndicator === "dot" && <LinkPendingDot />}
    </Link>
  );
}
