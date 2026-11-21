import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AudioLines, FileSpreadsheet, Image as ImageIcon, MessagesSquare, Search, Upload, X } from "lucide-react";
import { Backdrop, Flare } from "../components/Backdrop";
import { ActLabel, Kinetic } from "../components/Brand";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { Bubble, PhoneChats } from "../components/ui";
import { c, fonts, surface } from "../theme";
import { EASE_IN, EASE_IN_OUT, mix, prog, rand, typed } from "../lib/anim";
import { cues, type TimelineScene } from "../lib/timeline";
import { orders } from "../data/product";

/** A stage that fades/zooms in at `from` and out at `to` (3D push). */
const Stage: React.FC<{ from: number; to: number; children: React.ReactNode }> = ({ from, to, children }) => {
  const f = useCurrentFrame();
  if (f < from - 2 || f > to + 14) return null;
  const pin = prog(f, from, 16);
  const pout = prog(f, to, 14, EASE_IN);
  return (
    <AbsoluteFill
      style={{
        opacity: pin * (1 - pout),
        transform: `scale(${mix(0.94, 1, pin) * mix(1, 1.08, pout)})`,
        filter: pin < 1 || pout > 0 ? `blur(${(1 - pin) * 12 + pout * 14}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

const PainCaption: React.FC<{ n: string; icon: React.ReactNode; title: string; body: string }> = ({ n, icon, title, body }) => (
  <div style={{ position: "absolute", left: 120, top: 300, width: 620 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <span style={{ width: 64, height: 64, borderRadius: 18, display: "grid", placeItems: "center", background: "rgba(255,91,91,0.12)", color: c.danger, boxShadow: "inset 0 0 0 1px rgba(255,91,91,0.25)" }}>{icon}</span>
      <span style={{ fontFamily: fonts.mono, fontSize: 22, color: c.muted, letterSpacing: "0.12em" }}>PAIN {n}</span>
    </div>
    <div style={{ marginTop: 28, fontFamily: fonts.sans, fontSize: 62, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.04, color: c.fg }}>{title}</div>
    <div style={{ marginTop: 22, fontFamily: fonts.sans, fontSize: 28, lineHeight: 1.45, color: c.muted }}>{body}</div>
  </div>
);

/* ---------------- pain 1: endless scrolling ---------------- */
const ScrollVisual: React.FC<{ start: number }> = ({ start }) => {
  const f = useCurrentFrame();
  const t = f - start;
  const speed = 26 + Math.min(30, t * 0.4);
  const offset = t * speed;
  const H = 104;
  const msgs = [...orders, ...orders, ...orders];
  const query = typed("that guy who wanted 40 bottles…", f, start + 20, 22);
  return (
    <div style={{ position: "absolute", right: 140, top: 150, width: 860, height: 780, ...surface(32), overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${-(offset % (H * orders.length))}px)` }}>
        {msgs.map((o, i) => (
          <div key={i} style={{ height: H, display: "flex", justifyContent: i % 3 === 0 ? "flex-end" : "flex-start", alignItems: "center", padding: "0 30px" }}>
            <Bubble text={o.source.text} from={i % 3 === 0 ? undefined : o.source.chat} out={i % 3 === 0} width={600} size={19} />
          </div>
        ))}
      </div>
      {/* motion streak */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(14,14,20,1) 0%, transparent 20%, transparent 70%, rgba(14,14,20,1) 100%)" }} />
      <div style={{ position: "absolute", left: 26, right: 26, bottom: 26, display: "flex", alignItems: "center", gap: 12, borderRadius: 18, background: c.bgSunken, padding: "18px 22px", boxShadow: `inset 0 0 0 1px ${c.borderStrong}`, fontFamily: fonts.sans, fontSize: 24, color: c.fgSoft }}>
        <Search size={24} color={c.muted} /> “{query}
        <span style={{ width: 2, height: 28, background: c.fg, opacity: Math.floor(f / 8) % 2 ? 1 : 0.2 }} />
      </div>
    </div>
  );
};

/* ---------------- pain 2: copy-paste into sheets ---------------- */
const SheetVisual: React.FC<{ start: number }> = ({ start }) => {
  const f = useCurrentFrame();
  const rows = orders.slice(0, 6);
  const cols = ["Customer", "Item", "Qty", "Value", "Status"];
  return (
    <div style={{ position: "absolute", right: 110, top: 190, width: 1000, height: 700 }}>
      {/* chat side */}
      <div style={{ position: "absolute", left: 0, top: 30, width: 380, display: "flex", flexDirection: "column", gap: 16 }}>
        {rows.slice(0, 4).map((o, i) => (
          <Bubble key={o.id} text={o.source.text} from={o.source.chat} width={380} size={16} style={{ opacity: 0.9 }} />
        ))}
      </div>
      {/* spreadsheet */}
      <div style={{ position: "absolute", right: 0, top: 70, width: 520, ...surface(14), overflow: "hidden", fontFamily: fonts.sans }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1.3fr 0.6fr 0.8fr 0.9fr", background: "#101018" }}>
          {cols.map((h) => (
            <div key={h} style={{ padding: "12px 10px", fontSize: 15, color: c.muted, borderRight: `1px solid ${c.border}`, borderBottom: `1px solid ${c.border}`, fontWeight: 600 }}>{h}</div>
          ))}
        </div>
        {rows.map((o, r) => {
          const vals = [o.customer.split(" ")[0], o.purchase.split(" ")[0], String(o.qty), `₹${o.value}`, o.status];
          return (
            <div key={o.id} style={{ display: "grid", gridTemplateColumns: "1.3fr 1.3fr 0.6fr 0.8fr 0.9fr" }}>
              {vals.map((v, k) => {
                const idx = r * 5 + k;
                const at = start + 14 + idx * 4;
                const p = prog(f, at, 6);
                const err = idx === 13;
                return (
                  <div key={k} style={{ padding: "12px 10px", fontSize: 15, minHeight: 46, color: err ? "#fbbf24" : c.fgSoft, background: err && p > 0 ? "rgba(245,158,11,0.18)" : undefined, borderRight: `1px solid ${c.border}`, borderBottom: `1px solid ${c.border}`, whiteSpace: "nowrap", overflow: "hidden" }}>
                    <span style={{ opacity: p }}>{err ? "₹15,6OO?" : v}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {/* the ⌘C → ⌘V shuttle */}
      {Array.from({ length: 6 }).map((_, i) => {
        const at = start + 10 + i * 18;
        const p = prog(f, at, 18, EASE_IN_OUT);
        if (p <= 0 || p >= 1) return null;
        return (
          <div key={i} style={{ position: "absolute", left: mix(330, 600, p), top: 120 + (i % 4) * 110 - Math.sin(p * Math.PI) * 60, fontFamily: fonts.mono, fontSize: 22, color: c.brand3, padding: "6px 12px", borderRadius: 10, background: "rgba(255,163,100,0.12)", boxShadow: "inset 0 0 0 1px rgba(255,163,100,0.3)" }}>
            ⌘C → ⌘V
          </div>
        );
      })}
    </div>
  );
};

/* ---------------- pain 3: export to an AI assistant ---------------- */
const ExportVisual: React.FC<{ start: number }> = ({ start }) => {
  const f = useCurrentFrame();
  const fly = prog(f, start + 10, 30, EASE_IN_OUT);
  const fail = prog(f, start + 46, 8);
  const shake = fail > 0 && fail < 1 ? Math.sin(f * 2.3) * 10 * (1 - fail) : 0;
  return (
    <div style={{ position: "absolute", right: 150, top: 260, width: 960, height: 560 }}>
      <div style={{ position: "absolute", left: mix(0, 180, fly), top: 120 - Math.sin(fly * Math.PI) * 80, width: 250, ...surface(24), padding: 30, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, opacity: 1 - prog(f, start + 40, 8), transform: `scale(${mix(1, 0.6, fly)})` }}>
        <MessagesSquare size={56} color={c.brand2} />
        <span style={{ fontFamily: fonts.mono, fontSize: 19, color: c.fgSoft }}>chat_export.txt</span>
        <span style={{ fontFamily: fonts.sans, fontSize: 17, color: c.muted }}>4.2 MB</span>
      </div>
      <div style={{ position: "absolute", right: 0, top: 40, width: 520, ...surface(28), padding: 34, transform: `translateX(${shake}px)`, boxShadow: fail > 0 ? `0 0 0 2px rgba(255,91,91,${0.6 * fail}), 0 40px 90px -30px rgba(255,91,91,${0.5 * fail})` : undefined }}>
        <div style={{ fontFamily: fonts.sans, fontSize: 18, color: c.muted, marginBottom: 18 }}>AI assistant</div>
        {[0.75, 1, 0.5, 0.85].map((w, i) => (
          <div key={i} style={{ height: 16, width: `${w * 100}%`, borderRadius: 8, background: c.bgSunken, marginBottom: 14 }} />
        ))}
        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 10, fontFamily: fonts.sans, fontSize: 30, fontWeight: 600, color: c.danger, opacity: fail }}>
          <X size={30} /> Context too long…
        </div>
      </div>
    </div>
  );
};

/* ---------------- unstructured media that doesn't fit ---------------- */
const MediaVisual: React.FC<{ start: number }> = ({ start }) => {
  const f = useCurrentFrame();
  const items = [
    { kind: "voice", el: <VoiceNoteCard /> },
    { kind: "image", el: <Bubble text={orders[1].source.text} from={orders[1].source.chat} kind="image" width={420} size={20} /> },
    { kind: "text", el: <Bubble text="Bhaiya 40 bottles dispatch kar do, tracking bhej dena please" from="Wholesale Buyers 2026" width={420} size={20} /> },
  ];
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* the sheet they can't fit into */}
      <div style={{ position: "absolute", left: 660, top: 700, width: 600, height: 200, ...surface(14), display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gridTemplateRows: "repeat(4, 1fr)", overflow: "hidden" }}>
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} style={{ borderRight: `1px solid ${c.border}`, borderBottom: `1px solid ${c.border}`, background: i < 5 ? "#101018" : undefined }} />
        ))}
      </div>
      {items.map((it, i) => {
        const at = start + i * 22;
        const drop = prog(f, at, 22, EASE_IN);
        const bounce = prog(f, at + 22, 26);
        const x = 340 + i * 520;
        const y = mix(170, 520, drop) - Math.sin(bounce * Math.PI) * 120 + bounce * 40;
        const rx = mix(0, 980 - x, bounce) * 0.15;
        const rejected = bounce > 0;
        return (
          <div key={i} style={{ position: "absolute", left: x + rx, top: y, transform: `translate(-50%, -50%) rotate(${(i - 1) * 4 + bounce * (i - 1) * 8}deg)` }}>
            {it.el}
            {rejected && (
              <span style={{ position: "absolute", right: -18, top: -18, width: 48, height: 48, borderRadius: 48, display: "grid", placeItems: "center", background: c.danger, color: "#fff", transform: `scale(${Math.min(1, bounce * 3)})`, boxShadow: "0 10px 30px -8px rgba(255,91,91,0.8)" }}>
                <X size={28} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

const VoiceNoteCard: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <div style={{ width: 420, borderRadius: "22px 22px 22px 6px", background: c.bgElev, boxShadow: `inset 0 0 0 1px ${c.border}`, padding: "16px 20px", fontFamily: fonts.sans }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: c.muted, marginBottom: 10 }}>
        <AudioLines size={15} /> Fathima Rasheed · 0:24
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, height: 44 }}>
        {Array.from({ length: 38 }).map((_, i) => (
          <span key={i} style={{ width: 5, borderRadius: 3, background: i < 14 ? c.brand2 : "rgba(255,255,255,0.25)", height: 8 + Math.abs(Math.sin(i * 1.7 + f / 6)) * 30 * (0.4 + rand(i) * 0.6) }} />
        ))}
      </div>
    </div>
  );
};

export const S03Gap: React.FC<{ scene: TimelineScene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const q = cues(scene);
  const L = ["gap-1", "gap-2", "gap-3", "gap-4", "gap-5", "gap-6", "gap-7"].map((id) => q.at(id));
  const split = prog(f, L[0] + 20, 18, EASE_IN_OUT);
  const end = scene.duration;
  const flare = prog(f, end - 40, 30, EASE_IN);

  return (
    <SceneShell duration={scene.duration} enter="blur" exit="none">
      <Backdrop particles={30} seed={9} glowA="rgba(255,91,91,0.14)" glowB="rgba(124,108,255,0.18)" intensity={1 - prog(f, L[6], 30) * 0.8} />
      <ActLabel label={scene.act} end={L[6]} />

      {/* "So here's the gap." — splits open */}
      <Stage from={L[0]} to={L[1] - 8}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <div style={{ position: "relative" }}>
            {[0, 1].map((half) => (
              <div
                key={half}
                style={{
                  clipPath: half === 0 ? "inset(0 0 50% 0)" : "inset(50% 0 0 0)",
                  transform: `translateY(${(half === 0 ? -1 : 1) * split * 46}px) translateX(${(half === 0 ? -1 : 1) * split * 22}px)`,
                  position: half ? "absolute" : "relative",
                  inset: half ? 0 : undefined,
                }}
              >
                <Kinetic start={L[0]} size={150} segs={[{ t: "So here’s the " }, { t: "gap.", serif: true, color: c.danger }]} />
              </div>
            ))}
            <div style={{ position: "absolute", left: "-10%", right: "-10%", top: "50%", height: 6, marginTop: -3, opacity: split, background: `linear-gradient(90deg, transparent, ${c.danger}, #fff, ${c.danger}, transparent)`, boxShadow: `0 0 60px 14px rgba(255,91,91,0.55), 0 0 18px 4px rgba(255,255,255,0.6)`, transform: `scaleX(${split})` }} />
          </div>
        </AbsoluteFill>
      </Stage>

      {/* buried in DMs and groups */}
      <Stage from={L[1]} to={L[2] - 6}>
        <div style={{ position: "absolute", left: 120, top: 330, width: 900 }}>
          <Kinetic
            align="left"
            start={L[1]}
            size={84}
            maxWidth={900}
            segs={[{ t: "Is your business information " }, { t: "buried", serif: true, color: c.brand3 }, { t: " in WhatsApp DMs and groups?" }]}
          />
        </div>
        <div style={{ position: "absolute", right: 200, top: 120, perspective: 1600 }}>
          <div style={{ transform: `rotateY(-16deg) rotateX(6deg) translateY(${-prog(f, L[1], 120) * 30}px)` }}>
            <PhoneChats width={430} unreadBoost={prog(f, L[1] + 10, 80)} />
          </div>
        </div>
      </Stage>

      <Stage from={L[2]} to={L[3] - 6}>
        <PainCaption n="01" icon={<Search size={30} />} title="Digging through old WhatsApp chats" body="Scrolling for a lead, a customer or a payment buried somewhere in thousands of messages." />
        <ScrollVisual start={L[2]} />
      </Stage>

      <Stage from={L[3]} to={L[4] - 6}>
        <PainCaption n="02" icon={<FileSpreadsheet size={30} />} title="Organising chats into Excel or Sheets" body="Copying leads, payments and vendor details from WhatsApp into spreadsheets or other tools — by hand, every day." />
        <SheetVisual start={L[3]} />
      </Stage>

      <Stage from={L[4]} to={L[5] - 6}>
        <PainCaption n="03" icon={<Upload size={30} />} title="Exporting your chats" body="Exporting chat data and pasting it into an AI assistant like ChatGPT, just to understand what’s actually going on." />
        <ExportVisual start={L[4]} />
      </Stage>

      <Stage from={L[5]} to={L[6] - 6}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 110, textAlign: "center" }}>
          <Kinetic start={L[5]} size={64} segs={[{ t: "Voice notes. Payment screenshots. Mixed languages." }]} />
          <div style={{ marginTop: 12 }}>
            <Kinetic start={q.phrase("gap-6", "None")} size={64} segs={[{ t: "None of it fits " }, { t: "neatly into a sheet.", serif: true, color: c.brand3 }]} />
          </div>
        </div>
        <MediaVisual start={L[5] + 6} />
      </Stage>

      {/* "WhatsApp was built for a world before AI." */}
      <Stage from={L[6]} to={end - 4}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <Kinetic start={L[6]} size={104} stagger={4} segs={[{ t: "WhatsApp was built for a world " }, { t: "before AI.", serif: true, grad: true }]} />
        </AbsoluteFill>
      </Stage>
      <Flare strength={flare} width={2400} />
      <AbsoluteFill style={{ background: "#000", opacity: prog(f, end - 16, 14) }} />

      <Sfx name="glitch" at={L[0] + 18} volume={0.5} />
      <Sfx name="impact-soft" at={L[0] + 20} volume={0.45} />
      <Sfx name="message" at={L[1] + 10} volume={0.35} />
      <Sfx name="message" at={L[1] + 34} volume={0.3} />
      <Sfx name="whoosh-soft" at={L[2] - 4} volume={0.35} />
      <Sfx name="typing" at={L[2] + 20} volume={0.35} duration={50} />
      <Sfx name="whoosh-soft" at={L[3] - 4} volume={0.35} />
      {Array.from({ length: 6 }).map((_, i) => (
        <Sfx key={i} name="click" at={L[3] + 10 + i * 18} volume={0.3} />
      ))}
      <Sfx name="whoosh-soft" at={L[4] - 4} volume={0.35} />
      <Sfx name="whoosh-fast" at={L[4] + 10} volume={0.3} />
      <Sfx name="glitch" at={L[4] + 46} volume={0.5} />
      {[0, 1, 2].map((i) => (
        <Sfx key={i} name="blip-low" at={L[5] + 6 + i * 22 + 22} volume={0.4} />
      ))}
      <Sfx name="heartbeat" at={L[6] - 10} volume={0.5} />
    </SceneShell>
  );
};
