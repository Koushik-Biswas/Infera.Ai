import type { Metadata, Viewport } from "next";
import { InferaApp } from "@/components/app/app-shell";

export const metadata: Metadata = {
  title: "App",
  description: "Your chats, organised: Infera AI, chats, collections and search.",
  robots: { index: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#060609" },
  ],
};

export default function AppPage() {
  return <InferaApp />;
}
