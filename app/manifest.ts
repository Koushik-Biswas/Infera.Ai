import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: `${site.name} — ${site.tagline}`,
    short_name: site.shortName,
    description: site.description,
    start_url: "/app",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    background_color: "#f7f7f4",
    theme_color: "#5b4bff",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Inbox", url: "/console/inbox", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Assistant", url: "/console/assistant", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Collections", url: "/console/collections", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Import a WhatsApp chat", short_name: "Import", url: "/offline#/chats?import=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
    // WhatsApp → Export chat → share to Infera (Android, installed app).
    share_target: {
      action: "/app/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        files: [{ name: "files", accept: [".txt", ".zip", "text/plain", "application/zip", "application/x-zip-compressed"] }],
      },
    },
  } as MetadataRoute.Manifest;
}
