import type { Metadata } from "next";
import { ApiKeysSettings } from "@/components/console/settings/api-keys";

export const metadata: Metadata = { title: "API keys" };

export default function ApiKeysPage() {
  return <ApiKeysSettings />;
}
