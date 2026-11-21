import type { Metadata } from "next";
import { SearchPage } from "@/components/console/search/search-page";

export const metadata: Metadata = { title: { absolute: "Search · Infera" } };

export default function ConsoleSearchPage() {
  return <SearchPage />;
}
