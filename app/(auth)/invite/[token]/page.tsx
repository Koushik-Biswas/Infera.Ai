import type { Metadata } from "next";
import { InviteFlow } from "@/components/console/auth/invite-flow";

export const metadata: Metadata = {
  title: "Accept invitation",
  robots: { index: false, follow: false },
  // The token is a credential: don't leak it to other sites via the Referer header.
  referrer: "no-referrer",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteFlow token={token} />;
}
