import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { DownloadGrid } from "./download-grid";

export const metadata: Metadata = {
  title: "Download",
  description: "Get Infera for Windows, Mac, iOS and Android. Your first week is free.",
};

export default function DownloadPage() {
  return (
    <>
      <Navbar />
      <main id="main" className="relative overflow-hidden pt-36 pb-24">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="bg-grid mask-fade-b absolute inset-0 opacity-70" />
          <div className="absolute top-[-10%] left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glow-a),transparent)] blur-2xl" />
        </div>
        <div className="container-x">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl leading-[1.05] font-semibold tracking-[-0.04em] sm:text-6xl">
              Get <span className="font-serif font-normal italic">Infera</span> everywhere you work.
            </h1>
            <p className="mt-5 text-lg text-muted">
              Same account, chats and collections on every device. Your first week is free — you&apos;ll see the price before you&apos;re
              charged.
            </p>
          </div>
          <DownloadGrid />
        </div>
      </main>
      <Footer />
    </>
  );
}
