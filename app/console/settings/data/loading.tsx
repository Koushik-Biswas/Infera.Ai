import { CardSkeleton } from "@/components/console/kit/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <CardSkeleton lines={2} />
      <CardSkeleton lines={6} />
      <CardSkeleton lines={2} />
    </div>
  );
}
