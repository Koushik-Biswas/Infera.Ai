import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Backdrop, FloorGrid } from "../components/Backdrop";
import { ActLabel, Kinetic } from "../components/Brand";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { c, fonts } from "../theme";
import { EASE_IN_OUT, EASE_SNAP, mix, prog } from "../lib/anim";
import { cues, type TimelineScene } from "../lib/timeline";
import { news, type NewsItem } from "../data/news";

const PAPER = "#f3f0e8";
const INK = "#16151a";

export const NewsCard: React.FC<{ item: NewsItem; highlight?: number; width?: number }> = ({ item, highlight = 1, width = 820 }) => {
  const [before, after] = item.quote.split(item.highlight);
  return (
    <div
      style={{
        width,
        borderRadius: 18,
        background: PAPER,
        color: INK,
        padding: "40px 46px 34px",
        boxShadow: "0 50px 100px -30px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.4) inset",
        fontFamily: fonts.sans,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* paper texture: faint ruled lines */}
      <div style={{ position: "absolute", inset: 0, opacity: 0.35, backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.035) 0 1px, transparent 1px 6px)" }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 18, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
        <span>{item.publisher}</span>
        <span style={{ fontWeight: 500, letterSpacing: "0.04em", textTransform: "none", color: "#55525c" }}>{item.date}</span>
      </div>
      <div style={{ position: "relative", height: 3, background: INK, margin: "16px 0 4px" }} />
      <div style={{ position: "relative", height: 1, background: INK, opacity: 0.6, marginBottom: 22 }} />
      <div style={{ position: "relative", fontFamily: fonts.serif, fontStyle: "normal", fontSize: item.headline.length > 70 ? 46 : 56, lineHeight: 1.08, letterSpacing: "-0.01em", textWrap: "balance" }}>
        {item.headline}
      </div>
      <div style={{ position: "relative", marginTop: 24, fontSize: 23, lineHeight: 1.5, color: "#2d2b33" }}>
        “{before}
        <span
          style={{
            backgroundImage: "linear-gradient(transparent 12%, rgba(139,125,255,0.42) 12%, rgba(139,125,255,0.42) 88%, transparent 88%)",
            backgroundRepeat: "no-repeat",
            backgroundSize: `${highlight * 100}% 100%`,
            fontWeight: 600,
            color: INK,
          }}
        >
          {item.highlight}
        </span>
        {after}”
      </div>
      <div style={{ position: "relative", marginTop: 26, display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: fonts.mono, fontSize: 14, color: "#6b6874" }}>
        <span>{item.url}</span>
        {item.note && <span style={{ fontFamily: fonts.sans, fontStyle: "italic" }}>{item.note}</span>}
      </div>
    </div>
  );
};

const StatBlock: React.FC<{ item: NewsItem; start: number; out: number }> = ({ item, start, out }) => {
  const f = useCurrentFrame();
  const p = prog(f, start + 4, 18);
  const o = prog(f, out - 8, 10, EASE_IN_OUT);
  const v = item.stat.value * prog(f, start + 4, 34, EASE_SNAP);
  const shown = v >= item.stat.value - 0.001 ? item.stat.value : Math.floor(v);
  return (
    <div style={{ position: "absolute", left: 120, top: 330, width: 640, opacity: p * (1 - o), transform: `translateY(${(1 - p) * 30 - o * 20}px)`, filter: p < 1 || o > 0 ? `blur(${(1 - p) * 10 + o * 10}px)` : undefined }}>
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 700,
          fontSize: 210,
          lineHeight: 0.95,
          letterSpacing: "-0.06em",
          fontVariantNumeric: "tabular-nums",
          backgroundImage: `linear-gradient(110deg, #ffffff 10%, ${c.brand} 60%, ${c.brand2} 100%)`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        {item.stat.prefix ?? ""}
        {shown}
        {item.stat.suffix}
      </div>
      <div style={{ marginTop: 18, fontFamily: fonts.sans, fontSize: 38, fontWeight: 500, letterSpacing: "-0.02em", color: c.fgSoft, lineHeight: 1.2, maxWidth: 600 }}>{item.stat.label}</div>
      <div style={{ marginTop: 22, fontFamily: fonts.mono, fontSize: 17, color: c.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Source · {item.publisher} · {item.date}
      </div>
    </div>
  );
};

export const S02Headlines: React.FC<{ scene: TimelineScene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const q = cues(scene);
  const starts = [
    q.at("news-2"),
    q.phrase("news-2", "More than five"),
    q.at("news-3"),
    q.phrase("news-3", "And ninety-one"),
    q.at("news-4"),
    q.at("news-5"),
    q.phrase("news-5", "And one survey"),
  ];
  const wallAt = q.end("news-5") + 6;
  const wall = prog(f, wallAt, 40, EASE_IN_OUT);

  // which card is "active"
  let active = -1;
  starts.forEach((s, i) => {
    if (f >= s) active = i;
  });

  return (
    <SceneShell duration={scene.duration} enter="zoom-out" exit="blur">
      <Backdrop particles={40} seed={5} glowA="rgba(124,108,255,0.28)" glowB="rgba(255,163,100,0.10)" />
      <FloorGrid opacity={0.35} speed={0.6} />
      <ActLabel label={scene.act} />

      {/* opening line */}
      {f < starts[0] + 4 && (
        <AbsoluteFill style={{ justifyContent: "center" }}>
          <Kinetic start={q.at("news-1")} out={starts[0] - 8} size={120} segs={[{ t: "The numbers are " }, { t: "staggering.", serif: true, grad: true }]} />
        </AbsoluteFill>
      )}

      {/* stat counters (left) */}
      {wall < 1 &&
        news.map((item, i) => (f >= starts[i] - 2 && (i === news.length - 1 ? f < wallAt + 10 : f < starts[i + 1] + 8) ? <StatBlock key={item.id} item={item} start={starts[i]} out={i === news.length - 1 ? wallAt : starts[i + 1]} /> : null))}

      {/* 3D card stack (right) → wall montage */}
      <AbsoluteFill style={{ perspective: 1800, perspectiveOrigin: "70% 45%" }}>
        {news.map((item, i) => {
          const enter = prog(f, starts[i], 26, EASE_SNAP);
          if (enter <= 0) return null;
          // how many newer cards have arrived on top
          let depth = 0;
          for (let j = i + 1; j < starts.length; j++) depth += prog(f, starts[j], 26, EASE_IN_OUT);
          const hl = prog(f, starts[i] + 18, 28, EASE_IN_OUT);

          // stacked position
          const sx = 1340 + depth * 70;
          const sy = 520 - depth * 60;
          const sz = -depth * 420;
          // entry fly-in
          const ex = mix(1900, sx, enter);
          const ez = mix(700, sz, enter);
          const ery = mix(-38, -14, enter);
          // wall montage grid target
          const col = i % 4;
          const row = Math.floor(i / 4);
          const wx = row === 0 ? 300 + col * 440 : 520 + col * 440;
          const wy = row === 0 ? 330 : 760;
          const x = mix(ex, wx, wall);
          const y = mix(sy, wy, wall);
          const z = mix(ez, -900, wall);
          const ry = mix(ery, 0, wall);
          const scale = mix(1, 0.92, wall);
          const op = wall > 0 ? 1 : Math.max(0, 1 - depth * 0.28);
          return (
            <div
              key={item.id}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                transform: `translate3d(${x}px, ${y}px, ${z}px) translate(-50%, -50%) rotateY(${ry}deg) rotateX(${wall * 4}deg) scale(${scale})`,
                opacity: enter * op,
              }}
            >
              <NewsCard item={item} highlight={hl} />
              {/* depth shading so back cards recede */}
              <div style={{ position: "absolute", inset: 0, borderRadius: 18, background: `rgba(6,6,9,${Math.min(0.75, depth * 0.3 + wall * 0.15)})` }} />
            </div>
          );
        })}
      </AbsoluteFill>

      {/* wall-montage caption */}
      {wall > 0 && (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", background: `radial-gradient(50% 40% at 50% 50%, rgba(6,6,9,${0.85 * wall}), transparent)` }}>
          <div style={{ opacity: prog(f, wallAt + 20, 20), fontFamily: fonts.sans, fontSize: 64, fontWeight: 600, letterSpacing: "-0.04em", color: c.fg, textAlign: "center" }}>
            Business runs on chat.
            <div style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 400, fontSize: 72, color: c.brand3 }}>The tools haven’t caught up.</div>
          </div>
        </AbsoluteFill>
      )}

      <Sfx name="sub-drop" at={q.at("news-1")} volume={0.5} />
      {starts.map((s, i) => (
        <React.Fragment key={i}>
          <Sfx name="whoosh-fast" at={s - 4} volume={0.42} />
          {Array.from({ length: 9 }).map((_, k) => (
            <Sfx key={k} name="tick" at={s + 6 + k * 3} volume={0.22} />
          ))}
          <Sfx name="blip" at={s + 38} volume={0.3} />
        </React.Fragment>
      ))}
      <Sfx name="whoosh-soft" at={wallAt} volume={0.4} />
      <Sfx name="impact-soft" at={wallAt + 20} volume={0.4} />
    </SceneShell>
  );
};
