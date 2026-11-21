"use client";

import type { ReactNode } from "react";
import { useUI } from "@/components/providers";

/** Text-style trigger for the demo modal (usable from server components). */
export function DemoLink({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { openDemo } = useUI();
  return (
    <button type="button" onClick={openDemo} className={className}>
      {children}
    </button>
  );
}
