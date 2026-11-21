/**
 * Centered card used by the auth pages (login, signup, invite, onboarding).
 * No hooks — usable as a Suspense fallback from server components.
 */
import type { ReactNode } from "react";
import { Skeleton } from "../kit/skeleton";

/** Card with a title, description, body and an optional footer line below the card. */
export function AuthCard({ title, description, children, footer, icon }: { title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; icon?: ReactNode }) {
  return (
    <div>
      <div className="surface-lg rounded-3xl p-6 sm:p-8">
        {icon && <div className="mb-4 grid size-11 place-items-center rounded-2xl bg-brand/10 text-brand [&>svg]:size-5">{icon}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{title}</h1>
        {description && <div className="mt-1.5 text-sm text-muted">{description}</div>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-5 text-center text-sm text-muted">{footer}</div>}
    </div>
  );
}

/** Loading placeholder shaped like an auth form with `fields` inputs. */
export function AuthCardSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <div className="surface-lg rounded-3xl p-6 sm:p-8" aria-hidden>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2.5 h-4 w-64 max-w-full" />
        <div className="mt-6 flex flex-col gap-4">
          {Array.from({ length: fields }, (_, i) => (
            <div key={i}>
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="mt-2 h-10 w-full rounded-xl" />
            </div>
          ))}
          <Skeleton className="mt-2 h-10 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}
