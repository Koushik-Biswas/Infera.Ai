/**
 * Central site configuration. Replace the download URLs with real store /
 * installer links when builds are published. An empty string means "not yet
 * available" and the UI shows a friendly notice instead of a dead link.
 */
export const site = {
  name: "Infera.Ai",
  shortName: "Infera",
  tagline: "The intelligent inbox",
  url: "https://www.infera.ai",
  description:
    "Infera turns your WhatsApp chats, voice notes and attachments into clean, structured, searchable tables — automatically, in the background.",
  version: "0.1.0",
  supportEmail: "support@infera.ai",
  downloads: {
    windows: "",
    mac: "",
    ios: "",
    android: "",
  } as Record<Platform, string>,
};

export type Platform = "windows" | "mac" | "ios" | "android";

export const platformLabel: Record<Platform, string> = {
  windows: "Windows",
  mac: "Mac",
  ios: "iOS",
  android: "Android",
};

export const navLinks = [
  { href: "/#how-it-works", id: "how-it-works", label: "How it works" },
  { href: "/#collections", id: "collections", label: "Collections" },
  { href: "/#encryption", id: "encryption", label: "Encryption" },
  { href: "/#whats-next", id: "whats-next", label: "What's next" },
  { href: "/#faq", id: "faq", label: "FAQ" },
];
