import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Frame/base/form/object restrictions. Script/style CSP is intentionally not set:
  // the inline theme script and Next's inline runtime would need per-request nonces.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
];

const config = (phase: string): NextConfig => ({
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // Automatic memoisation (components re-render only when their inputs change) for production builds.
  // In `next dev` it runs every component through Babel in extra worker processes (~0.5 GB RAM and
  // seconds per route on small machines), so it is off there unless INFERA_DEV_REACT_COMPILER=1.
  reactCompiler: phase !== PHASE_DEVELOPMENT_SERVER || process.env.INFERA_DEV_REACT_COMPILER === "1",
  experimental: {
    // Client router cache: revisiting a page (or back/forward) within these windows is instant, no server round trip.
    staleTimes: { dynamic: 30, static: 300 },
    // Only bundle the modules actually imported (lucide-react is optimised by default).
    optimizePackageImports: ["motion", "qrcode.react"],
  },
  // Dev only: let tunnels (ngrok etc.) load dev resources like hot reload. Extra hosts: DEV_ALLOWED_ORIGINS=a.example.com,b.example.com
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
    "*.trycloudflare.com",
    ...(process.env.DEV_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ],
  // Self-contained server bundle for Docker (`node server.js`).
  output: "standalone",
  // Native/WASM database drivers are loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "baileys", "teleproto", "imapflow", "mailparser", "nodemailer"],
  // SQL migrations are read from disk at runtime.
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      { source: "/console/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      // Fingerprint-free static assets that rarely change: cache for a day, revalidate in the background for a week.
      { source: "/icons/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    ];
  },
});

export default config;
