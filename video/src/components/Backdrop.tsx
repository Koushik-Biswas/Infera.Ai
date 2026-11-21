import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { c } from "../theme";
import { rand } from "../lib/anim";

/**
 * Cinematic background: deep base, two drifting light blooms (brand violet +
 * green), an optional masked grid, and a floating particle field. Glows use
 * radial gradients rather than CSS blur so 4K renders stay fast.
 */
export const Backdrop: React.FC<{
  glowA?: string;
  glowB?: string;
  intensity?: number;
  grid?: boolean;
  gridOpacity?: number;
  particles?: number;
  seed?: number;
  drift?: number;
}> = ({ glowA = "rgba(124,108,255,0.34)", glowB = "rgba(46,229,157,0.16)", intensity = 1, grid = true, gridOpacity = 1, particles = 50, seed = 1, drift = 1 }) => {
  const f = useCurrentFrame();
  const ax = 50 + Math.sin(f / 140 + seed) * 14 * drift;
  const ay = 28 + Math.cos(f / 170 + seed) * 8 * drift;
  const bx = 70 + Math.cos(f / 120 + seed * 2) * 16 * drift;
  const by = 72 + Math.sin(f / 150 + seed) * 10 * drift;
  return (
    <AbsoluteFill style={{ background: c.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          opacity: intensity,
          background: `radial-gradient(48% 52% at ${ax}% ${ay}%, ${glowA}, transparent 70%), radial-gradient(38% 42% at ${bx}% ${by}%, ${glowB}, transparent 70%)`,
        }}
      />
      {grid && <Grid opacity={gridOpacity} />}
      {particles > 0 && <Particles count={particles} seed={seed} />}
    </AbsoluteFill>
  );
};

export const Grid: React.FC<{ opacity?: number; size?: number; mask?: string }> = ({ opacity = 1, size = 64, mask = "radial-gradient(70% 60% at 50% 45%, black, transparent)" }) => (
  <AbsoluteFill
    style={{
      opacity: 0.55 * opacity,
      backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)`,
      backgroundSize: `${size}px ${size}px`,
      WebkitMaskImage: mask,
      maskImage: mask,
    }}
  />
);

/** Perspective floor grid that scrolls towards camera (Tron-style depth cue). */
export const FloorGrid: React.FC<{ speed?: number; opacity?: number; color?: string }> = ({ speed = 1, opacity = 0.6, color = "rgba(139,125,255,0.35)" }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ perspective: 900, perspectiveOrigin: "50% 30%", opacity }}>
      <div
        style={{
          position: "absolute",
          left: "-50%",
          width: "200%",
          top: "55%",
          height: "120%",
          transform: "rotateX(72deg)",
          transformOrigin: "50% 0%",
          backgroundImage: `linear-gradient(to right, ${color} 1px, transparent 1px), linear-gradient(to bottom, ${color} 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          backgroundPosition: `0px ${(f * 2.2 * speed) % 80}px`,
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 25%, black 60%, transparent 100%)",
          maskImage: "linear-gradient(to bottom, transparent 0%, black 25%, black 60%, transparent 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

export const Particles: React.FC<{ count?: number; seed?: number; speed?: number }> = ({ count = 50, seed = 1, speed = 1 }) => {
  const f = useCurrentFrame();
  const items = [];
  for (let i = 0; i < count; i++) {
    const r1 = rand(seed * 100 + i);
    const r2 = rand(seed * 200 + i * 3);
    const r3 = rand(seed * 300 + i * 7);
    const depth = 0.3 + r3 * 0.7;
    const size = 2 + depth * 5;
    const x = (r1 * 1920 + Math.sin(f / (60 + r2 * 80) + i) * 30) % 1920;
    const y = ((r2 * 1200 - f * 0.35 * depth * speed) % 1200 + 1200) % 1200 - 60;
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(f / (14 + r1 * 20) + i * 1.7));
    const col = i % 5 === 0 ? c.brand2 : i % 3 === 0 ? "#ffffff" : c.brand;
    items.push(
      <div
        key={i}
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: size * 4,
          height: size * 4,
          marginLeft: -size * 2,
          marginTop: -size * 2,
          borderRadius: "50%",
          opacity: tw * depth * 0.8,
          background: `radial-gradient(circle, ${col} 0%, ${col}55 22%, transparent 60%)`,
        }}
      />,
    );
  }
  return <AbsoluteFill style={{ pointerEvents: "none" }}>{items}</AbsoluteFill>;
};

/** Film grain (pre-baked noise texture, re-positioned every frame) + vignette. */
export const FilmFinish: React.FC<{ grain?: number; vignette?: number }> = ({ grain = 0.07, vignette = 0.55 }) => {
  const f = useCurrentFrame();
  const ox = Math.floor(rand(f) * 512);
  const oy = Math.floor(rand(f + 999) * 512);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile("textures/grain.png")})`,
          backgroundSize: "512px 512px",
          backgroundPosition: `${ox}px ${oy}px`,
          opacity: grain,
          mixBlendMode: "overlay",
        }}
      />
      <AbsoluteFill style={{ background: `radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(0,0,0,${vignette}) 100%)` }} />
    </AbsoluteFill>
  );
};

/** Diagonal light sweep across an element (for glass / reveal moments). */
export const LightSweep: React.FC<{ progress: number; width?: number; opacity?: number; angle?: number }> = ({ progress, width = 30, opacity = 0.5, angle = 105 }) => {
  if (progress <= 0 || progress >= 1) return null;
  const pos = -width + progress * (100 + 2 * width);
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        mixBlendMode: "screen",
        opacity,
        background: `linear-gradient(${angle}deg, transparent ${pos}%, rgba(255,255,255,0.55) ${pos + width / 2}%, transparent ${pos + width}%)`,
      }}
    />
  );
};

/** Anamorphic horizontal lens flare streak. */
export const Flare: React.FC<{ x?: number; y?: number; strength: number; width?: number; color?: string }> = ({ x = 960, y = 540, strength, width = 1800, color = "139,125,255" }) => {
  if (strength <= 0.001) return null;
  return (
    <div style={{ position: "absolute", left: x - width / 2, top: y - 60, width, height: 120, pointerEvents: "none", mixBlendMode: "screen", opacity: strength }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(50% 50% at 50% 50%, rgba(${color},0.55), transparent 70%)` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 58, height: 4, background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.95) 50%, transparent)` }} />
      <div style={{ position: "absolute", left: "30%", right: "30%", top: 52, height: 16, background: `radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,0.8), transparent 70%)` }} />
    </div>
  );
};

export const ScreenshotImg: React.FC<{ file: string; style?: React.CSSProperties }> = ({ file, style }) => (
  <Img src={staticFile(`images/screenshots/${file}`)} style={{ display: "block", width: "100%", ...style }} />
);
