import type { Metadata } from "next";
import { Overview } from "@/components/console/overview";

// The layout's title template doesn't apply to a page in the same segment.
export const metadata: Metadata = { title: { absolute: "Overview · Infera" } };

export default function ConsoleOverviewPage() {
  return <Overview />;
}
