import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AudioLines, Bot, Braces, Check, FileText, Hash, Image as ImageIcon, IndianRupee, Link2, MessageCircle, Package, Phone, ScanText, Smartphone, Table, Tag, User, X } from "lucide-react";
import { Backdrop, FloorGrid } from "../components/Backdrop";
import { ActLabel, Kinetic } from "../components/Brand";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { Avatar, Bubble, StatusBadge } from "../components/ui";
import { c, fonts, surface } from "../theme";
import { EASE_IN_OUT, EASE_SNAP, mix, prog, rand, springAt, typed, window01 } from "../lib/anim";
import { cues, type TimelineScene } from "../lib/timeline";
import { chats, formatINR, incoming, orders } from "../data/product";

const NODES = [
  { icon: Smartphone, title: "Linked device", sub: "Sync & backfill" },
  { icon: ScanText, title: "Understand", sub: "Voice · images · languages" },
  { icon: Bot, title: "Agents", sub: "Only chats in scope" },
  { icon: Braces, title: "Extract", sub: "Typed fields" },
  { icon: Table, title: "Collection", sub: "Linked · auto-updating" },
];
const NX = [260, 610, 960, 1310, 1660];
const NY = 300;

const KINDS = [
  { icon: MessageCircle, label: "Message", col: c.brand },
  { icon: AudioLines, label: "Voice note", col: c.brand2 },
  { icon: ImageIcon, label: "Photo", col: c.brand3 },
  { icon: FileText, label: "Document", col: c.sky },
];

/* ----------------------------- the rail ----------------------------- */
const Rail: React.FC<{ active: number; build: number[]; flow: number }> = ({ active, build, flow }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="beam" x1="0" x2="1">
            <stop offset="0" stopColor={c.brand} />
            <stop offset="1" stopColor={c.brand2} />
          </linearGradient>
        </defs>
        {NX.slice(0, -1).map((x, i) => {
          const len = NX[i + 1] - x - 140;
          const p = build[i + 1] ?? 0;
          return (
            <g key={i}>
              <line x1={x + 70} y1={NY} x2={x + 70 + len * p} y2={NY} stroke="rgba(255,255,255,0.12)" strokeWidth={2} />
              <line x1={x + 70} y1={NY} x2={x + 70 + len * p} y2={NY} stroke="url(#beam)" strokeWidth={3} strokeDasharray="10 14" strokeDashoffset={-f * 3} opacity={0.9} />
            </g>
          );
        })}
      </svg>
      {/* travelling packets */}
      {flow > 0 &&
        Array.from({ length: 14 }).map((_, i) => {
          const k = KINDS[i % 4];
          const span = NX[4] - NX[0];
          const x = NX[0] + ((f * 6 + rand(i) * span) % span);
          const seg = Math.floor((x - NX[0]) / 350);
          const local = ((x - NX[0]) % 350) / 350;
          // packets transform as they pass through the pipeline: raw media → structured row
          const structured = seg >= 3;
          const near = Math.min(local, 1 - local) < 0.12; // hidden inside nodes
          const Icon = structured ? Table : k.icon;
          return (
            <div key={i} style={{ position: "absolute", left: x, top: NY + (rand(i * 9) - 0.5) * 6, transform: "translate(-50%, -50%)", opacity: flow * (near ? 0 : 1) }}>
              <div style={{ position: "absolute", left: -22, top: -22, width: 44, height: 44, borderRadius: 44, background: `radial-gradient(circle, ${structured ? c.brand2 : k.col}88, transparent 70%)` }} />
              <span style={{ position: "relative", width: 30, height: 30, borderRadius: 10, display: "grid", placeItems: "center", background: "#0e0e14", boxShadow: `inset 0 0 0 1px ${structured ? c.brand2 : k.col}` }}>
                <Icon size={16} color={structured ? c.brand2 : k.col} />
              </span>
            </div>
          );
        })}
      {NODES.map((n, i) => {
        const b = build[i] ?? 0;
        const on = active === i;
        const glow = on ? 0.5 + 0.5 * Math.sin(f / 6) : 0;
        const Icon = n.icon;
        return (
          <div key={n.title} style={{ position: "absolute", left: NX[i], top: NY, transform: `translate(-50%, -50%) scale(${(0.6 + 0.4 * b) * (on ? 1.12 : 1)})`, opacity: Math.min(1, b * 1.5) * (active < 0 || on ? 1 : 0.5), display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ position: "relative", width: 128, height: 128, borderRadius: 36, display: "grid", placeItems: "center", background: "linear-gradient(160deg, #15151f, #0b0b11)", boxShadow: `inset 0 0 0 1px ${on ? "rgba(139,125,255,0.7)" : c.borderStrong}, 0 0 ${40 + glow * 40}px ${on ? "rgba(124,108,255,0.55)" : "rgba(0,0,0,0)"}, 0 30px 60px -20px rgba(0,0,0,0.9)` }}>
              <Icon size={54} color={on ? c.fg : c.fgSoft} />
              <span style={{ position: "absolute", top: -12, right: -12, fontFamily: fonts.mono, fontSize: 15, padding: "3px 9px", borderRadius: 99, background: on ? c.brand : "#1a1a24", color: on ? "#fff" : c.muted }}>0{i + 1}</span>
            </div>
            <div style={{ position: "absolute", top: 150, width: 300, textAlign: "center" }}>
              <div style={{ fontFamily: fonts.sans, fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", color: c.fg }}>{n.title}</div>
              <div style={{ marginTop: 4, fontFamily: fonts.sans, fontSize: 18, color: on ? c.brand2 : c.muted }}>{n.sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ----------------------------- detail stages ----------------------------- */
const StageBox: React.FC<{ p: number; children: React.ReactNode }> = ({ p, children }) =>
  p <= 0 ? null : (
    <div style={{ position: "absolute", left: 160, top: 540, width: 1600, height: 440, color: c.fg, fontFamily: fonts.sans, opacity: p, transform: `translateY(${(1 - p) * 30}px)`, filter: p < 1 ? `blur(${(1 - p) * 10}px)` : undefined }}>{children}</div>
  );

const Label: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = c.brand2 }) => (
  <span style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 8, borderRadius: 99, padding: "6px 14px", fontFamily: fonts.sans, fontSize: 17, fontWeight: 600, color, background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}55` }}>{children}</span>
);

const SyncDetail: React.FC<{ start: number; backfillAt: number }> = ({ start, backfillAt }) => {
  const f = useCurrentFrame();
  const bf = prog(f, backfillAt, 70, EASE_IN_OUT);
  const months = ["Nov", "Oct", "Sep", "Aug", "Jul", "Jun", "May", "Apr", "Mar", "Feb", "Jan", "Dec"];
  return (
    <div style={{ display: "flex", gap: 40, height: "100%" }}>
      <div style={{ ...surface(28), width: 760, padding: 34, display: "flex", flexDirection: "column", gap: 22 }}>
        <Label>Live sync from your linked device</Label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {KINDS.map((k, i) => {
            const s = springAt(f, 30, start + 8 + i * 6, { damping: 14 });
            const Icon = k.icon;
            return (
              <div key={k.label} style={{ display: "flex", alignItems: "center", gap: 16, borderRadius: 20, padding: "20px 22px", background: "rgba(10,10,15,0.7)", boxShadow: `inset 0 0 0 1px ${k.col}44`, opacity: Math.min(1, s * 1.4), transform: `scale(${0.85 + 0.15 * s})` }}>
                <span style={{ width: 54, height: 54, borderRadius: 16, display: "grid", placeItems: "center", background: `${k.col}22` }}>
                  <Icon size={28} color={k.col} />
                </span>
                <span style={{ fontFamily: fonts.sans, fontSize: 26, fontWeight: 600 }}>{k.label}s</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ ...surface(28), flex: 1, padding: 34, display: "flex", flexDirection: "column", gap: 22 }}>
        <Label color={c.brand}>History backfill</Label>
        <div style={{ fontFamily: fonts.sans, fontSize: 24, color: c.fgSoft, lineHeight: 1.4 }}>As far back as WhatsApp makes it available — and Infera tells you exactly how far it got.</div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {months.map((m, i) => {
            const on = bf * months.length > i;
            return (
              <div key={m} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <div style={{ width: "100%", height: 54, borderRadius: 10, background: on ? `linear-gradient(180deg, ${c.brand}, ${c.brand}55)` : c.bgSunken, boxShadow: on ? "0 0 20px -4px rgba(139,125,255,0.8)" : undefined }} />
                <span style={{ fontFamily: fonts.mono, fontSize: 14, color: on ? c.fgSoft : c.muted }}>{m}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const UnderstandDetail: React.FC<{ start: number; ocrAt: number }> = ({ start, ocrAt }) => {
  const f = useCurrentFrame();
  const transcript = orders[2].source.text.replace("🎙️ ", ""); // Fathima's voice note (lib/data.ts)
  const tx = typed(transcript, f, start + 18, 34);
  const scanY = prog(f, ocrAt, 40, EASE_IN_OUT);
  const ocr = prog(f, ocrAt + 34, 16);
  return (
    <div style={{ display: "flex", gap: 40, height: "100%" }}>
      <div style={{ ...surface(28), flex: 1, padding: 34 }}>
        <Label>Voice note → transcribed</Label>
        <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 5, height: 80 }}>
          {Array.from({ length: 56 }).map((_, i) => {
            const played = (f - start) / 2 > i;
            return <span key={i} style={{ width: 7, borderRadius: 4, background: played ? c.brand2 : "rgba(255,255,255,0.2)", height: 10 + Math.abs(Math.sin(i * 1.3 + (played ? f / 5 : 0))) * 56 * (0.35 + rand(i) * 0.65) }} />;
          })}
        </div>
        <div style={{ marginTop: 24, fontFamily: fonts.sans, fontSize: 28, lineHeight: 1.4, color: c.fg, minHeight: 120 }}>
          {tx}
          <span style={{ display: "inline-block", width: 3, height: 30, marginLeft: 3, background: c.brand2, opacity: tx.length < transcript.length ? 1 : 0, transform: "translateY(5px)" }} />
        </div>
        <div style={{ fontFamily: fonts.sans, fontSize: 17, color: c.muted }}>Fathima Rasheed · voice note · 0:24</div>
      </div>
      <div style={{ ...surface(28), width: 700, padding: 34, display: "flex", gap: 30 }}>
        <div style={{ position: "relative", width: 230, height: 360, borderRadius: 26, background: "#f4f6f8", overflow: "hidden", flexShrink: 0, fontFamily: fonts.sans, color: "#16151a" }}>
          <div style={{ padding: "34px 20px 0", textAlign: "center" }}>
            <div style={{ width: 54, height: 54, margin: "0 auto", borderRadius: 54, background: "#1ea672", display: "grid", placeItems: "center" }}>
              <Check size={30} color="#fff" />
            </div>
            <div style={{ marginTop: 14, fontSize: 16, color: "#555" }}>Payment successful</div>
            <div style={{ marginTop: 6, fontSize: 38, fontWeight: 700 }}>₹5,598</div>
            <div style={{ marginTop: 14, fontSize: 13, color: "#777", lineHeight: 1.7 }}>UPI · Kochi Retail Group</div>
            {[0.8, 0.6, 0.7].map((w, i) => (
              <div key={i} style={{ margin: "10px auto 0", height: 9, width: `${w * 100}%`, borderRadius: 5, background: "#dfe3e8" }} />
            ))}
          </div>
          {scanY > 0 && scanY < 1 && <div style={{ position: "absolute", left: 0, right: 0, top: scanY * 360, height: 4, background: c.brand2, boxShadow: "0 0 26px 8px rgba(46,229,157,0.6)" }} />}
          {scanY > 0 && <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: scanY * 360, background: "rgba(46,229,157,0.08)" }} />}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, justifyContent: "center" }}>
          <Label color={c.brand3}>Screenshot → text read</Label>
          <div style={{ opacity: ocr, transform: `translateX(${(1 - ocr) * -16}px)`, fontFamily: fonts.mono, fontSize: 20, lineHeight: 1.6, color: c.fgSoft }}>
            “Sent ₹5,598 via UPI
            <br />
            for the 2 pairs”
          </div>
          <div style={{ opacity: ocr }}>
            <StatusBadge status="Paid" scale={1.3} />
          </div>
        </div>
      </div>
    </div>
  );
};

const LANGS = ["English", "Hindi", "Malayalam", "Tamil", "Bengali", "Hinglish"];
const LanguageDetail: React.FC<{ at: number[] }> = ({ at }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: "flex", gap: 40, height: "100%" }}>
      <div style={{ ...surface(28), width: 620, padding: 34, display: "flex", flexDirection: "column", gap: 18 }}>
        <Label color={c.brand}>Mixed-language chats, understood</Label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 }}>
          {LANGS.map((l, i) => {
            const s = springAt(f, 30, at[i], { damping: 12, stiffness: 180 });
            return (
              <span key={l} style={{ borderRadius: 99, padding: "14px 26px", fontFamily: fonts.sans, fontSize: 30, fontWeight: 600, color: c.fg, background: "rgba(14,14,20,0.9)", boxShadow: `inset 0 0 0 1px ${i === 5 ? c.brand2 : c.borderStrong}`, opacity: Math.min(1, s * 1.5), transform: `scale(${0.6 + 0.4 * s})` }}>
                {l}
              </span>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 26, justifyContent: "center" }}>
        {[
          { o: orders[2], tag: "Malayalam + English", t: at[2] },
          { o: orders[3], tag: "Hinglish", t: at[5] },
        ].map(({ o, tag, t }, i) => {
          const p = prog(f, t - 10, 16);
          return (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 22, opacity: p, transform: `translateX(${(1 - p) * 30}px)` }}>
              <Bubble text={o.source.text} from={o.source.chat} kind={o.source.kind} width={620} size={23} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                <Label color={i ? c.brand2 : c.brand}>{tag}</Label>
                <span style={{ fontFamily: fonts.sans, fontSize: 18, color: c.muted }}>→ {o.purchase} · {o.qty}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const FIELD_DEFS = [
  { icon: User, label: "Customer", type: "Text", v: (o: (typeof orders)[0]) => o.customer },
  { icon: Phone, label: "Phone", type: "Phone", v: (o: (typeof orders)[0]) => o.phone },
  { icon: Package, label: "Purchase", type: "Text", v: (o: (typeof orders)[0]) => o.purchase },
  { icon: Hash, label: "Quantity", type: "Number", v: (o: (typeof orders)[0]) => String(o.qty) },
  { icon: IndianRupee, label: "Value", type: "Currency", v: (o: (typeof orders)[0]) => formatINR(o.value) },
  { icon: Tag, label: "Status", type: "Select", v: (o: (typeof orders)[0]) => o.status },
];

const AgentsDetail: React.FC<{ start: number; extractAt: number; rowAt: number }> = ({ start, extractAt, rowAt }) => {
  const f = useCurrentFrame();
  const o = orders[2];
  const scope = window01(f, start, extractAt + 6, 14, 14);
  const ext = prog(f, extractAt, 16);
  const toRow = prog(f, rowAt, 26, EASE_IN_OUT);
  const scoped = [...chats.slice(0, 5).map((ch) => ({ name: ch.name, color: ch.color, on: true })), { name: "Personal chats", color: "#52525b", on: false }];
  return (
    <div style={{ position: "relative", height: "100%" }}>
      {/* scope */}
      {scope > 0 && (
        <div style={{ position: "absolute", inset: 0, opacity: scope, display: "flex", gap: 40 }}>
          <div style={{ ...surface(28), width: 760, padding: 28, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignContent: "start" }}>
            {scoped.map((s, i) => {
              const p = prog(f, start + 6 + i * 5, 12);
              return (
                <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 16, padding: "12px 14px", background: "rgba(10,10,15,0.7)", opacity: p * (s.on ? 1 : 0.6) }}>
                  <Avatar name={s.name} color={s.color} size={36} />
                  <span style={{ fontFamily: fonts.sans, fontSize: 18, fontWeight: 500, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                  <span style={{ width: 30, height: 30, borderRadius: 30, display: "grid", placeItems: "center", background: s.on ? "rgba(46,229,157,0.15)" : "rgba(255,91,91,0.15)" }}>
                    {s.on ? <Check size={17} color={c.brand2} /> : <X size={17} color={c.danger} />}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 18 }}>
            <Label>In scope → agents run here</Label>
            <Label color={c.danger}>Excluded → never read</Label>
            <div style={{ fontFamily: fonts.sans, fontSize: 26, color: c.fgSoft, lineHeight: 1.45, maxWidth: 640 }}>You decide which chats and groups are in scope. Agents only run on the chats that matter to your business.</div>
          </div>
        </div>
      )}
      {/* extraction */}
      {ext > 0 && (
        <div style={{ position: "absolute", inset: 0, opacity: ext, display: "flex", alignItems: "center", gap: 30 }}>
          <div style={{ width: 520, opacity: 1 - toRow * 0.4 }}>
            <Bubble text={o.source.text} from={o.source.chat} kind={o.source.kind} width={520} size={24} />
          </div>
          <svg width={110} height={300} style={{ flexShrink: 0 }}>
            {FIELD_DEFS.map((_, i) => {
              const y = 25 + i * 50;
              const p = prog(f, extractAt + 6 + i * 6, 10);
              return <path key={i} d={`M0 150 C 55 150, 55 ${y}, 110 ${y}`} stroke={i % 2 ? c.brand2 : c.brand} strokeWidth={2.5} fill="none" strokeDasharray={200} strokeDashoffset={200 * (1 - p)} opacity={0.8 * (1 - toRow)} />;
            })}
          </svg>
          <div style={{ flex: 1, position: "relative", height: 330 }}>
            {/* typed fields → compress into one row */}
            {FIELD_DEFS.map((fd, i) => {
              const p = springAt(f, 30, extractAt + 8 + i * 6, { damping: 15 });
              const Icon = fd.icon;
              const colW = 158;
              const x = mix(0, i * colW, toRow);
              const y = mix(i * 52, 120, toRow);
              const w = mix(820, colW - 8, toRow);
              return (
                <div key={fd.label} style={{ position: "absolute", left: x, top: y, width: w, height: 46, display: "flex", alignItems: "center", gap: 12, borderRadius: 12, padding: "0 14px", background: "rgba(14,14,20,0.95)", boxShadow: `inset 0 0 0 1px ${toRow > 0.5 ? "rgba(46,229,157,0.4)" : c.borderStrong}`, fontFamily: fonts.sans, opacity: Math.min(1, p * 1.5), transform: `translateX(${(1 - p) * 30}px)`, overflow: "hidden", whiteSpace: "nowrap" }}>
                  {toRow < 0.5 && (
                    <>
                      <Icon size={18} color={c.muted} />
                      <span style={{ fontSize: 17, color: c.muted, width: 92 }}>{fd.label}</span>
                      <span style={{ fontSize: 13, fontFamily: fonts.mono, color: c.brand, width: 80 }}>{fd.type}</span>
                    </>
                  )}
                  <span style={{ fontSize: toRow > 0.5 ? 16 : 20, fontWeight: 600, color: c.fg, overflow: "hidden", textOverflow: "ellipsis" }}>{fd.v(o)}</span>
                </div>
              );
            })}
            {toRow > 0.6 && (
              <div style={{ position: "absolute", left: 0, top: 190, opacity: prog(f, rowAt + 20, 12) }}>
                <Label>One row per order · lead · payment</Label>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const CollectionDetail: React.FC<{ start: number; updateAt: number }> = ({ start, updateAt }) => {
  const f = useCurrentFrame();
  const ev = incoming[2]; // Arjun: "Okay confirmed…" → o5 Confirmed (lib/data.ts)
  const rows = [orders[2], orders[3], orders[4], orders[5]];
  const link = prog(f, start + 10, 30, EASE_IN_OUT);
  const msg = springAt(f, 30, updateAt, { damping: 15 });
  const upd = f >= updateAt + 18;
  const flash = window01(f, updateAt + 18, updateAt + 80, 6, 30);
  return (
    <div style={{ display: "flex", gap: 36, height: "100%" }}>
      <div style={{ ...surface(26), flex: 1, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderBottom: `1px solid ${c.border}`, fontFamily: fonts.sans }}>
          <Table size={20} color={c.brand} />
          <span style={{ fontSize: 20, fontWeight: 600 }}>Orders</span>
          <span style={{ marginLeft: "auto" }}>
            <Label>Auto-update on</Label>
          </span>
        </div>
        {rows.map((r, i) => {
          const isUpd = r.id === ev.updates;
          const linked = i === 0;
          return (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 22px", borderBottom: `1px solid rgba(255,255,255,0.05)`, fontFamily: fonts.sans, fontSize: 18, background: isUpd && flash > 0 ? `rgba(46,229,157,${0.14 * flash})` : linked ? `rgba(139,125,255,${0.08 * link})` : undefined }}>
              <Avatar name={r.customer} size={32} />
              <span style={{ width: 200, fontWeight: 500 }}>{r.customer}</span>
              <span style={{ flex: 1, color: c.fgSoft }}>{r.purchase}</span>
              <span style={{ width: 100, textAlign: "right", fontFamily: fonts.mono, fontSize: 16 }}>{formatINR(r.value)}</span>
              <span style={{ width: 130 }}>
                <StatusBadge status={isUpd && upd ? ev.row.status : r.status} glow={isUpd ? flash : 0} />
              </span>
              {linked && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: c.brand, opacity: link }}>
                  <Link2 size={15} /> source
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ width: 560, display: "flex", flexDirection: "column", gap: 20, justifyContent: "center" }}>
        <div style={{ opacity: link, transform: `translateX(${(1 - link) * 20}px)` }}>
          <div style={{ fontFamily: fonts.mono, fontSize: 15, color: c.muted, marginBottom: 8, letterSpacing: "0.08em" }}>ROW 1 → SOURCE MESSAGE</div>
          <Bubble text={orders[2].source.text} from={orders[2].source.chat} kind="voice" width={560} size={19} />
        </div>
        <div style={{ opacity: Math.min(1, msg * 1.4), transform: `translateY(${(1 - msg) * -20}px)` }}>
          <div style={{ fontFamily: fonts.mono, fontSize: 15, color: c.brand2, marginBottom: 8, letterSpacing: "0.08em" }}>NEW MESSAGE → UPDATES THE RIGHT ROW</div>
          <Bubble text={ev.message} from={ev.from} kind={ev.kind} width={560} size={19} out />
        </div>
      </div>
    </div>
  );
};

export const S07Engine: React.FC<{ scene: TimelineScene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const q = cues(scene);
  const L = ["eng-1", "eng-2", "eng-3", "eng-4", "eng-5", "eng-6"].map((id) => q.at(id));
  const extractAt = q.phrase("eng-5", "They extract");
  const rowAt = q.phrase("eng-5", "and write");
  const active = f >= L[5] - 4 ? 4 : f >= extractAt - 4 ? 3 : f >= L[4] - 4 ? 2 : f >= L[2] - 4 ? 1 : f >= L[1] - 4 ? 0 : -1;
  const build = NODES.map((_, i) => prog(f, 10 + i * 9, 20, EASE_SNAP));
  const flow = prog(f, 60, 30);
  const stage = (from: number, to: number) => window01(f, from, to, 16, 12);
  const langAt = LANGS.map((l) => q.phrase("eng-4", l === "English" ? "English" : l));
  const plane = mix(16, 8, prog(f, 0, scene.duration, (t) => t));

  return (
    <SceneShell duration={scene.duration} enter="zoom-out" exit="blur">
      <Backdrop particles={45} seed={31} glowA="rgba(124,108,255,0.30)" glowB="rgba(46,229,157,0.16)" />
      <FloorGrid opacity={0.45} speed={1.4} />
      <ActLabel label={scene.act} />

      {/* pipeline on a tilted plane */}
      <AbsoluteFill style={{ perspective: 2000, perspectiveOrigin: "50% 20%" }}>
        <AbsoluteFill style={{ transform: `rotateX(${plane}deg) translateY(-20px)`, transformOrigin: "50% 28%" }}>
          <Rail active={active} build={build} flow={flow} />
        </AbsoluteFill>
      </AbsoluteFill>

      {/* establishing line */}
      <StageBox p={stage(L[0], L[1] - 4)}>
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Kinetic start={L[0]} size={92} segs={[{ t: "A " }, { t: "continuous", serif: true, grad: true }, { t: " pipeline." }]} />
        </div>
      </StageBox>
      <StageBox p={stage(L[1], L[2] - 4)}>
        <SyncDetail start={L[1]} backfillAt={q.phrase("eng-2", "backfilled")} />
      </StageBox>
      <StageBox p={stage(L[2], L[3] - 4)}>
        <UnderstandDetail start={L[2]} ocrAt={q.phrase("eng-3", "Text in")} />
      </StageBox>
      <StageBox p={stage(L[3], L[4] - 4)}>
        <LanguageDetail at={langAt} />
      </StageBox>
      <StageBox p={stage(L[4], L[5] - 4)}>
        <AgentsDetail start={L[4]} extractAt={extractAt} rowAt={rowAt} />
      </StageBox>
      <StageBox p={stage(L[5], scene.duration + 20)}>
        <CollectionDetail start={L[5]} updateAt={q.phrase("eng-6", "And every new")} />
      </StageBox>

      {build.map((_, i) => (
        <Sfx key={i} name="blip" at={10 + i * 9} volume={0.28} />
      ))}
      <Sfx name="whoosh" at={L[1] - 6} volume={0.3} />
      {[0, 1, 2, 3].map((i) => (
        <Sfx key={i} name="pop" at={L[1] + 8 + i * 6} volume={0.25} />
      ))}
      <Sfx name="riser-short" at={q.phrase("eng-2", "backfilled") - 4} volume={0.25} />
      <Sfx name="whoosh-soft" at={L[2] - 6} volume={0.3} />
      <Sfx name="typing" at={L[2] + 18} volume={0.22} duration={60} />
      <Sfx name="scan" at={q.phrase("eng-3", "Text in")} volume={0.4} />
      <Sfx name="success" at={q.phrase("eng-3", "Text in") + 34} volume={0.3} />
      <Sfx name="whoosh-soft" at={L[3] - 6} volume={0.3} />
      {langAt.map((a, i) => (
        <Sfx key={i} name={i % 2 ? "pop-high" : "pop"} at={a} volume={0.3} />
      ))}
      <Sfx name="whoosh-soft" at={L[4] - 6} volume={0.3} />
      <Sfx name="shimmer" at={extractAt} volume={0.3} />
      {FIELD_DEFS.map((_, i) => (
        <Sfx key={i} name="blip" at={extractAt + 8 + i * 6} volume={0.2} />
      ))}
      <Sfx name="whoosh-fast" at={rowAt} volume={0.3} />
      <Sfx name="whoosh-soft" at={L[5] - 6} volume={0.3} />
      <Sfx name="message" at={q.phrase("eng-6", "And every new")} volume={0.4} />
      <Sfx name="success" at={q.phrase("eng-6", "And every new") + 18} volume={0.35} />
    </SceneShell>
  );
};
