import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/sections/hero";
import { PainPoints } from "@/components/sections/pain-points";
import { HowItWorks } from "@/components/sections/how-it-works";
import { Collections } from "@/components/sections/collections";
import { Encryption } from "@/components/sections/encryption";
import { WhatsNext } from "@/components/sections/whats-next";
import { FAQ } from "@/components/sections/faq";
import { faqs } from "@/lib/faqs";
import { CTA } from "@/components/sections/cta";
import { site } from "@/lib/site";

export default function Home() {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: site.name,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Windows, macOS, iOS, Android",
      description: site.description,
      offers: { "@type": "Offer", price: "0", priceCurrency: "INR", description: "First week free" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];

  return (
    <>
      <Navbar />
      <main id="main">
        <Hero />
        <PainPoints />
        <HowItWorks />
        <Collections />
        <Encryption />
        <WhatsNext />
        <FAQ />
        <CTA />
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
