import type { Metadata } from "next";
import { DataSettings } from "@/components/console/settings/data";

export const metadata: Metadata = { title: "Data & privacy" };

export default function DataPage() {
  return <DataSettings />;
}
