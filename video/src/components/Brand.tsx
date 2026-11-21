import React from "react";
import { useCurrentFrame } from "remotion";
import { c, fonts } from "../theme";
import { EASE_OUT, prog } from "../lib/anim";

/**
 * The Infera logo mark (components/logo.tsx), animatable:
 * box → three "rows" draw in → the "record" dot pops.
 */
export const LogoMark: React.FC<{ size?: number; box?: number; lines?: number; dot?: number; glow?: number; id?: string }> = ({
  size = 64,
  box = 1,
  lines = 1,
  dot = 1,
  glow = 0,
  id = "lg",
}) => {
  const seg = (i: number) => Math.min(1, Math.max(0, lines * 3 - i));
  const paths = [
    { d: "M19 21h26", len: 26 },
    { d: "M19 32h26", len: 26 },
    { d: "M19 43h14", len: 14 },
  ];
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} style={{ overflow: "visible", display: "block" }}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c.logoA} />
          <stop offset="1" stopColor={c.logoB} />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor={c.brand} stopOpacity="0.7" />
          <stop offset="1" stopColor={c.brand} stopOpacity="0" />
        </radialGradient>
      </defs>
      {glow > 0 && <circle cx="32" cy="32" r={60} fill={`url(#${id}-glow)`} opacity={glow} />}
      <g style={{ transform: `scale(${0.6 + 0.4 * box})`, transformOrigin: "32px 32px", opacity: Math.min(1, box * 1.6) }}>
        <rect width="64" height="64" rx="18" fill={`url(#${id}-g)`} />
        <rect x="0.5" y="0.5" width="63" height="63" rx="17.5" fill="none" stroke="rgba(255,255,255,0.25)" />
      </g>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke="#fff"
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={p.len}
          strokeDashoffset={p.len * (1 - seg(i))}
          opacity={seg(i) > 0 ? 1 : 0}
        />
      ))}
      <circle cx="44.5" cy="43" r={4.2 * dot} fill="#fff" opacity={dot > 0 ? 1 : 0} />
    </svg>
  );
};

export const Wordmark: React.FC<{ size?: number; progress?: number }> = ({ size = 64, progress = 1 }) => {
  const letters = "Infera".split("");
  return (
    <div style={{ display: "flex", alignItems: "baseline", fontFamily: fonts.sans, fontWeight: 600, fontSize: size, letterSpacing: "-0.035em", color: c.fg }}>
      {letters.map((l, i) => {
        const p = Math.min(1, Math.max(0, progress * (letters.length + 3) - i));
        return (
          <span key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * size * 0.25}px)`, display: "inline-block", filter: p < 1 ? `blur(${(1 - p) * 8}px)` : undefined }}>
            {l}
          </span>
        );
      })}
      <span
        style={{
          color: c.muted,
          opacity: Math.min(1, Math.max(0, progress * (letters.length + 3) - letters.length - 1)),
        }}
      >
        .Ai
      </span>
    </div>
  );
};

/** Chapter label shown top-left in every act. */
export const ActLabel: React.FC<{ label: string; start?: number; end?: number }> = ({ label, start = 8, end }) => {
  const f = useCurrentFrame();
  if (!label) return null;
  const p = prog(f, start, 22);
  const out = end ? prog(f, end - 14, 14) : 0;
  const [num, ...rest] = label.split(" · ");
  return (
    <div style={{ position: "absolute", left: 96, top: 76, display: "flex", alignItems: "center", gap: 18, opacity: p * (1 - out), fontFamily: fonts.mono, fontSize: 19, letterSpacing: "0.18em", textTransform: "uppercase" }}>
      <span style={{ color: c.brand }}>{num}</span>
      <span style={{ width: 64 * p, height: 1, background: `linear-gradient(90deg, ${c.brand}, transparent)` }} />
      <span style={{ color: c.fgSoft, transform: `translateX(${(1 - p) * -12}px)` }}>{rest.join(" · ")}</span>
    </div>
  );
};

/** Text segment spec for kinetic headlines. */
export type Seg = { t: string; serif?: boolean; grad?: boolean; color?: string; weight?: number };

/**
 * Word-by-word blur-in headline. Segments let a phrase switch into the brand's
 * italic serif + gradient (the website's signature treatment).
 */
export const Kinetic: React.FC<{
  segs: Seg[];
  start: number;
  stagger?: number;
  size?: number;
  align?: "center" | "left";
  maxWidth?: number;
  out?: number;
  weight?: number;
  color?: string;
  lineHeight?: number;
}> = ({ segs, start, stagger = 3, size = 84, align = "center", maxWidth = 1500, out, weight = 600, color = c.fg, lineHeight = 1.06 }) => {
  const f = useCurrentFrame();
  let k = 0;
  const outP = out !== undefined ? prog(f, out, 12) : 0;
  return (
    <div
      style={{
        fontFamily: fonts.sans,
        fontSize: size,
        fontWeight: weight,
        letterSpacing: "-0.04em",
        lineHeight,
        color,
        textAlign: align,
        maxWidth,
        margin: align === "center" ? "0 auto" : undefined,
        opacity: 1 - outP,
        filter: outP > 0 ? `blur(${outP * 12}px)` : undefined,
        transform: outP > 0 ? `translateY(${-outP * 16}px)` : undefined,
        textWrap: "balance",
      }}
    >
      {segs
        .flatMap((s, si) => s.t.split(/(\s+)/).map((w, wi) => ({ w, s, key: `${si}-${wi}` })))
        .map(({ w, s, key }) => {
          // whitespace stays a bare text node so it collapses normally at line wraps
          if (w === "") return null;
          if (/^\s+$/.test(w)) return " ";
          const p = prog(f, start + k++ * stagger, 16, EASE_OUT);
          return (
            <span
              key={key}
              style={{
                display: "inline-block",
                opacity: p,
                transform: `translateY(${(1 - p) * size * 0.32}px)`,
                filter: p < 0.999 ? `blur(${(1 - p) * 12}px)` : undefined,
                fontFamily: s.serif ? fonts.serif : undefined,
                fontStyle: s.serif ? "italic" : undefined,
                fontWeight: s.serif ? 400 : s.weight,
                letterSpacing: s.serif ? "-0.01em" : undefined,
                paddingRight: s.serif ? "0.06em" : undefined,
                color: s.color,
                ...(s.grad
                  ? {
                      backgroundImage: `linear-gradient(100deg, ${c.brand} 0%, #7fb6e0 55%, ${c.brand2} 100%)`,
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                    }
                  : {}),
              }}
            >
              {w}
            </span>
          );
        })}
    </div>
  );
};

export const Eyebrow: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; dot?: string }> = ({ children, style, dot = c.brand }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      borderRadius: 999,
      border: `1px solid ${c.border}`,
      background: "rgba(14,14,20,0.7)",
      padding: "10px 22px",
      fontFamily: fonts.sans,
      fontSize: 22,
      fontWeight: 500,
      color: c.fgSoft,
      ...style,
    }}
  >
    <span style={{ width: 9, height: 9, borderRadius: 9, background: dot }} />
    {children}
  </span>
);
