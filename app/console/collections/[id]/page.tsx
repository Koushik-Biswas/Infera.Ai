import type { Metadata } from "next";
import { CollectionDetail } from "@/components/console/collections/collection-detail";

export const metadata: Metadata = { title: { absolute: "Collection · Infera" } };

export default async function ConsoleCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CollectionDetail key={id} id={id} />;
}
