import type { Metadata } from "next";
import { ConnectPage } from "@/components/console/connect/connect-page";

export const metadata: Metadata = { title: { absolute: "Connect your chats · Infera" } };

export default function ConsoleConnectPage() {
  return <ConnectPage />;
}
