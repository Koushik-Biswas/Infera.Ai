import { FormSkeleton } from "@/components/console/kit/skeleton";

// Renders under the settings layout (header + tabs stay visible).
export default function Loading() {
  return (
    <div role="status" aria-label="Loading">
      <FormSkeleton sections={3} fields={2} />
    </div>
  );
}
