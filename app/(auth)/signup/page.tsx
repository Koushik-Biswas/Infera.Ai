import type { Metadata } from "next";
import { Suspense } from "react";
import { SignupForm, SignupWithParams } from "@/components/console/auth/signup-form";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Create an Infera account and turn business conversations into structured records.",
};

export default function SignupPage() {
  return (
    <Suspense fallback={<SignupForm next={null} />}>
      <SignupWithParams />
    </Suspense>
  );
}
