import type { Metadata } from "next";
import { GeneralSettings } from "@/components/console/settings/general";

export const metadata: Metadata = { title: { absolute: "Settings · Infera" } };

export default function SettingsPage() {
  return <GeneralSettings />;
}
