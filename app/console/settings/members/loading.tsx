import { CardSkeleton, TableSkeleton } from "@/components/console/kit/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <div className="surface overflow-hidden rounded-2xl">
        <TableSkeleton rows={4} columns={4} />
      </div>
      <CardSkeleton lines={2} />
    </div>
  );
}
