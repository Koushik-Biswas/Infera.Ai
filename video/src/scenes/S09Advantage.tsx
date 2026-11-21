import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Check, ClipboardCopy, Download, FileSpreadsheet, Search, Sheet, Upload, X } from "lucide-react";
import { Backdrop } from "../components/Backdrop";
import { ActLabel } from "../components/Brand";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { c, fonts, surface } from "../theme";
import { EASE_IN_OUT, EASE_SNAP, mix, prog, springAt, window01 } from "../lib/anim";
import { cues, type TimelineScene } from "../lib/timeline";

/** Platform glyphs (same paths as components/download-buttons.tsx → PlatformIcon). */
export const PlatformGlyph: React.FC<{ p: "windows" | "mac" | "ios" | "android"; size?: number }> = ({ p, size = 40 }) => {
  if (p === "windows")
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
        <path d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z" />
      </svg>
    );
  if (p === "android")
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
        <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.637.637 0 0 0-.83.22l-1.88 3.24a11.43 11.43 0 0 0-8.94 0L5.65 5.67a.643.643 0 0 0-.87-.2c-.28.18-.37.54-.22.83L6.4 9.48A10.81 10.81 0 0 0 1 18h22a10.81 10.81 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.5-1-2.5-3.9zM14 5.5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z" />
    </svg>
  );
};

const NOMORE = [
  { icon: Search, t: "No more scrolling.", phrase: "No more scrolling" },
  { icon: ClipboardCopy, t: "No more copy-paste.", phrase: "No more copy" },
  { icon: Upload, t: "No more exports.", phrase: "No more exports" },
];

const COMPARE = [
  ["Scrolling through thousands of messages", "Ask, and get a cited answer"],
  ["Copy-pasting into Sheets, by hand", "Collections that fill themselves"],
  ["Exporting chats into an AI assistant", "Voice notes, photos & documents understood"],
  ["Only up to date when you are", "Works 24/7, in the background"],
];

export const S09Advantage: React.FC<{ scene: TimelineScene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const q = cues(scene);
  const L1 = q.at("adv-1");
  const L2 = q.at("adv-2");
  const L3 = q.at("adv-3");
  const L4 = q.at("adv-4");
  const D = scene.duration;

  const nmAt = NOMORE.map((n) => q.phrase("adv-1", n.phrase));
  const compare = window01(f, L2 - 6, L3 - 4, 16, 14);
  const csv = window01(f, L3 - 4, L4 - 4, 16, 14);
  const plat = prog(f, L4 - 4, 18);

  const exportPress = prog(f, L3 + 8, 10);
  const fly = prog(f, L3 + 18, 34, EASE_IN_OUT);

  return (
    <SceneShell duration={D} enter="zoom-out" exit="blur">
      <Backdrop particles={40} seed={51} glowA="rgba(124,108,255,0.30)" glowB="rgba(46,229,157,0.20)" />
      <ActLabel label={scene.act} />

      {/* No more … */}
      {f < L2 + 4 && (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 26, flexDirection: "column", opacity: 1 - prog(f, L2 - 10, 12) }}>
          {NOMORE.map((n, i) => {
            const s = springAt(f, 30, nmAt[i], { damping: 13, stiffness: 200 });
            const strike = prog(f, nmAt[i] + 10, 12, EASE_SNAP);
            const Icon = n.icon;
            return (
              <div key={n.t} style={{ display: "flex", alignItems: "center", gap: 30, opacity: Math.min(1, s * 1.6), transform: `translateX(${(1 - s) * 80}px) scale(${0.85 + 0.15 * s})` }}>
                <span style={{ position: "relative", width: 92, height: 92, borderRadius: 26, display: "grid", placeItems: "center", background: "rgba(255,91,91,0.1)", boxShadow: "inset 0 0 0 1px rgba(255,91,91,0.3)" }}>
                  <Icon size={44} color={c.fgSoft} />
                  <span style={{ position: "absolute", width: 110 * strike, height: 5, borderRadius: 5, background: c.danger, transform: "rotate(-45deg)", boxShadow: "0 0 16px rgba(255,91,91,0.8)" }} />
                </span>
                <span style={{ fontFamily: fonts.sans, fontSize: 96, fontWeight: 700, letterSpacing: "-0.05em", color: c.fg }}>{n.t}</span>
              </div>
            );
          })}
        </AbsoluteFill>
      )}

      {/* comparison */}
      {compare > 0 && (
        <AbsoluteFill style={{ opacity: compare, transform: `scale(${mix(0.96, 1, compare)})` }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 150, textAlign: "center", fontFamily: fonts.sans, fontSize: 64, fontWeight: 600, letterSpacing: "-0.04em", color: c.fg }}>
            Infera works where business <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 400, ...{ backgroundImage: `linear-gradient(100deg, ${c.brand}, #7fb6e0 55%, ${c.brand2})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" } }}>already happens.</span>
          </div>
          <div style={{ position: "absolute", left: 200, right: 200, top: 300, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30 }}>
            {[0, 1].map((side) => (
              <div key={side} style={{ ...surface(30), padding: "30px 34px", ...(side ? { boxShadow: `0 0 0 1px rgba(46,229,157,0.35), 0 40px 90px -30px rgba(46,229,157,0.35)` } : { opacity: 0.85 }) }}>
                <div style={{ fontFamily: fonts.mono, fontSize: 19, letterSpacing: "0.14em", textTransform: "uppercase", color: side ? c.brand2 : c.muted, marginBottom: 18 }}>{side ? "With Infera" : "The old way"}</div>
                {COMPARE.map((row, i) => {
                  const p = prog(f, L2 + 6 + i * 12 + side * 6, 14);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 0", borderTop: i ? `1px solid ${c.border}` : undefined, opacity: p, transform: `translateX(${(1 - p) * (side ? 30 : -30)}px)` }}>
                      <span style={{ width: 38, height: 38, borderRadius: 38, flexShrink: 0, display: "grid", placeItems: "center", background: side ? "rgba(46,229,157,0.15)" : "rgba(255,91,91,0.12)" }}>
                        {side ? <Check size={22} color={c.brand2} /> : <X size={22} color={c.danger} />}
                      </span>
                      <span style={{ fontFamily: fonts.sans, fontSize: 27, fontWeight: side ? 600 : 400, color: side ? c.fg : c.muted, textDecoration: side ? undefined : "line-through", textDecorationColor: "rgba(255,91,91,0.5)" }}>{row[side]}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </AbsoluteFill>
      )}

      {/* one-click CSV export */}
      {csv > 0 && (
        <AbsoluteFill style={{ opacity: csv }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 170, textAlign: "center", fontFamily: fonts.sans, fontSize: 70, fontWeight: 600, letterSpacing: "-0.04em", color: c.fg }}>
            Export with <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 400, color: c.brand2 }}>one click.</span>
          </div>
          <div
            style={{
              position: "absolute",
              left: 960,
              top: 420,
              display: "inline-flex",
              alignItems: "center",
              gap: 14,
              borderRadius: 20,
              background: c.fg,
              color: c.bg,
              padding: "22px 40px",
              fontFamily: fonts.sans,
              fontSize: 36,
              fontWeight: 700,
              transform: `translateX(-50%) scale(${1 - 0.08 * Math.sin(Math.PI * exportPress)})`,
              boxShadow: `0 0 ${60 * Math.sin(Math.PI * exportPress)}px rgba(255,255,255,0.7)`,
            }}
          >
            <Download size={36} /> Export
          </div>
          {/* the CSV file flies to two destinations */}
          {[
            { label: "Excel", x: 560 },
            { label: "Google Sheets", x: 1360 },
          ].map((d, i) => {
            const land = prog(f, L3 + 18 + i * 4, 34, EASE_IN_OUT);
            const x = mix(960, d.x, land);
            const y = mix(470, 720, land) - Math.sin(land * Math.PI) * 120;
            return (
              <React.Fragment key={d.label}>
                <div style={{ position: "absolute", left: d.x, top: 760, transform: "translate(-50%, 0)", ...surface(28), width: 470, padding: "26px 28px", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 18, opacity: prog(f, L3, 16), boxShadow: land >= 1 ? "0 0 0 1px rgba(46,229,157,0.5), 0 30px 80px -30px rgba(46,229,157,0.5)" : undefined }}>
                  <span style={{ width: 64, height: 64, borderRadius: 18, display: "grid", placeItems: "center", background: "rgba(46,229,157,0.12)" }}>
                    {i ? <Sheet size={34} color={c.brand2} /> : <FileSpreadsheet size={34} color={c.brand2} />}
                  </span>
                  <div style={{ fontFamily: fonts.sans }}>
                    <div style={{ fontSize: 28, fontWeight: 600, color: c.fg }}>{d.label}</div>
                    <div style={{ fontSize: 17, color: c.muted }}>Opens cleanly — ₹, dates and all</div>
                  </div>
                </div>
                {fly > 0 && land < 1 && (
                  <div style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -50%)", display: "flex", alignItems: "center", gap: 10, borderRadius: 14, padding: "12px 18px", background: "#0e0e14", boxShadow: `inset 0 0 0 1px ${c.brand2}, 0 0 40px rgba(46,229,157,0.5)`, fontFamily: fonts.mono, fontSize: 18, color: c.fg }}>
                    <FileSpreadsheet size={20} color={c.brand2} /> infera-orders.csv
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </AbsoluteFill>
      )}

      {/* cross-platform */}
      {plat > 0 && (
        <AbsoluteFill style={{ opacity: plat, justifyContent: "center", alignItems: "center" }}>
          <div style={{ fontFamily: fonts.sans, fontSize: 74, fontWeight: 600, letterSpacing: "-0.04em", color: c.fg, marginBottom: 70, ...{ opacity: prog(f, L4, 16) } }}>
            One account. <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 400, color: c.brand }}>Everywhere.</span>
          </div>
          <div style={{ position: "relative", display: "flex", gap: 60 }}>
            <svg width={1200} height={200} style={{ position: "absolute", left: -40, top: -40, overflow: "visible" }}>
              {[0, 1, 2].map((i) => (
                <path key={i} d={`M ${110 + i * 300} 70 Q ${260 + i * 300} -30 ${410 + i * 300} 70`} stroke="url(#syncg)" strokeWidth={3} fill="none" strokeDasharray="8 10" strokeDashoffset={-f * 2} opacity={prog(f, L4 + 20 + i * 6, 14)} />
              ))}
              <defs>
                <linearGradient id="syncg" x1="0" x2="1">
                  <stop offset="0" stopColor={c.brand} />
                  <stop offset="1" stopColor={c.brand2} />
                </linearGradient>
              </defs>
            </svg>
            {(["windows", "mac", "ios", "android"] as const).map((p, i) => {
              const s = springAt(f, 30, q.phrase("adv-4", ["Windows", "Mac", "iOS", "Android"][i]), { damping: 13 });
              return (
                <div key={p} style={{ width: 240, ...surface(32), padding: "34px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 18, color: c.fg, opacity: Math.min(1, s * 1.5), transform: `translateY(${(1 - s) * 40}px)` }}>
                  <PlatformGlyph p={p} size={64} />
                  <span style={{ fontFamily: fonts.sans, fontSize: 28, fontWeight: 600 }}>{["Windows", "Mac", "iOS", "Android"][i]}</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 50, fontFamily: fonts.sans, fontSize: 26, color: c.muted, opacity: prog(f, L4 + 40, 16) }}>Same account, chats and collections — synced across all of them.</div>
        </AbsoluteFill>
      )}

      {nmAt.map((a, i) => (
        <React.Fragment key={i}>
          <Sfx name="impact-soft" at={a} volume={0.35} />
          <Sfx name="glitch" at={a + 10} volume={0.18} />
        </React.Fragment>
      ))}
      <Sfx name="whoosh" at={L2 - 6} volume={0.35} />
      {COMPARE.map((_, i) => (
        <Sfx key={i} name="blip" at={L2 + 12 + i * 12} volume={0.22} />
      ))}
      <Sfx name="whoosh-soft" at={L3 - 4} volume={0.3} />
      <Sfx name="click" at={L3 + 8} volume={0.5} />
      <Sfx name="whoosh-fast" at={L3 + 18} volume={0.35} />
      <Sfx name="success" at={L3 + 52} volume={0.35} />
      <Sfx name="whoosh-soft" at={L4 - 4} volume={0.3} />
      {["Windows", "Mac", "iOS", "Android"].map((w, i) => (
        <Sfx key={i} name={i % 2 ? "pop-high" : "pop"} at={q.phrase("adv-4", w)} volume={0.32} />
      ))}
    </SceneShell>
  );
};
