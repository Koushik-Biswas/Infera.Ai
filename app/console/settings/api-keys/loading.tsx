import { TableSkeleton } from "@/components/console/kit/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="surface overflow-hidden rounded-2xl">
      <TableSkeleton rows={4} columns={5} />
    </div>
  );
}
