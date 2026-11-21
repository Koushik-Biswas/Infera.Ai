import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AudioLines, IndianRupee, Package, UserRound } from "lucide-react";
import { Backdrop } from "../components/Backdrop";
import { Kinetic } from "../components/Brand";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { Bubble } from "../components/ui";
import { c, fonts } from "../theme";
import { prog, rand, springAt } from "../lib/anim";
import { cues, type TimelineScene } from "../lib/timeline";
import { chats, incoming, orders } from "../data/product";

/** Real message texts from the product's demo data, flowing through 3D space. */
const MESSAGES = [
  ...orders.map((o) => ({ text: o.source.text, from: o.source.chat, kind: o.source.kind })),
  ...incoming.map((m) => ({ text: m.message, from: m.from, kind: m.kind })),
  ...chats.map((ch) => ({ text: ch.preview, from: ch.name, kind: "text" })),
];

export const MessageRiver: React.FC<{ speed?: number; count?: number; opacity?: number; seed?: number }> = ({ speed = 1, count = 26, opacity = 1, seed = 3 }) => {
  const f = useCurrentFrame();
  const span = 3400;
  return (
    <AbsoluteFill style={{ perspective: 1300, perspectiveOrigin: "50% 50%", opacity }}>
      <div style={{ position: "absolute", left: 960, top: 540, transformStyle: "preserve-3d" }}>
        {Array.from({ length: count }).map((_, i) => {
          const m = MESSAGES[i % MESSAGES.length];
          const r1 = rand(seed + i * 1.3);
          const r2 = rand(seed + i * 2.7);
          const r3 = rand(seed + i * 4.1);
          let x = (r1 * 2 - 1) * 1250;
          let y = (r2 * 2 - 1) * 650;
          // keep the centre clear for typography
          if (Math.abs(x) < 560 && Math.abs(y) < 300) x += Math.sign(x || 1) * 560;
          const z = -2800 + ((f * 9 * speed + r3 * span) % span);
          const fadeIn = Math.min(1, (z + 2800) / 900);
          const fadeOut = 1 - Math.min(1, Math.max(0, (z + 150) / 300)); // gone before it gets close enough to crowd the type
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                transform: `translate3d(${x}px, ${y}px, ${z}px) translate(-50%, -50%) rotateY(${(r1 - 0.5) * 16}deg)`,
                opacity: fadeIn * fadeOut * 0.9,
              }}
            >
              <Bubble text={m.text} from={m.from} kind={m.kind} out={i % 4 === 1} width={430} size={22} />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const CHIPS = [
  { label: "Orders.", icon: Package, phrase: "Orders" },
  { label: "Payments.", icon: IndianRupee, phrase: "Payments" },
  { label: "Leads.", icon: UserRound, phrase: "Leads" },
  { label: "Voice notes.", icon: AudioLines, phrase: "Voice" },
];

export const S01Open: React.FC<{ scene: TimelineScene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const { fps } = { fps: 30 };
  const q = cues(scene);
  const l1 = q.at("open-1");
  const l2 = q.at("open-2");
  const l3 = q.at("open-3");
  const intro = prog(f, 0, 50);
  const chipAt = CHIPS.map((ch, i) => (i === 0 ? l2 : q.phrase("open-2", ch.phrase)));

  return (
    <SceneShell duration={scene.duration} enter="none" exit="zoom-in">
      <Backdrop intensity={intro} particles={60} seed={2} />
      <MessageRiver speed={1 + prog(f, l3, 120) * 0.8} opacity={intro} />
      {/* clear pool of darkness behind the type */}
      <AbsoluteFill style={{ background: "radial-gradient(58% 44% at 50% 50%, rgba(6,6,9,0.95), rgba(6,6,9,0.7) 55%, transparent 100%)" }} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 120 }}>
        {f < l2 && (
          <Kinetic
            start={l1}
            out={l2 - 10}
            size={96}
            segs={[{ t: "Every day, business happens in " }, { t: "chats.", serif: true, grad: true }]}
          />
        )}
        {f >= l2 - 2 && f < l3 && (
          <div style={{ display: "flex", gap: 26, opacity: 1 - prog(f, l3 - 10, 10) }}>
            {CHIPS.map((ch, i) => {
              const s = springAt(f, fps, chipAt[i], { damping: 14, stiffness: 160 });
              const Icon = ch.icon;
              return (
                <div
                  key={ch.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "22px 34px",
                    borderRadius: 999,
                    background: "rgba(14,14,20,0.85)",
                    boxShadow: `inset 0 0 0 1px ${c.borderStrong}, 0 20px 50px -20px rgba(139,125,255,0.5)`,
                    fontFamily: fonts.sans,
                    fontSize: 46,
                    fontWeight: 600,
                    letterSpacing: "-0.03em",
                    color: c.fg,
                    opacity: Math.min(1, s * 1.5),
                    transform: `translateY(${(1 - s) * 40}px) scale(${0.7 + 0.3 * s})`,
                  }}
                >
                  <span style={{ width: 58, height: 58, borderRadius: 18, display: "grid", placeItems: "center", background: i % 2 ? "rgba(46,229,157,0.14)" : "rgba(139,125,255,0.16)", color: i % 2 ? c.brand2 : c.brand }}>
                    <Icon size={30} />
                  </span>
                  {ch.label}
                </div>
              );
            })}
          </div>
        )}
        {f >= l3 - 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 26, alignItems: "center" }}>
            <Kinetic start={l3} size={50} weight={500} color={c.fgSoft} stagger={2} segs={[{ t: "For millions of businesses, WhatsApp isn’t just a messaging app." }]} />
            <Kinetic start={q.phrase("open-3", "It's")} size={104} segs={[{ t: "It’s where " }, { t: "the work gets done.", serif: true, grad: true }]} />
          </div>
        )}
      </AbsoluteFill>

      <Sfx name="swell" at={0} volume={0.5} />
      <Sfx name="whoosh-soft" at={l1 - 6} volume={0.35} />
      {chipAt.map((a, i) => (
        <Sfx key={i} name={i % 2 ? "pop-high" : "pop"} at={a} volume={0.45} />
      ))}
      <Sfx name="shimmer" at={q.phrase("open-3", "It's")} volume={0.35} />
    </SceneShell>
  );
};
