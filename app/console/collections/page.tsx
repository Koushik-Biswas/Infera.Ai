import type { Metadata } from "next";
import { CollectionsPage } from "@/components/console/collections/collections-page";

export const metadata: Metadata = { title: { absolute: "Collections · Infera" } };

export default function ConsoleCollectionsPage() {
  return <CollectionsPage />;
}
