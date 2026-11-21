import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

const routes = ["", "/download", "/security", "/privacy", "/terms", "/support"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((path) => ({
    url: `${site.url}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path === "/download" ? 0.8 : 0.5,
  }));
}
