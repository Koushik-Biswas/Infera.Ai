// NOTE: Starter privacy policy for the Infera.Ai site. Have it reviewed by
// counsel (DPDP Act 2023, GDPR where applicable) before publishing.
import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy", description: "How Infera collects, uses and protects personal data." };

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      updated="17 November 2026"
      intro="This policy explains what data Infera processes, why, and the choices you have. In short: we process your chats only to provide the service you asked for."
      sections={[
        {
          id: "data",
          title: "Data we process",
          body: (
            <ul>
              <li>
                <strong>Account data</strong> — name, email, phone number and billing details.
              </li>
              <li>
                <strong>Chat content</strong> — messages, voice notes, photos and files from the chats you put in scope.
              </li>
              <li>
                <strong>Extracted data</strong> — the collections, rows and fields Infera creates for you.
              </li>
              <li>
                <strong>Usage data</strong> — device, app version and diagnostic logs needed to run and secure the service.
              </li>
            </ul>
          ),
        },
        {
          id: "use",
          title: "How we use it",
          body: (
            <>
              <p>We use your data to link your account, build and update your collections, answer your questions, provide support and bill you.</p>
              <p>
                We do <strong>not</strong> sell your data, use chat content for advertising, or train AI models on your content without
                separate, revocable opt-in consent.
              </p>
            </>
          ),
        },
        {
          id: "third-parties",
          title: "People in your chats",
          body: (
            <p>
              Your chats include messages from customers, vendors and others. As the business using Infera you are typically the data
              fiduciary or controller for that information; Infera processes it on your behalf. We support access, correction and deletion
              requests and provide a short disclosure template you can share with customers.
            </p>
          ),
        },
        {
          id: "retention",
          title: "Retention and deletion",
          body: (
            <p>
              You can delete individual chats, collections or your whole account at any time. On account deletion we remove cloud copies
              within 30 days, except where the law requires us to keep limited records (for example invoices).
            </p>
          ),
        },
        {
          id: "rights",
          title: "Your rights",
          body: (
            <p>
              Depending on where you live — including under India&apos;s Digital Personal Data Protection Act, 2023 and the GDPR — you may have
              rights to access, correct, erase and port your data, and to withdraw consent. Contact{" "}
              <a className="font-medium text-brand underline underline-offset-2" href="mailto:privacy@infera.ai">
                privacy@infera.ai
              </a>
              .
            </p>
          ),
        },
        {
          id: "contact",
          title: "Contact",
          body: <p>Questions about this policy? Write to privacy@infera.ai or {site.supportEmail}.</p>,
        },
      ]}
    />
  );
}
