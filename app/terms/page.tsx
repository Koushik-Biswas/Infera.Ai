// NOTE: Starter terms for the Infera.Ai site. Have them reviewed by counsel
// before publishing.
import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms of Service", description: "The terms that govern your use of Infera." };

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      updated="17 November 2026"
      intro="These terms govern your use of Infera. By creating an account you agree to them."
      sections={[
        {
          id: "service",
          title: "The service",
          body: (
            <p>
              Infera links to your messaging accounts with your authorisation and turns the conversations you choose into structured
              collections you can search, export and share.
            </p>
          ),
        },
        {
          id: "trial",
          title: "Free trial and billing",
          body: (
            <p>
              Your first week is free. After that Infera is a paid subscription. We show the price before any charge, and you can cancel at
              any time before renewal.
            </p>
          ),
        },
        {
          id: "acceptable-use",
          title: "Acceptable use",
          body: (
            <ul>
              <li>Only link accounts you own or are authorised to use.</li>
              <li>Do not use Infera to monitor anyone covertly, including partners, employees or family members.</li>
              <li>Comply with applicable laws and the terms of the messaging platforms you connect.</li>
            </ul>
          ),
        },
        {
          id: "ai",
          title: "AI-generated output",
          body: (
            <p>
              Extraction is automated and can be wrong. Rows show their source messages and confidence so you can review them. Verify
              important information before acting on it — for example payments or shipments.
            </p>
          ),
        },
        {
          id: "platforms",
          title: "Third-party platforms",
          body: (
            <p>
              Infera is independent and not affiliated with WhatsApp or Meta. Availability of a connection depends on the third-party
              platform; if a platform changes how linking works, we will notify you and keep your data exportable.
            </p>
          ),
        },
        {
          id: "liability",
          title: "Liability",
          body: (
            <p>
              To the extent permitted by law, Infera is provided “as is” and our total liability is limited to the fees you paid in the 12
              months before the claim.
            </p>
          ),
        },
      ]}
    />
  );
}
