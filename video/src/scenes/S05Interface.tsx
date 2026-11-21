import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { MessageCircle, Sparkles } from "lucide-react";
import { Backdrop } from "../components/Backdrop";
import { ActLabel, Kinetic } from "../components/Brand";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { AppWindow, Avatar, CollectionHeader, KindIcon, OrdersTable, Sidebar, type ColKey } from "../components/ui";
import { c, fonts } from "../theme";
import { camera, EASE_IN_OUT, mix, prog, springAt, window01 } from "../lib/anim";
import { cues, type TimelineScene } from "../lib/timeline";
import { incoming, orders, type OrderRow } from "../data/product";

export const Cursor: React.FC<{ x: number; y: number; press?: number; opacity?: number }> = ({ x, y, press = 0, opacity = 1 }) => (
  <div style={{ position: "absolute", left: x, top: y, opacity, transform: `scale(${1 - 0.15 * Math.sin(Math.PI * press)})`, transformOrigin: "0 0", filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.6))" }}>
    {press > 0 && press < 1 && <div style={{ position: "absolute", left: -30, top: -30, width: 60, height: 60, borderRadius: 60, border: `2px solid ${c.brand}`, opacity: 1 - press, transform: `scale(${0.4 + press * 1.2})` }} />}
    <svg width="34" height="40" viewBox="0 0 17 20">
      <path d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z" fill="#fff" stroke="#0b0b10" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  </div>
);

type FeedItem = { from: string; kind: string; message: string; action: string; at: number };

const SyncPanel: React.FC<{ items: FeedItem[]; pulse: number }> = ({ items, pulse }) => {
  const f = useCurrentFrame();
  const fps = 30;
  const shown = items.filter((it) => f >= it.at);
  return (
    <aside style={{ width: 340, flexShrink: 0, borderLeft: `1px solid ${c.border}`, display: "flex", flexDirection: "column", background: `rgba(46,229,157,${0.03 * pulse})` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 20px", borderBottom: `1px solid ${c.border}` }}>
        <span style={{ position: "relative", width: 11, height: 11 }}>
          <span style={{ position: "absolute", inset: 0, borderRadius: 11, background: c.brand2, transform: `scale(${1 + ((f % 30) / 30) * 1.6})`, opacity: 0.6 * (1 - (f % 30) / 30) }} />
          <span style={{ position: "absolute", inset: 0, borderRadius: 11, background: c.brand2 }} />
        </span>
        <span style={{ fontWeight: 600, fontSize: 17 }}>Background sync</span>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, padding: 14 }}>
        {shown
          .slice()
          .reverse()
          .map((it) => {
            const s = springAt(f, fps, it.at, { damping: 16, stiffness: 170 });
            return (
              <div key={it.at} style={{ borderRadius: 18, border: `1px solid ${c.border}`, background: "rgba(10,10,15,0.7)", padding: 14, opacity: Math.min(1, s * 1.4), transform: `translateY(${(1 - s) * -24}px) scale(${0.96 + 0.04 * s})` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <Avatar name={it.from} size={28} />
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{it.from}</span>
                  <span style={{ marginLeft: "auto", display: "flex" }}>
                    <KindIcon kind={it.kind} size={16} />
                  </span>
                </div>
                <div style={{ marginTop: 8, fontSize: 15, lineHeight: 1.45, color: c.fgSoft }}>{it.message}</div>
                <span style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, background: "rgba(46,229,157,0.12)", padding: "3px 10px", fontSize: 13, fontWeight: 500, color: c.brand2 }}>
                  <Sparkles size={13} /> {it.action}
                </span>
              </div>
            );
          })}
        {shown.length === 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center", padding: "0 18px", opacity: 0.6 + 0.4 * pulse }}>
            <MessageCircle size={30} color={c.muted} />
            <div style={{ fontSize: 17, fontWeight: 500 }}>Listening for new messages…</div>
            <div style={{ fontSize: 14, color: c.muted, lineHeight: 1.45 }}>Rows appear and update as chats come in.</div>
          </div>
        )}
      </div>
    </aside>
  );
};

export const S05Interface: React.FC<{ scene: TimelineScene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const q = cues(scene);
  const L1 = q.at("ui-1");
  const L2 = q.at("ui-2");
  const L3 = q.at("ui-3");
  const L4 = q.at("ui-4");
  const L5 = q.at("ui-5");
  const L6 = q.at("ui-6");
  const D = scene.duration;

  // events (from lib/data.ts → incoming)
  const evPaid = incoming[0]; // Anjali: UPI screenshot → Paid
  const evVoice = incoming[1]; // Vikram: voice note → new row
  const feedAnjali = L4 + 6;
  const paidAt = q.phrase("ui-4", "marked paid");
  const feedVikram = L5 + 4;
  const insertAt = q.phrase("ui-5", "brand-new");
  const clickAt = q.phrase("ui-6", "see the") - 4;

  const feed: FeedItem[] = [
    { from: evPaid.from, kind: evPaid.kind, message: evPaid.message, action: `Updated → ${evPaid.row.status}`, at: feedAnjali },
    { from: evVoice.from, kind: evVoice.kind, message: evVoice.message, action: "New row added", at: feedVikram },
  ];

  const newRow: OrderRow = evVoice.row;
  const rows = [newRow, ...orders.slice(0, 7)];
  const rowState: Record<string, { flash?: number; enter?: number; status?: OrderRow["status"]; statusGlow?: number }> = {
    [newRow.id]: { enter: prog(f, insertAt, 22, EASE_IN_OUT), flash: window01(f, insertAt + 4, insertAt + 70, 8, 30) },
    o1: { status: f >= paidAt ? "Paid" : "Pending", flash: window01(f, paidAt, paidAt + 70, 6, 30), statusGlow: window01(f, paidAt, paidAt + 40, 4, 20) },
  };

  // column spotlight synced to "customer, purchase, quantity, value and status"
  const colCues: [ColKey, string][] = [
    ["customer", "customer"],
    ["purchase", "purchase"],
    ["qty", "quantity"],
    ["value", "value"],
    ["status", "status"],
  ];
  let col: ColKey | null = null;
  let colStart = 0;
  colCues.forEach(([k, w]) => {
    const at = q.phrase("ui-2", w);
    if (f >= at - 2 && f < q.end("ui-2") + 16) {
      col = k;
      colStart = at;
    }
  });
  const colGlow = col ? prog(f, colStart - 2, 6) * (1 - prog(f, q.end("ui-2") + 4, 12)) : 0;

  const expandP = prog(f, clickAt + 4, 18, EASE_IN_OUT);

  // window geometry: left 100, top 150, width 1720
  const cam = camera(f, [
    { t: 0, x: 960, y: 520, s: 0.7, rx: 22 },
    { t: L1 + 10, x: 960, y: 470, s: 0.8, rx: 10 },
    { t: L2, x: 960, y: 520, s: 0.9, rx: 4 },
    { t: L2 + 50, x: 900, y: 540, s: 1.0, rx: 0, ry: 0 },
    { t: L3, x: 1000, y: 540, s: 1.0 },
    { t: L3 + 30, x: 1520, y: 500, s: 1.12, ry: -4 },
    { t: L4 + 10, x: 1380, y: 450, s: 1.14, ry: -3 },
    { t: paidAt + 30, x: 1100, y: 420, s: 1.16, ry: -2 },
    { t: L5 + 10, x: 1250, y: 430, s: 1.12, ry: -2 },
    { t: insertAt + 30, x: 1000, y: 400, s: 1.14 },
    { t: L6, x: 900, y: 520, s: 1.12 },
    { t: clickAt + 20, x: 820, y: 600, s: 1.28, rx: 2 },
    { t: D - 20, x: 860, y: 600, s: 1.34, rx: 2 },
  ]);

  const titleP = window01(f, L1 - 4, L2 + 10, 16, 16);
  const winIn = prog(f, 0, 30);

  // cursor path towards the Fathima row (index 3 incl. new row)
  const cx = mix(1350, 440, prog(f, L6 - 10, 30, EASE_IN_OUT));
  const cy = mix(900, 405, prog(f, L6 - 10, 30, EASE_IN_OUT));
  const press = prog(f, clickAt, 10);

  return (
    <SceneShell duration={D} enter="blur" exit="blur">
      <Backdrop particles={30} seed={14} glowA="rgba(124,108,255,0.30)" glowB="rgba(46,229,157,0.20)" />
      <AbsoluteFill style={{ perspective: 2400 }}>
        <AbsoluteFill style={cam}>
          <div style={{ position: "absolute", left: 100, top: 150, opacity: winIn }}>
            <div style={{ position: "absolute", inset: -60, borderRadius: 80, background: "radial-gradient(60% 60% at 50% 40%, rgba(124,108,255,0.28), transparent 70%)" }} />
            <AppWindow title="Infera — Orders" width={1720}>
              <div style={{ display: "flex", height: 830 }}>
                <Sidebar />
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <CollectionHeader count={rows.length - (f < insertAt ? 1 : 0)} total={rows.reduce((s, r) => s + (r.id === newRow.id && f < insertAt ? 0 : r.value), 0)} />
                  <OrdersTable rows={rows} rowState={rowState} highlightCol={col} colGlow={colGlow} expanded={f >= clickAt ? { id: "o3", progress: expandP } : null} />
                </div>
                <SyncPanel items={feed} pulse={window01(f, L3, L4 + 10, 10, 20)} />
              </div>
            </AppWindow>
            {f >= L6 - 12 && <Cursor x={cx} y={cy} press={press} opacity={prog(f, L6 - 12, 10) * (1 - prog(f, D - 18, 12))} />}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>

      {/* "Introducing Collections, a new form of Sheets." (site headline) */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 112, opacity: titleP, transform: `translateY(${(1 - titleP) * -20}px)` }}>
        <Kinetic start={L1} size={70} segs={[{ t: "Introducing Collections, " }, { t: "a new form of Sheets.", serif: true, grad: true }]} />
      </div>
      <ActLabel label={scene.act} end={L3 + 20} />

      <Sfx name="whoosh" at={0} volume={0.4} />
      {colCues.map(([, w], i) => (
        <Sfx key={i} name="blip" at={q.phrase("ui-2", w)} volume={0.22} />
      ))}
      <Sfx name="shimmer" at={L3} volume={0.25} />
      <Sfx name="message" at={feedAnjali} volume={0.4} />
      <Sfx name="success" at={paidAt} volume={0.35} />
      <Sfx name="message" at={feedVikram} volume={0.4} />
      <Sfx name="pop" at={insertAt} volume={0.4} />
      <Sfx name="click" at={clickAt} volume={0.5} />
      <Sfx name="whoosh-soft" at={clickAt + 4} volume={0.25} />
    </SceneShell>
  );
};
