import type { Metadata } from "next";
import { SettingsFrame } from "@/components/console/settings/frame";

export const metadata: Metadata = {
  title: { template: "%s · Settings · Infera", default: "Settings · Infera" },
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
