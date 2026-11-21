import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { QRCodeSVG } from "qrcode.react";
import { ArrowUp, Calendar, CircleCheck, CornerDownLeft, Hash, IndianRupee, LoaderCircle, Package, Phone, ShieldCheck, Smartphone, Sparkles, Tag, User } from "lucide-react";
import { Backdrop, Grid } from "../components/Backdrop";
import { ActLabel, Kinetic } from "../components/Brand";
import { SceneShell } from "../components/SceneShell";
import { Sfx } from "../components/Sfx";
import { Avatar, StatusBadge } from "../components/ui";
import { c, fonts, surface } from "../theme";
import { mix, prog, springAt, typed, typingDuration, window01 } from "../lib/anim";
import { cues, type TimelineScene } from "../lib/timeline";
import { formatINR, orders } from "../data/product";

/* Step copy is quoted from components/sections/how-it-works.tsx */
const STEPS = [
  { n: "01", title: "Scan to connect", body: "Open Infera and scan a QR code to link WhatsApp — the same way WhatsApp Web works. No new number, no migration." },
  { n: "02", title: "Organise your data with just a prompt", body: "Infera reads every message, finds the leads, and saves them into a collection — a table you can use just like Excel." },
  { n: "03", title: "Collection (a searchable table)", body: "Infera searches the collection it created — the way you’d search a sheet — and gives you a proper, cited answer." },
];
const PROMPT = "Find all orders from my chats for the last month";
const QUESTION = "Who asked about the blue running shoes?";
const FIELDS = [
  { icon: User, label: "Customer", type: "Text" },
  { icon: Phone, label: "Phone", type: "Phone" },
  { icon: Package, label: "Purchase", type: "Text" },
  { icon: Hash, label: "Quantity", type: "Number" },
  { icon: IndianRupee, label: "Value", type: "Currency" },
  { icon: Tag, label: "Status", type: "Select" },
];

const Spinner: React.FC<{ size?: number; color?: string }> = ({ size = 28, color = c.brand }) => {
  const f = useCurrentFrame();
  return <LoaderCircle size={size} color={color} style={{ transform: `rotate(${f * 14}deg)` }} />;
};

const Shimmer: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame();
  const pos = ((f * 4) % 300) - 100;
  return (
    <span style={{ fontWeight: 500, backgroundImage: `linear-gradient(90deg, ${c.muted} ${pos - 30}%, ${c.fg} ${pos}%, ${c.muted} ${pos + 30}%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{text}</span>
  );
};

/* ------------------------------ step 1 ------------------------------ */
const LinkFlow: React.FC<{ tScan: number; tConn: number; tDone: number; start: number }> = ({ tScan, tConn, tDone, start }) => {
  const f = useCurrentFrame();
  const phase = f >= tDone ? 3 : f >= tConn ? 2 : f >= tScan ? 1 : 0;
  const labels = ["Allow access", "Scan QR code", "Connecting", "Logged in"];
  const paneP = prog(f, [start, tScan, tConn, tDone][phase], 14);
  const scanY = (Math.sin(((f - tScan) / 30) * Math.PI) * 0.5 + 0.5) * 292;
  const doneS = springAt(f, 30, tDone, { damping: 10, stiffness: 220 });
  return (
    <div style={{ width: 560 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 26 }}>
        {labels.map((l, i) => (
          <div key={l} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <span style={{ height: 5, width: "100%", borderRadius: 5, background: i <= phase ? c.brand2 : c.border }} />
            <span style={{ fontSize: 16, color: i === phase ? c.fg : c.muted, fontWeight: i === phase ? 500 : 400 }}>{l}</span>
          </div>
        ))}
      </div>
      <div style={{ ...surface(30), padding: 34, minHeight: 470, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div style={{ opacity: paneP, transform: `translateY(${(1 - paneP) * 12}px)`, display: "flex", flexDirection: "column", alignItems: "center" }}>
          {phase === 0 && (
            <>
              <span style={{ width: 84, height: 84, borderRadius: 24, display: "grid", placeItems: "center", background: "rgba(139,125,255,0.12)", color: c.brand }}>
                <ShieldCheck size={42} />
              </span>
              <div style={{ marginTop: 22, fontSize: 26, fontWeight: 600 }}>Link your WhatsApp</div>
              <div style={{ marginTop: 8, fontSize: 19, color: c.muted, maxWidth: 420 }}>Choose which chats Infera can read. You can change this any time.</div>
              <span style={{ marginTop: 26, height: 52, display: "inline-flex", alignItems: "center", borderRadius: 99, background: c.fg, color: c.bg, padding: "0 28px", fontSize: 19, fontWeight: 600 }}>Allow access</span>
            </>
          )}
          {phase === 1 && (
            <>
              <div style={{ position: "relative", borderRadius: 22, background: "#fff", padding: 16 }}>
                <QRCodeSVG value="https://infera.ai/link/demo-session-7f3a9c" size={292} level="M" fgColor="#0b0b10" />
                <span style={{ position: "absolute", left: 16, right: 16, top: 16 + scanY, height: 5, borderRadius: 5, background: c.brand2, boxShadow: "0 0 24px 6px rgba(46,229,157,0.6)" }} />
              </div>
              <div style={{ marginTop: 22, fontSize: 20, color: c.muted }}>
                WhatsApp → <b style={{ color: c.fg }}>Linked devices</b> → Link a device
              </div>
            </>
          )}
          {phase === 2 && (
            <>
              <div style={{ position: "relative", width: 120, height: 120, display: "grid", placeItems: "center" }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: 120, background: "rgba(46,229,157,0.2)", transform: `scale(${1 + ((f % 24) / 24) * 0.6})`, opacity: 1 - (f % 24) / 24 }} />
                <span style={{ width: 96, height: 96, borderRadius: 96, display: "grid", placeItems: "center", background: "rgba(46,229,157,0.15)" }}>
                  <Spinner size={42} color={c.brand2} />
                </span>
              </div>
              <div style={{ marginTop: 22, fontSize: 26, fontWeight: 600 }}>Connecting…</div>
              <div style={{ marginTop: 8, fontSize: 19, color: c.muted }}>Securely syncing your chats and backfilling history</div>
            </>
          )}
          {phase === 3 && (
            <>
              <span style={{ width: 96, height: 96, borderRadius: 96, display: "grid", placeItems: "center", background: c.brand2, color: "#fff", transform: `scale(${0.5 + 0.5 * doneS})`, boxShadow: "0 16px 50px -10px rgba(46,229,157,0.8)" }}>
                <CircleCheck size={48} />
              </span>
              <div style={{ marginTop: 22, fontSize: 26, fontWeight: 600 }}>Successfully logged in</div>
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, borderRadius: 99, background: c.bgSunken, padding: "8px 18px", fontSize: 17, color: c.fgSoft }}>
                <Smartphone size={18} /> +91 98470 ••••• · 54 chats · 3 years of history
              </div>
              <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
                {["No new number", "No migration"].map((t, i) => {
                  const p = springAt(f, 30, tDone + 10 + i * 8, { damping: 14 });
                  return (
                    <span key={t} style={{ borderRadius: 99, padding: "8px 18px", fontSize: 18, fontWeight: 600, color: c.brand2, background: "rgba(46,229,157,0.12)", boxShadow: "inset 0 0 0 1px rgba(46,229,157,0.3)", opacity: Math.min(1, p * 1.5), transform: `scale(${0.8 + 0.2 * p})` }}>
                      ✓ {t}
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------ step 2 ------------------------------ */
const PlanFlow: React.FC<{ tType: number; tPlan: number; tAccept: number }> = ({ tType, tPlan, tAccept }) => {
  const f = useCurrentFrame();
  const typedText = typed(PROMPT, f, tType, 32);
  const typingDone = tType + typingDuration(PROMPT, 32);
  const thinking = f >= typingDone + 4 && f < tPlan;
  const plan = prog(f, tPlan, 18);
  const created = f >= tAccept + 10;
  const press = prog(f, tAccept, 10);
  return (
    <div style={{ width: 640, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ ...surface(22), display: "flex", alignItems: "center", gap: 12, padding: "12px 12px 12px 22px" }}>
        <Sparkles size={22} color={c.brand} />
        <div style={{ flex: 1, fontSize: 21, minHeight: 28, whiteSpace: "nowrap", overflow: "hidden" }}>
          {typedText}
          {f < typingDone + 4 && <span style={{ display: "inline-block", width: 2, height: 24, marginLeft: 2, background: c.fg, opacity: Math.floor(f / 8) % 2 ? 1 : 0.2, transform: "translateY(4px)" }} />}
        </div>
        <span style={{ width: 44, height: 44, borderRadius: 14, display: "grid", placeItems: "center", background: f >= typingDone ? c.fg : c.bgSunken, color: f >= typingDone ? c.bg : c.muted }}>
          <ArrowUp size={22} />
        </span>
      </div>
      {thinking && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 8px", fontSize: 20 }}>
          <Spinner size={22} /> <Shimmer text="Reading 54 chats and designing a table…" />
        </div>
      )}
      {plan > 0 && (
        <div style={{ ...surface(22), overflow: "hidden", opacity: plan, transform: `translateY(${(1 - plan) * 20}px)` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: `1px solid ${c.border}` }}>
            <div>
              <div style={{ fontSize: 13, letterSpacing: "0.12em", color: c.muted, textTransform: "uppercase", fontWeight: 500 }}>Collection creation plan</div>
              <div style={{ marginTop: 4, fontSize: 22, fontWeight: 600 }}>
                Orders <span style={{ fontWeight: 400, color: c.muted }}>· 6 fields</span>
              </div>
            </div>
            <span style={{ borderRadius: 99, padding: "4px 12px", fontSize: 14, fontWeight: 500, color: c.brand, background: "rgba(139,125,255,0.12)" }}>Auto-update on</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: 16 }}>
            {FIELDS.map((fd, i) => {
              const p = prog(f, tPlan + 8 + i * 5, 12);
              const Icon = fd.icon;
              return (
                <div key={fd.label} style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 14, background: "rgba(10,10,15,0.7)", padding: "12px 16px", fontSize: 18, opacity: p, transform: `translateY(${(1 - p) * 10}px)` }}>
                  <Icon size={17} color={c.muted} />
                  <span style={{ fontWeight: 500 }}>{fd.label}</span>
                  <span style={{ marginLeft: "auto", fontSize: 14, color: c.muted }}>{fd.type}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderTop: `1px solid ${c.border}` }}>
            {created ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 500, color: c.brand2 }}>
                <CircleCheck size={19} /> Collection created · 24 orders found
              </span>
            ) : (
              <span style={{ fontSize: 16, color: c.muted }}>Sources: 9 chats · 3 groups · Oct 17 – Nov 17</span>
            )}
            <span style={{ height: 40, display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 99, padding: "0 20px", fontSize: 16, fontWeight: 600, background: created ? "rgba(46,229,157,0.15)" : c.fg, color: created ? c.brand2 : c.bg, transform: `scale(${1 - 0.07 * Math.sin(Math.PI * press)})` }}>
              {created ? "Accepted" : "Accept"} {!created && <CornerDownLeft size={15} />}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------ step 3 ------------------------------ */
const AskFlow: React.FC<{ tAsk: number; tAnswer: number }> = ({ tAsk, tAnswer }) => {
  const f = useCurrentFrame();
  const q = typed(QUESTION, f, tAsk, 30);
  const doneTyping = tAsk + typingDuration(QUESTION, 30);
  const matches = orders.filter((o) => o.purchase.toLowerCase().includes("blue running shoes"));
  const ans = prog(f, tAnswer, 18);
  return (
    <div style={{ width: 640, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {f >= tAsk && (
          <div style={{ maxWidth: "88%", borderRadius: "22px 22px 6px 22px", background: c.fg, color: c.bg, padding: "14px 22px", fontSize: 21 }}>
            {q}
            {f < doneTyping + 4 && <span style={{ display: "inline-block", width: 2, height: 22, marginLeft: 2, background: c.bg, transform: "translateY(4px)" }} />}
          </div>
        )}
      </div>
      {f >= doneTyping + 4 && f < tAnswer && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 20 }}>
          <Spinner size={22} /> <Shimmer text="Searching Orders collection…" />
        </div>
      )}
      {ans > 0 && (
        <div style={{ ...surface(22), borderBottomLeftRadius: 8, padding: 24, opacity: ans, transform: `translateY(${(1 - ans) * 16}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 500, color: c.brand }}>
            <Sparkles size={17} /> Infera
          </div>
          <div style={{ marginTop: 10, fontSize: 21, lineHeight: 1.5 }}>
            <b>{matches.length} customers</b> asked about the blue running shoes this month. Rahul has already paid; Neha is waiting on a price for UK 7.
          </div>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {matches.map((m, i) => {
              const p = prog(f, tAnswer + 10 + i * 6, 12);
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 14, background: "rgba(10,10,15,0.7)", padding: "10px 14px", fontSize: 18, opacity: p, transform: `translateX(${(1 - p) * -14}px)` }}>
                  <Avatar name={m.customer} size={30} />
                  <span style={{ fontWeight: 500 }}>{m.customer}</span>
                  <span style={{ fontSize: 15, color: c.muted }}>{m.purchase.split("·")[1]}</span>
                  <span style={{ marginLeft: "auto", fontFamily: fonts.mono, fontSize: 16, color: c.fgSoft }}>{formatINR(m.value)}</span>
                  <StatusBadge status={m.status} />
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, fontSize: 15, color: c.muted }}>
            <Calendar size={15} /> Sources: 2 rows · linked to original messages
          </div>
        </div>
      )}
    </div>
  );
};

export const S06Workflow: React.FC<{ scene: TimelineScene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const q = cues(scene);
  const L1 = q.at("flow-1");
  const L2 = q.at("flow-2");
  const L3 = q.at("flow-3");
  const L4 = q.at("flow-4");
  const L5 = q.at("flow-5");
  const L6 = q.at("flow-6");
  const active = f >= L5 - 6 ? 2 : f >= L3 - 6 ? 1 : f >= L1 + 12 ? 0 : -1;
  const stepStart = [L1 + 12, L3 - 6, L5 - 6];
  const stepEnd = [L3 - 6, L5 - 6, scene.duration];

  const head = prog(f, L1 - 4, 20);
  const panelIn = prog(f, L1 + 6, 24);
  const paneSwap = (i: number) => window01(f, stepStart[i], stepEnd[i] + (i === 2 ? 30 : 0), 16, 12);

  const tScan = q.phrase("flow-2", "scan");
  const tConn = q.phrase("flow-2", "the same way") + 16;
  const tDone = q.phrase("flow-2", "No new number") - 8;
  const tType = q.phrase("flow-3", "find all");
  const tPlan = L4 + 12;
  const tAccept = q.phrase("flow-4", "Accept");
  const tAsk = q.phrase("flow-5", "Who asked");
  const tAnswer = L6 + 4;

  return (
    <SceneShell duration={scene.duration} enter="slide-left" exit="blur">
      <Backdrop particles={30} seed={21} glowA="rgba(124,108,255,0.26)" glowB="rgba(46,229,157,0.18)" />
      <ActLabel label={scene.act} />

      {/* heading (site copy) */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 130, opacity: head }}>
        <Kinetic start={L1} size={64} segs={[{ t: "Set up in " }, { t: "60 seconds.", serif: true, grad: true }, { t: " Works 24/7 in the background." }]} />
      </div>

      {/* steps list */}
      <div style={{ position: "absolute", left: 120, top: 300, width: 640, display: "flex", flexDirection: "column", gap: 14, fontFamily: fonts.sans }}>
        {STEPS.map((s, i) => {
          const on = i === active;
          const p = prog(f, L1 + 10 + i * 6, 18);
          const bar = on ? prog(f, stepStart[i], stepEnd[i] - stepStart[i], (t) => t) : 0;
          return (
            <div
              key={s.n}
              style={{
                position: "relative",
                overflow: "hidden",
                borderRadius: 28,
                padding: "26px 30px",
                opacity: p * (on ? 1 : 0.6),
                transform: `translateX(${(1 - p) * -30}px)`,
                ...(on ? surface(28) : { border: "1px solid transparent" }),
              }}
            >
              <div style={{ display: "flex", gap: 20 }}>
                <span style={{ fontFamily: fonts.mono, fontSize: 20, color: on ? c.brand : c.muted, marginTop: 4 }}>{s.n}</span>
                <div>
                  <div style={{ fontFamily: fonts.sans, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", color: on ? c.fg : c.fgSoft }}>{s.title}</div>
                  <div style={{ maxHeight: on ? 200 * prog(f, stepStart[i], 14) : 0, overflow: "hidden" }}>
                    <div style={{ paddingTop: 10, fontSize: 20, lineHeight: 1.5, color: c.muted }}>{s.body}</div>
                  </div>
                </div>
              </div>
              {on && (
                <span style={{ position: "absolute", left: 30, right: 30, bottom: 0, height: 3, borderRadius: 3, background: c.border, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${bar * 100}%`, background: `linear-gradient(90deg, ${c.brand}, ${c.brand2})` }} />
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* demo panel */}
      <div style={{ position: "absolute", left: 840, top: 290, width: 960, height: 700, opacity: panelIn, transform: `translateY(${(1 - panelIn) * 40}px)` }}>
        <div style={{ position: "absolute", inset: -40, borderRadius: 60, background: "radial-gradient(50% 50% at 50% 50%, rgba(124,108,255,0.22), transparent 70%)" }} />
        <div style={{ ...surface(32), position: "absolute", inset: 0, overflow: "hidden", boxShadow: `0 0 0 1px rgba(139,125,255,0.25), 0 40px 100px -40px rgba(0,0,0,0.9)` }}>
          <Grid opacity={1} size={56} mask="radial-gradient(80% 80% at 50% 50%, black, transparent)" />
          {[0, 1, 2].map((i) => {
            const p = paneSwap(i);
            if (p <= 0) return null;
            return (
              <AbsoluteFill key={i} style={{ justifyContent: "center", alignItems: "center", opacity: p, transform: `translateY(${(1 - p) * 16}px) scale(${mix(0.98, 1, p)})`, fontFamily: fonts.sans, color: c.fg }}>
                {i === 0 && <LinkFlow start={stepStart[0]} tScan={tScan} tConn={tConn} tDone={tDone} />}
                {i === 1 && <PlanFlow tType={tType} tPlan={tPlan} tAccept={tAccept} />}
                {i === 2 && <AskFlow tAsk={tAsk} tAnswer={tAnswer} />}
              </AbsoluteFill>
            );
          })}
        </div>
      </div>

      <Sfx name="whoosh-soft" at={L1 + 4} volume={0.35} />
      <Sfx name="click" at={tScan - 4} volume={0.4} />
      <Sfx name="scan" at={tScan + 4} volume={0.35} />
      <Sfx name="scan" at={tScan + 34} volume={0.3} />
      <Sfx name="success" at={tDone} volume={0.4} />
      <Sfx name="whoosh-fast" at={L3 - 6} volume={0.3} />
      <Sfx name="typing" at={tType} volume={0.32} duration={typingDuration(PROMPT, 32)} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Sfx key={i} name="blip" at={tPlan + 8 + i * 5} volume={0.2} />
      ))}
      <Sfx name="click" at={tAccept} volume={0.5} />
      <Sfx name="success" at={tAccept + 10} volume={0.4} />
      <Sfx name="whoosh-fast" at={L5 - 6} volume={0.3} />
      <Sfx name="typing" at={tAsk} volume={0.32} duration={typingDuration(QUESTION, 30)} />
      <Sfx name="shimmer" at={tAnswer} volume={0.3} />
    </SceneShell>
  );
};

