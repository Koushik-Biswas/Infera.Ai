import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Security",
  description: "How Infera protects your chats: encryption, device-held keys, access controls and data deletion.",
};

export default function SecurityPage() {
  return (
    <LegalPage
      eyebrow="Security"
      title="Your chats are your business. We treat them that way."
      intro="Infera is built on one principle: your conversations power your tables and nothing else. Here is how we protect them."
      sections={[
        {
          id: "encryption",
          title: "Encryption",
          body: (
            <>
              <p>
                Messages, voice notes, photos and files are <strong>encrypted before they are stored</strong> in the cloud, and are only
                decrypted on devices you have signed in to. All traffic between your devices and Infera uses TLS 1.3.
              </p>
              <ul>
                <li>Encryption in transit (TLS 1.3) and at rest (AES-256).</li>
                <li>Device-held keys for stored message content.</li>
                <li>Upcoming encrypted backup under a key only your devices hold.</li>
              </ul>
            </>
          ),
        },
        {
          id: "processing",
          title: "How AI processing works",
          body: (
            <>
              <p>
                To turn chats into rows, Infera&apos;s extraction agents read only the chats and groups you put in scope. Processing happens in
                isolated, short-lived jobs; content is not retained by AI subprocessors and is <strong>never used to train models</strong>.
              </p>
              <ul>
                <li>Per-chat include and exclude controls — personal chats can be left out entirely.</li>
                <li>Every extracted row links back to its source message so you can verify it.</li>
                <li>Messages inside chats are treated as data, never as instructions to the AI.</li>
              </ul>
            </>
          ),
        },
        {
          id: "access",
          title: "Access controls",
          body: (
            <ul>
              <li>No routine staff access to customer content. Any support access requires your explicit permission and is audit-logged.</li>
              <li>Optional two-factor sign-in, device management and remote sign-out.</li>
              <li>Logs of linked devices, sign-ins and exports visible to the account owner.</li>
            </ul>
          ),
        },
        {
          id: "control",
          title: "Your control",
          body: (
            <ul>
              <li>Unlink WhatsApp at any time from Infera or from WhatsApp → Linked devices.</li>
              <li>Delete a single chat, a collection or your entire account — deletion removes cloud copies.</li>
              <li>Export any collection to CSV whenever you like.</li>
            </ul>
          ),
        },
        {
          id: "report",
          title: "Report a vulnerability",
          body: (
            <p>
              Found something? Email{" "}
              <a className="font-medium text-brand underline underline-offset-2" href="mailto:security@infera.ai">
                security@infera.ai
              </a>
              . We acknowledge reports within two business days and never pursue good-faith researchers.
            </p>
          ),
        },
      ]}
    />
  );
}
