import type { Metadata } from "next";
import { ChannelsPage } from "@/components/console/channels/channels-page";

// The layout's title template doesn't apply to a page in the same segment.
export const metadata: Metadata = { title: { absolute: "Channels · Infera" } };

export default function ConsoleChannelsPage() {
  return <ChannelsPage />;
}
