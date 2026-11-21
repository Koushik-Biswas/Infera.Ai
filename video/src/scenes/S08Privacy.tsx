import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Cloud, EyeOff, KeyRound, Laptop, ListChecks, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { Backdrop } from "../components/Backdrop";
import { ActLabel, Kinetic } from "../components/Brand";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { c, fonts, surface } from "../theme";
import { EASE_IN_OUT, mix, prog, rand, springAt } from "../lib/anim";
import { cues, type TimelineScene } from "../lib/timeline";

/* Copy from components/sections/encryption.tsx */
const POINTS = [
  { icon: Lock, title: "Encrypted before it leaves", body: "Messages are encrypted before they're stored in the cloud." },
  { icon: KeyRound, title: "Keys live on your devices", body: "Content is only decrypted on devices you've signed in to." },
  { icon: ListChecks, title: "You choose what's read", body: "Pick the chats and groups that matter. Exclude anything personal." },
  { icon: EyeOff, title: "Never sold, never trained on", body: "Your chats power your tables — nothing else. Delete everything any time." },
];
const HEX = "0123456789abcdef";
const cipher = (seed: number, len = 22) => Array.from({ length: len }, (_, i) => HEX[Math.floor(rand(seed * 31 + i) * 16)]).join("");

const Device: React.FC<{ icon: React.ReactNode; label: string; plain: string; x: number; p: number; key2: number }> = ({ icon, label, plain, x, p, key2 }) => (
  <div style={{ position: "absolute", left: x, top: 470, transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * p})`, opacity: p, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
    <div style={{ position: "relative", width: 150, height: 150, borderRadius: 40, display: "grid", placeItems: "center", ...surface(40) }}>
      {icon}
      <span style={{ position: "absolute", right: -14, bottom: -14, width: 54, height: 54, borderRadius: 54, display: "grid", placeItems: "center", background: c.brand2, color: "#fff", transform: `scale(${key2})`, boxShadow: "0 10px 30px -6px rgba(46,229,157,0.8)" }}>
        <KeyRound size={26} />
      </span>
    </div>
    <div style={{ fontFamily: fonts.sans, fontSize: 26, fontWeight: 600, color: c.fg }}>{label}</div>
    <div style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 16, padding: "10px 16px", background: "rgba(14,14,20,0.8)", boxShadow: `inset 0 0 0 1px ${c.border}`, fontFamily: fonts.sans, fontSize: 19, color: c.fgSoft, whiteSpace: "nowrap" }}>
      <ShieldCheck size={18} color={c.brand2} /> {plain}
    </div>
  </div>
);

export const S08Privacy: React.FC<{ scene: TimelineScene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const q = cues(scene);
  const L1 = q.at("priv-1");
  const L2 = q.at("priv-2");
  const L3 = q.at("priv-3");
  const encAt = L2;
  const decAt = q.phrase("priv-2", "and decrypted");
  const diagram = prog(f, 4, 24);
  const down = prog(f, L3 - 6, 30, EASE_IN_OUT);

  const leg1 = prog(f, encAt + 4, 40, EASE_IN_OUT); // phone → cloud
  const leg2 = prog(f, decAt + 2, 40, EASE_IN_OUT); // cloud → desktop
  const tick = Math.floor(f / 3);

  return (
    <SceneShell duration={scene.duration} enter="blur" exit="zoom-in">
      <Backdrop particles={30} seed={41} glowA="rgba(124,108,255,0.30)" glowB="rgba(46,229,157,0.14)" />
      <ActLabel label={scene.act} />

      <div style={{ position: "absolute", left: 0, right: 0, top: 120 }}>
        <Kinetic start={L1} size={88} segs={[{ t: "All your chats, " }, { t: "encrypted.", serif: true, grad: true }]} />
      </div>

      <AbsoluteFill style={{ transform: `translateY(${-down * 90}px) scale(${mix(1, 0.86, down)})` }}>
        {/* wires */}
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: diagram }}>
          <line x1={480} y1={440} x2={790} y2={440} stroke="rgba(255,255,255,0.18)" strokeWidth={2} strokeDasharray="8 10" strokeDashoffset={-f * 2} />
          <line x1={1130} y1={440} x2={1440} y2={440} stroke="rgba(255,255,255,0.18)" strokeWidth={2} strokeDasharray="8 10" strokeDashoffset={-f * 2} />
        </svg>
        {/* packets */}
        {leg1 > 0 && leg1 < 1 && (
          <div style={{ position: "absolute", left: mix(480, 790, leg1), top: 440, transform: "translate(-50%, -50%)", display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 99, background: "#0e0e14", boxShadow: `inset 0 0 0 1px ${leg1 > 0.5 ? c.brand : c.brand2}, 0 0 30px ${leg1 > 0.5 ? "rgba(139,125,255,0.7)" : "rgba(46,229,157,0.6)"}`, fontFamily: fonts.mono, fontSize: 16, color: c.fg }}>
            <Lock size={16} color={c.brand} /> {leg1 > 0.5 ? cipher(tick, 8) : "12 kurtis…"}
          </div>
        )}
        {leg2 > 0 && leg2 < 1 && (
          <div style={{ position: "absolute", left: mix(1130, 1440, leg2), top: 440, transform: "translate(-50%, -50%)", display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 99, background: "#0e0e14", boxShadow: `inset 0 0 0 1px ${leg2 > 0.6 ? c.brand2 : c.brand}, 0 0 30px rgba(139,125,255,0.6)`, fontFamily: fonts.mono, fontSize: 16, color: c.fg }}>
            <KeyRound size={16} color={c.brand2} /> {leg2 > 0.6 ? "Fathima · 12" : cipher(tick + 50, 8)}
          </div>
        )}

        <Device icon={<Smartphone size={64} color={c.fg} />} label="Your phone" plain="“12 kurtis, deliver next week”" x={380} p={springAt(f, 30, 6)} key2={springAt(f, 30, decAt + 10, { damping: 10 })} />
        <Device icon={<Laptop size={64} color={c.fg} />} label="Your desktop" plain="Orders → Fathima · 12 · Confirmed" x={1540} p={springAt(f, 30, 12)} key2={springAt(f, 30, decAt + 40, { damping: 10 })} />

        {/* cloud */}
        <div style={{ position: "absolute", left: 960, top: 470, transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * springAt(f, 30, 9)})`, width: 340, ...surface(34), padding: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, opacity: diagram, boxShadow: `0 0 0 1px rgba(139,125,255,${0.2 + 0.3 * (leg1 > 0.9 ? 1 : 0)}), 0 40px 90px -30px rgba(0,0,0,0.9), 0 0 80px -20px rgba(124,108,255,0.5)` }}>
          <span style={{ width: 72, height: 72, borderRadius: 22, display: "grid", placeItems: "center", background: c.bgSunken, boxShadow: `inset 0 0 0 1px ${c.border}` }}>
            <Cloud size={38} color={c.fgSoft} />
          </span>
          <div style={{ fontFamily: fonts.sans, fontSize: 20, fontWeight: 600 }}>Infera cloud</div>
          <div style={{ width: "100%", borderRadius: 14, background: "rgba(10,10,15,0.9)", padding: "12px 14px", fontFamily: fonts.mono, fontSize: 16, lineHeight: 1.45, color: c.muted }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{cipher(tick * 4 + i, 24)}</div>
            ))}
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 99, padding: "4px 12px", fontFamily: fonts.sans, fontSize: 15, fontWeight: 500, color: c.brand, background: "rgba(139,125,255,0.12)" }}>
            <Lock size={14} /> Encrypted at rest
          </span>
        </div>
      </AbsoluteFill>

      {/* four guarantees */}
      <div style={{ position: "absolute", left: 120, right: 120, top: 760, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 22 }}>
        {POINTS.map((pt, i) => {
          const at = i < 2 ? L3 - 4 + i * 6 : i === 2 ? q.phrase("priv-3", "You choose") : q.phrase("priv-3", "never sold");
          const p = springAt(f, 30, Math.min(at, L3 + 30 + i * 6), { damping: 16 });
          const Icon = pt.icon;
          return (
            <div key={pt.title} style={{ borderRadius: 24, padding: 26, background: "rgba(10,10,15,0.75)", boxShadow: `inset 0 0 0 1px ${c.border}`, opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 40}px)` }}>
              <Icon size={30} color={c.brand} />
              <div style={{ marginTop: 14, fontFamily: fonts.sans, fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", color: c.fg }}>{pt.title}</div>
              <div style={{ marginTop: 8, fontFamily: fonts.sans, fontSize: 18, lineHeight: 1.45, color: c.muted }}>{pt.body}</div>
            </div>
          );
        })}
      </div>

      <Sfx name="impact-soft" at={L1} volume={0.35} />
      <Sfx name="whoosh-fast" at={encAt + 4} volume={0.3} />
      <Sfx name="glitch" at={encAt + 24} volume={0.22} />
      <Sfx name="whoosh-fast" at={decAt + 2} volume={0.3} />
      <Sfx name="success" at={decAt + 30} volume={0.3} />
      {[0, 1, 2, 3].map((i) => (
        <Sfx key={i} name="blip-low" at={L3 + i * 12} volume={0.25} />
      ))}
    </SceneShell>
  );
};
