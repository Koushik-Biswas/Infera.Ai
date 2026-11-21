import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/components/console/auth/auth-card";
import { OnboardingWithParams } from "@/components/console/auth/onboarding-flow";

export const metadata: Metadata = {
  title: "Create your workspace",
  robots: { index: false, follow: false },
};

export default function OnboardingPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton fields={1} />}>
      <OnboardingWithParams />
    </Suspense>
  );
}
