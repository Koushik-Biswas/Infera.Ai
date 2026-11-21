import type { Metadata } from "next";
import { AssistantPage } from "@/components/console/assistant/assistant-page";

export const metadata: Metadata = { title: { absolute: "Assistant · Infera" } };

export default function ConsoleAssistantPage() {
  return <AssistantPage />;
}
