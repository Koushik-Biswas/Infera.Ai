import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AudioLines, FileText, MessageCircle, Rows3 } from "lucide-react";
import { Backdrop, Flare, LightSweep, ScreenshotImg } from "../components/Backdrop";
import { LogoMark, Wordmark } from "../components/Brand";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { c, fonts } from "../theme";
import { EASE_IN_OUT, EASE_OUT, EASE_SNAP, mix, prog, rand, springAt } from "../lib/anim";
import { cues, type TimelineScene } from "../lib/timeline";

export const HIT = 30; // frame of the logo impact (music drops out until here)

/** Rotating volumetric light rays behind the logo. */
export const GodRays: React.FC<{ strength: number; size?: number }> = ({ strength, size = 1600 }) => {
  const f = useCurrentFrame();
  if (strength <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 960 - size / 2,
        top: 540 - size / 2,
        width: size,
        height: size,
        opacity: strength,
        mixBlendMode: "screen",
        background: `repeating-conic-gradient(from ${f * 0.35}deg, rgba(139,125,255,0.22) 0deg 4deg, transparent 4deg 14deg, rgba(46,229,157,0.12) 14deg 17deg, transparent 17deg 30deg)`,
        WebkitMaskImage: "radial-gradient(closest-side, black 0%, rgba(0,0,0,0.6) 30%, transparent 100%)",
        maskImage: "radial-gradient(closest-side, black 0%, rgba(0,0,0,0.6) 30%, transparent 100%)",
      }}
    />
  );
};

/** Particle burst radiating from a point at frame `at`. */
export const Burst: React.FC<{ at: number; x?: number; y?: number; count?: number }> = ({ at, x = 960, y = 540, count = 46 }) => {
  const f = useCurrentFrame();
  const t = f - at;
  if (t < 0 || t > 70) return null;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const a = rand(i * 3.1) * Math.PI * 2;
        const v = 6 + rand(i * 7.7) * 18;
        const d = v * t * (1 - t / 140);
        const s = 3 + rand(i) * 6;
        const col = i % 3 === 0 ? c.brand2 : i % 3 === 1 ? c.brand : "#fff";
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x + Math.cos(a) * d,
              top: y + Math.sin(a) * d,
              width: s * 4,
              height: s * 4,
              marginLeft: -s * 2,
              marginTop: -s * 2,
              borderRadius: "50%",
              opacity: Math.max(0, 1 - t / 70),
              background: `radial-gradient(circle, ${col}, ${col}44 30%, transparent 65%)`,
            }}
          />
        );
      })}
    </>
  );
};

export const BrowserFrame: React.FC<{ url: string; width: number; children: React.ReactNode }> = ({ url, width, children }) => (
  <div style={{ width, borderRadius: 22, overflow: "hidden", background: "#0b0b10", boxShadow: "0 0 0 1px rgba(255,255,255,0.12), 0 60px 120px -30px rgba(0,0,0,0.95), 0 0 120px -20px rgba(124,108,255,0.45)" }}>
    <div style={{ height: 50, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", background: "#111118", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((col) => (
        <span key={col} style={{ width: 13, height: 13, borderRadius: 13, background: col }} />
      ))}
      <div style={{ margin: "0 auto", width: 460, height: 30, borderRadius: 9, background: "#1a1a22", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: fonts.sans, fontSize: 15, color: c.muted }}>
        <span style={{ width: 9, height: 9, borderRadius: 9, background: c.brand2 }} /> {url}
      </div>
      <span style={{ width: 60 }} />
    </div>
    {children}
  </div>
);

export const S04Reveal: React.FC<{ scene: TimelineScene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const fps = 30;
  const q = cues(scene);
  const l1 = q.at("reveal-1");
  const l2 = q.at("reveal-2");
  const l3 = q.at("reveal-3");

  const line = prog(f, 0, HIT, EASE_IN_OUT);
  const flash = f >= HIT ? 1 - prog(f, HIT, 14) : 0;
  const box = springAt(f, fps, HIT, { damping: 12, stiffness: 120 });
  const lines = prog(f, HIT + 8, 26, EASE_OUT);
  const dot = springAt(f, fps, HIT + 34, { damping: 8, stiffness: 220 });
  const rays = prog(f, HIT, 20) * (1 - prog(f, l3, 30) * 0.7);

  // lockup choreography
  const slide = prog(f, l1 - 6, 26, EASE_SNAP); // logo moves left for the wordmark
  const word = prog(f, l1, 28);
  const tag = prog(f, l2, 24);
  const up = prog(f, l3, 40, EASE_IN_OUT); // lockup lifts, product rises

  const logoSize = mix(260, 120, slide) * mix(1, 0.62, up);
  const lockX = 0; // flex centring keeps logo + wordmark centred as the wordmark grows
  const lockY = mix(0, -380, up);

  const shot = prog(f, l3 + 6, 50, EASE_OUT);
  const sweep = prog(f, l3 + 40, 50, EASE_IN_OUT);

  const chips = [
    { icon: MessageCircle, label: "message" },
    { icon: AudioLines, label: "voice note" },
    { icon: FileText, label: "attachment" },
  ];

  return (
    <SceneShell duration={scene.duration} enter="none" exit="blur">
      <AbsoluteFill style={{ background: "#000" }} />
      <AbsoluteFill style={{ opacity: prog(f, HIT, 30) }}>
        <Backdrop particles={50} seed={12} intensity={1.1} />
      </AbsoluteFill>
      <GodRays strength={rays} />
      {/* the breath before the hit: a growing line of light */}
      <Flare strength={f < HIT + 4 ? line : 1 - prog(f, HIT, 24)} width={mix(200, 2200, line)} />
      <Burst at={HIT} />

      {/* logo lockup */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: mix(0, 34, slide), transform: `translate(${lockX}px, ${lockY}px)` }}>
          <div style={{ filter: `drop-shadow(0 20px 60px rgba(124,108,255,${0.6 * box}))` }}>
            <LogoMark size={logoSize} box={box} lines={lines} dot={Math.min(1.15, dot)} glow={0.6 * (1 - up)} id="reveal" />
          </div>
          <div style={{ width: mix(0, 620, slide) * mix(1, 0.62, up), overflow: "visible" }}>
            {f >= l1 - 6 && (
              <div style={{ transformOrigin: "left center", transform: `scale(${mix(1, 0.62, up)})` }}>
                <Wordmark size={150} progress={word} />
              </div>
            )}
          </div>
        </div>
      </AbsoluteFill>
      {/* tagline */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            marginTop: 290,
            transform: `translateY(${mix(0, -432, up)}px) scale(${mix(1, 0.7, up)})`,
            opacity: tag * (1 - up),
            filter: tag < 1 || up > 0 ? `blur(${(1 - tag) * 10 + up * 10}px)` : undefined,
            fontFamily: fonts.serif,
            fontStyle: "italic",
            fontSize: 76,
            backgroundImage: `linear-gradient(100deg, ${c.brand} 0%, #7fb6e0 55%, ${c.brand2} 100%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            paddingRight: 8,
          }}
        >
          The intelligent inbox.
        </div>
      </AbsoluteFill>

      {/* the real product website rises in 3D */}
      {shot > 0 && (
        <AbsoluteFill style={{ perspective: 2200, perspectiveOrigin: "50% 0%" }}>
          <div
            style={{
              position: "absolute",
              left: 960,
              top: mix(1250, 330, shot),
              transform: `translateX(-50%) rotateX(${mix(38, 12, shot)}deg) scale(${mix(0.9, 1, shot)})`,
              transformOrigin: "50% 0%",
              opacity: Math.min(1, shot * 1.6),
            }}
          >
            <div style={{ position: "relative" }}>
              <BrowserFrame url="infera.ai" width={1320}>
                <div style={{ height: 760, overflow: "hidden", position: "relative" }}>
                  <ScreenshotImg file="hero.png" />
                  <LightSweep progress={sweep} opacity={0.35} />
                </div>
              </BrowserFrame>
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* message / voice note / attachment → structured rows */}
      {f >= l3 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 236, display: "flex", justifyContent: "center", gap: 18 }}>
          {chips.map((ch, i) => {
            const p = springAt(f, fps, q.phrase("reveal-3", ch.label === "attachment" ? "attachment" : ch.label === "voice note" ? "voice note" : "every message") + 4, { damping: 14 });
            const Icon = ch.icon;
            return (
              <span key={ch.label} style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 22px", borderRadius: 999, background: "rgba(14,14,20,0.9)", boxShadow: `inset 0 0 0 1px ${c.borderStrong}`, fontFamily: fonts.sans, fontSize: 26, fontWeight: 500, color: c.fg, opacity: Math.min(1, p * 1.5) * (1 - prog(f, q.phrase("reveal-3", "Automatically") + 30, 20)), transform: `translateY(${(1 - p) * 20}px) scale(${0.8 + 0.2 * p})` }}>
                <Icon size={24} color={c.brand} /> {ch.label}
              </span>
            );
          })}
          {(() => {
            const p = springAt(f, fps, q.phrase("reveal-3", "clean") + 2, { damping: 14 });
            return (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 22px", borderRadius: 999, background: "rgba(46,229,157,0.14)", boxShadow: `inset 0 0 0 1px rgba(46,229,157,0.35)`, fontFamily: fonts.sans, fontSize: 26, fontWeight: 600, color: c.brand2, opacity: Math.min(1, p * 1.5) * (1 - prog(f, q.phrase("reveal-3", "Automatically") + 30, 20)), transform: `translateY(${(1 - p) * 20}px) scale(${0.8 + 0.2 * p})` }}>
                → <Rows3 size={24} /> clean, structured rows
              </span>
            );
          })()}
        </div>
      )}

      <AbsoluteFill style={{ background: "#fff", opacity: flash * 0.85, mixBlendMode: "screen" }} />

      <Sfx name="swell" at={HIT - 46} volume={0.4} />
      <Sfx name="logo-hit" at={HIT} volume={0.95} />
      <Sfx name="shimmer" at={HIT + 34} volume={0.35} />
      <Sfx name="whoosh-soft" at={l1 - 6} volume={0.4} />
      <Sfx name="whoosh" at={l3 + 4} volume={0.45} />
      <Sfx name="pop" at={q.phrase("reveal-3", "every message") + 4} volume={0.35} />
      <Sfx name="pop-high" at={q.phrase("reveal-3", "voice note") + 4} volume={0.35} />
      <Sfx name="pop" at={q.phrase("reveal-3", "attachment") + 4} volume={0.35} />
      <Sfx name="success" at={q.phrase("reveal-3", "clean") + 2} volume={0.3} />
    </SceneShell>
  );
};
