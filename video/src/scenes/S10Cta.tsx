import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ArrowRight, BriefcaseBusiness, Camera, Hash, Mail, MessageCircle, Send, Users } from "lucide-react";
import { Backdrop, Flare, Grid } from "../components/Backdrop";
import { Kinetic, LogoMark, Wordmark } from "../components/Brand";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { c, fonts } from "../theme";
import { EASE_IN_OUT, prog, springAt, window01 } from "../lib/anim";
import { cues, type TimelineScene } from "../lib/timeline";
import { Burst, GodRays } from "./S04Reveal";
import { PlatformGlyph } from "./S09Advantage";

/* components/sections/whats-next.tsx → channels in development */
const CHANNELS = [
  { name: "Gmail", icon: Mail, tint: ["#ef4444", "#fbbf24"] },
  { name: "Slack", icon: Hash, tint: ["#c026d3", "#fbbf24"] },
  { name: "Instagram", icon: Camera, tint: ["#ec4899", "#fb923c"] },
  { name: "Telegram", icon: Send, tint: ["#0ea5e9", "#22d3ee"] },
  { name: "LinkedIn", icon: BriefcaseBusiness, tint: ["#0369a1", "#0ea5e9"] },
  { name: "Facebook", icon: Users, tint: ["#2563eb", "#0ea5e9"] },
];

export const S10Cta: React.FC<{ scene: TimelineScene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const q = cues(scene);
  const L1 = q.at("cta-1");
  const L2 = q.at("cta-2");
  const L3 = q.at("cta-3");
  const D = scene.duration;

  const ch = window01(f, 0, L2 - 4, 16, 14);
  const first = window01(f, L2 - 4, L3 - 4, 16, 12);
  const hit = L3 - 2;
  const lock = prog(f, hit, 20);
  const box = springAt(f, 30, hit, { damping: 12, stiffness: 130 });
  const fadeOut = prog(f, D - 36, 34, EASE_IN_OUT);

  return (
    <SceneShell duration={D} enter="blur" exit="none">
      <Backdrop particles={60} seed={61} glowA="rgba(124,108,255,0.36)" glowB="rgba(46,229,157,0.22)" intensity={1 + lock * 0.3} />

      {/* channels */}
      {ch > 0 && (
        <AbsoluteFill style={{ opacity: ch, justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 30, marginBottom: 60 }}>
            <span style={{ width: 120, height: 120, borderRadius: 34, display: "grid", placeItems: "center", background: "linear-gradient(135deg, #10b981, #4ade80)", boxShadow: "0 20px 60px -16px rgba(16,185,129,0.9)", transform: `scale(${0.7 + 0.3 * springAt(f, 30, L1, { damping: 12 })})` }}>
              <MessageCircle size={62} color="#fff" />
            </span>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 10, borderRadius: 99, padding: "6px 16px", background: "rgba(46,229,157,0.14)", fontFamily: fonts.sans, fontSize: 20, fontWeight: 600, color: c.brand2 }}>
                <span style={{ width: 10, height: 10, borderRadius: 10, background: c.brand2, boxShadow: `0 0 ${8 + 8 * Math.sin(f / 5)}px ${c.brand2}` }} /> Live now
              </div>
              <div style={{ marginTop: 10, fontFamily: fonts.sans, fontSize: 76, fontWeight: 700, letterSpacing: "-0.04em", color: c.fg }}>WhatsApp</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 22 }}>
            {CHANNELS.map((chn, i) => {
              const s = springAt(f, 30, q.phrase("cta-1", "Gmail") + i * 5, { damping: 14 });
              const Icon = chn.icon;
              return (
                <div key={chn.name} style={{ width: 200, borderRadius: 26, padding: "26px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, background: "rgba(10,10,15,0.75)", boxShadow: `inset 0 0 0 1px ${c.border}`, opacity: Math.min(1, s * 1.5), transform: `translateY(${(1 - s) * 40}px)` }}>
                  <span style={{ width: 66, height: 66, borderRadius: 20, display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${chn.tint[0]}, ${chn.tint[1]})` }}>
                    <Icon size={32} color="#fff" />
                  </span>
                  <span style={{ fontFamily: fonts.sans, fontSize: 24, fontWeight: 600, color: c.fg }}>{chn.name}</span>
                  <span style={{ fontFamily: fonts.sans, fontSize: 16, color: c.muted }}>In development</span>
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
      )}

      {/* first table in 60 seconds */}
      {first > 0 && (
        <AbsoluteFill style={{ opacity: first, justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 40 }}>
          <Grid opacity={1.2} />
          <Kinetic start={L2} size={130} segs={[{ t: "Your first table in " }, { t: "60 seconds.", serif: true, grad: true }]} />
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              borderRadius: 99,
              padding: "16px 34px",
              background: "rgba(46,229,157,0.14)",
              boxShadow: "inset 0 0 0 1px rgba(46,229,157,0.4), 0 20px 60px -20px rgba(46,229,157,0.6)",
              fontFamily: fonts.sans,
              fontSize: 40,
              fontWeight: 600,
              color: c.brand2,
              opacity: springAt(f, 30, q.phrase("cta-2", "And your first"), { damping: 14 }),
              transform: `scale(${0.8 + 0.2 * springAt(f, 30, q.phrase("cta-2", "And your first"), { damping: 14 })})`,
            }}
          >
            First week free
          </span>
        </AbsoluteFill>
      )}

      {/* final lockup */}
      {f >= hit - 2 && (
        <AbsoluteFill>
          <GodRays strength={lock * 0.8} size={1900} />
          <Burst at={hit} y={420} count={56} />
          <Flare strength={1 - prog(f, hit, 26)} y={420} width={2400} />
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 36, marginTop: -80 }}>
              <div style={{ filter: "drop-shadow(0 20px 60px rgba(124,108,255,0.6))" }}>
                <LogoMark size={170} box={box} lines={prog(f, hit + 4, 22)} dot={springAt(f, 30, hit + 26, { damping: 8, stiffness: 220 })} id="cta" glow={0.5} />
              </div>
              <Wordmark size={150} progress={prog(f, hit + 6, 30)} />
            </div>
            <div style={{ marginTop: 30, fontFamily: fonts.serif, fontStyle: "italic", fontSize: 70, backgroundImage: `linear-gradient(100deg, ${c.brand} 0%, #7fb6e0 55%, ${c.brand2} 100%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", paddingRight: 8, opacity: prog(f, hit + 24, 20) }}>
              The intelligent inbox.
            </div>
            <div style={{ marginTop: 56, display: "flex", gap: 22, opacity: prog(f, hit + 44, 18), transform: `translateY(${(1 - prog(f, hit + 44, 18)) * 20}px)` }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 12, height: 76, padding: "0 40px", borderRadius: 99, background: "#fff", color: "#0a0a10", fontFamily: fonts.sans, fontSize: 30, fontWeight: 600 }}>
                Get a demo <ArrowRight size={28} />
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", height: 76, padding: "0 40px", borderRadius: 99, boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.3)", color: "#fff", fontFamily: fonts.sans, fontSize: 30, fontWeight: 600 }}>Get the app</span>
            </div>
            <div style={{ marginTop: 44, display: "flex", alignItems: "center", gap: 26, color: c.muted, fontFamily: fonts.sans, fontSize: 24, opacity: prog(f, hit + 60, 18) }}>
              <span style={{ fontFamily: fonts.mono, color: c.fg, fontSize: 28, letterSpacing: "0.02em" }}>infera.ai</span>
              <span style={{ width: 1, height: 26, background: c.borderStrong }} />
              {(["windows", "mac", "ios", "android"] as const).map((p) => (
                <span key={p} style={{ display: "inline-flex", color: c.fgSoft }}>
                  <PlatformGlyph p={p} size={28} />
                </span>
              ))}
              <span style={{ width: 1, height: 26, background: c.borderStrong }} />
              <span>First week free</span>
            </div>
          </AbsoluteFill>
        </AbsoluteFill>
      )}

      <AbsoluteFill style={{ background: "#000", opacity: fadeOut }} />

      <Sfx name="pop" at={L1} volume={0.4} />
      {CHANNELS.map((_, i) => (
        <Sfx key={i} name="blip" at={q.phrase("cta-1", "Gmail") + i * 5} volume={0.2} />
      ))}
      <Sfx name="whoosh-soft" at={L2 - 6} volume={0.35} />
      <Sfx name="shimmer" at={q.phrase("cta-2", "sixty")} volume={0.3} />
      <Sfx name="pop-high" at={q.phrase("cta-2", "And your first")} volume={0.35} />
      <Sfx name="riser-short" at={hit - 60} volume={0.3} />
      <Sfx name="logo-hit" at={hit} volume={0.9} />
      <Sfx name="shimmer" at={hit + 26} volume={0.35} />
    </SceneShell>
  );
};
