import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

/** Same typefaces as the Infera website (app/layout.tsx). */
const inter = loadInter("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });
const serif = loadSerif("italic", { weights: ["400"], subsets: ["latin"] });
loadSerif("normal", { weights: ["400"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

export const fonts = {
  sans: `${inter.fontFamily}, ui-sans-serif, system-ui, sans-serif`,
  serif: `${serif.fontFamily}, Georgia, serif`,
  mono: `${mono.fontFamily}, ui-monospace, monospace`,
};

/** Brand tokens — the dark theme from app/globals.css. */
export const c = {
  bg: "#060609",
  bgElev: "#0e0e14",
  bgSunken: "#0a0a0f",
  fg: "#f3f3f6",
  fgSoft: "#d6d6de",
  muted: "#9494a3",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.15)",
  brand: "#8b7dff",
  brand2: "#2ee59d",
  brand3: "#ffa364",
  /** logo gradient (public/favicon.svg) */
  logoA: "#7C6CFF",
  logoB: "#19C37D",
  danger: "#ff5b5b",
  amber: "#f5b544",
  sky: "#38bdf8",
};

export const gradientText = (angle = 100): React.CSSProperties => ({
  backgroundImage: `linear-gradient(${angle}deg, ${c.brand} 0%, #7fb6e0 55%, ${c.brand2} 100%)`,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
});

export const surface = (radius = 24): React.CSSProperties => ({
  background: c.bgElev,
  border: `1px solid ${c.border}`,
  borderRadius: radius,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 4px rgba(0,0,0,0.3), 0 30px 60px -24px rgba(0,0,0,0.85)",
});
