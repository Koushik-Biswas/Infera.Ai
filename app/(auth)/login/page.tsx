import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm, LoginWithParams } from "@/components/console/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Infera workspace.",
};

export default function LoginPage() {
  // The fallback is the real form (without ?next=), so the static HTML is usable at once;
  // the param-aware version takes over after hydration.
  return (
    <Suspense fallback={<LoginForm next={null} />}>
      <LoginWithParams />
    </Suspense>
  );
}
