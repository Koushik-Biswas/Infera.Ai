"use client";

import type { ReactNode } from "react";
import { SessionProvider, useSession } from "./session";
import { ConsoleShell } from "./shell";

/** Remounts the shell (and every page under it) when the workspace changes, so all data refetches. */
function KeyedShell({ children }: { children: ReactNode }) {
  const { generation } = useSession();
  return <ConsoleShell key={generation}>{children}</ConsoleShell>;
}

/** Client root of `/console`: session + shell. Used by `app/console/layout.tsx`. */
export function ConsoleRoot({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <KeyedShell>{children}</KeyedShell>
    </SessionProvider>
  );
}
