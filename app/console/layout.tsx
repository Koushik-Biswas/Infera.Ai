import type { Metadata } from "next";
import { ConsoleRoot } from "@/components/console/root";

// Static on purpose (docs/ARCHITECTURE.md §9): no cookies()/headers() or server data here —
// proxy.ts redirects signed-out visitors and the client session loads /api/auth/me.
export const metadata: Metadata = {
  title: { template: "%s · Infera", default: "Console · Infera" },
  robots: { index: false, follow: false },
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleRoot>{children}</ConsoleRoot>;
}
