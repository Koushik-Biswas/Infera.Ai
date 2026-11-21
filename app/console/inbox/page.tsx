import type { Metadata } from "next";
import { InboxPage } from "@/components/console/inbox/inbox-page";

export const metadata: Metadata = { title: { absolute: "Inbox · Infera" } };

export default function ConsoleInboxPage() {
  return <InboxPage />;
}
