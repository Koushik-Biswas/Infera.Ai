import React from "react";
import { AudioLines, ChevronDown, Download, Funnel, Image as ImageIcon, Inbox, Layers, MessageCircle, Plus, Search, Settings, Sparkles, Table, Users, CheckCheck } from "lucide-react";
import { c, fonts, surface } from "../theme";
import { LogoMark } from "./Brand";
import { chats, formatDate, formatINR, type OrderRow, type OrderStatus } from "../data/product";

/* ------------------------------------------------------------------ */
/*  Primitives (dark-theme ports of components/ui/status-badge.tsx)    */
/* ------------------------------------------------------------------ */
export const Avatar: React.FC<{ name: string; color?: string; size?: number }> = ({ name, color, size = 40 }) => {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  const hue = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        fontFamily: fonts.sans,
        fontWeight: 600,
        fontSize: size * 0.36,
        color: "#fff",
        background: color ?? `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + 40) % 360} 70% 48%))`,
      }}
    >
      {initials}
    </span>
  );
};

const STATUS: Record<OrderStatus, { fg: string; bg: string; ring: string; dot: string }> = {
  New: { fg: c.brand, bg: "rgba(139,125,255,0.12)", ring: "rgba(139,125,255,0.28)", dot: c.brand },
  Confirmed: { fg: "#38bdf8", bg: "rgba(14,165,233,0.12)", ring: "rgba(14,165,233,0.28)", dot: "#0ea5e9" },
  Pending: { fg: "#fbbf24", bg: "rgba(245,158,11,0.14)", ring: "rgba(245,158,11,0.28)", dot: "#f59e0b" },
  Paid: { fg: c.brand2, bg: "rgba(46,229,157,0.14)", ring: "rgba(46,229,157,0.32)", dot: c.brand2 },
  Shipped: { fg: c.fgSoft, bg: "rgba(113,113,122,0.14)", ring: "rgba(113,113,122,0.3)", dot: "#a1a1aa" },
};

export const StatusBadge: React.FC<{ status: OrderStatus; scale?: number; glow?: number }> = ({ status, scale = 1, glow = 0 }) => {
  const s = STATUS[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8 * scale,
        borderRadius: 999,
        padding: `${3 * scale}px ${11 * scale}px`,
        fontSize: 15 * scale,
        fontWeight: 500,
        fontFamily: fonts.sans,
        whiteSpace: "nowrap",
        color: s.fg,
        background: s.bg,
        boxShadow: `inset 0 0 0 1px ${s.ring}${glow ? `, 0 0 ${24 * glow}px ${s.dot}` : ""}`,
      }}
    >
      <span style={{ width: 7 * scale, height: 7 * scale, borderRadius: 9, background: s.dot }} />
      {status}
    </span>
  );
};

export const KindIcon: React.FC<{ kind: string; size?: number; color?: string }> = ({ kind, size = 16, color = c.muted }) => {
  if (kind === "voice") return <AudioLines size={size} color={color} />;
  if (kind === "image") return <ImageIcon size={size} color={color} />;
  return <MessageCircle size={size} color={color} />;
};

/* ------------------------------------------------------------------ */
/*  Desktop app window (components/mockups/desktop-collection.tsx)     */
/* ------------------------------------------------------------------ */
export const AppWindow: React.FC<{ title: string; width: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ title, width, children, style }) => (
  <div style={{ ...surface(26), width, overflow: "hidden", fontFamily: fonts.sans, color: c.fg, ...style }}>
    <div style={{ height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", borderBottom: `1px solid ${c.border}`, background: "rgba(10,10,15,0.8)" }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((col) => (
        <span key={col} style={{ width: 14, height: 14, borderRadius: 14, background: col }} />
      ))}
      <div style={{ margin: "0 auto", display: "flex", alignItems: "center", gap: 8, borderRadius: 8, background: c.bgElev, padding: "4px 14px", fontSize: 15, color: c.muted, boxShadow: `inset 0 0 0 1px ${c.border}` }}>
        <LogoMark size={16} id={`win-${title}`} /> {title}
      </div>
      <span style={{ width: 60 }} />
    </div>
    {children}
  </div>
);

const SideItem: React.FC<{ icon: React.ReactNode; label: string; active?: boolean; badge?: string; muted?: boolean }> = ({ icon, label, active, badge, muted }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 11,
      borderRadius: 10,
      padding: "9px 12px",
      fontSize: 16,
      fontWeight: active ? 500 : 400,
      color: active ? c.fg : muted ? c.muted : c.fgSoft,
      background: active ? c.bgElev : undefined,
      boxShadow: active ? `inset 0 0 0 1px ${c.border}` : undefined,
    }}
  >
    <span style={{ color: active ? c.brand : c.muted, display: "flex" }}>{icon}</span>
    {label}
    {badge && <span style={{ marginLeft: "auto", fontSize: 13, color: c.muted }}>{badge}</span>}
  </div>
);

export const Sidebar: React.FC = () => (
  <aside style={{ width: 250, flexShrink: 0, display: "flex", flexDirection: "column", gap: 2, borderRight: `1px solid ${c.border}`, background: "rgba(10,10,15,0.55)", padding: 16 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginBottom: 8 }}>
      <span style={{ width: 26, height: 26, borderRadius: 7, display: "grid", placeItems: "center", background: "rgba(46,229,157,0.15)", color: c.brand2, fontSize: 13, fontWeight: 700 }}>M</span>
      <span style={{ fontWeight: 500, fontSize: 16 }}>Menon Traders</span>
    </div>
    <SideItem icon={<Inbox size={17} />} label="Chats" badge="54" />
    <SideItem icon={<Sparkles size={17} />} label="Ask Infera" />
    <p style={{ margin: "16px 0 4px", padding: "0 12px", fontSize: 12, letterSpacing: "0.12em", color: c.muted, textTransform: "uppercase", fontWeight: 500 }}>Collections</p>
    <SideItem icon={<Table size={17} />} label="Orders" active badge="24" />
    <SideItem icon={<Table size={17} />} label="Leads" badge="61" />
    <SideItem icon={<Table size={17} />} label="Payments" />
    <SideItem icon={<Table size={17} />} label="Vendors" />
    <SideItem icon={<Plus size={17} />} label="New collection" muted />
    <div style={{ marginTop: "auto", paddingTop: 24 }}>
      <SideItem icon={<Layers size={17} />} label="Agents" />
      <SideItem icon={<Settings size={17} />} label="Settings" />
    </div>
  </aside>
);

export type ColKey = "customer" | "purchase" | "qty" | "value" | "status" | "date";

/** Orders collection table. Row-level animation state is passed in per frame. */
export const OrdersTable: React.FC<{
  rows: OrderRow[];
  rowState?: Record<string, { flash?: number; enter?: number; status?: OrderStatus; statusGlow?: number }>;
  highlightCol?: ColKey | null;
  colGlow?: number;
  expanded?: { id: string; progress: number } | null;
  cursorRow?: string | null;
}> = ({ rows, rowState = {}, highlightCol, colGlow = 0, expanded }) => {
  const head: { k: ColKey; label: string; align?: "right"; w: number }[] = [
    { k: "customer", label: "Customer", w: 300 },
    { k: "purchase", label: "Purchase", w: 300 },
    { k: "qty", label: "Qty", align: "right", w: 70 },
    { k: "value", label: "Value", align: "right", w: 130 },
    { k: "status", label: "Status", w: 150 },
    { k: "date", label: "Date", align: "right", w: 110 },
  ];
  const cellPad = "13px 14px";
  const hl = (k: ColKey) => (highlightCol === k ? colGlow : 0);
  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${c.border}`, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: c.muted, fontWeight: 500 }}>
        {head.map((h) => (
          <div
            key={h.k}
            style={{
              width: h.w,
              padding: cellPad,
              paddingLeft: h.k === "customer" ? 24 : 14,
              textAlign: h.align,
              color: hl(h.k) > 0 ? c.fg : c.muted,
              background: hl(h.k) > 0 ? `rgba(139,125,255,${0.16 * hl(h.k)})` : undefined,
              boxShadow: hl(h.k) > 0 ? `inset 0 -2px 0 rgba(139,125,255,${hl(h.k)})` : undefined,
            }}
          >
            {h.label}
          </div>
        ))}
        <div style={{ width: 36 }} />
      </div>
      {rows.map((r) => {
        const st = rowState[r.id] ?? {};
        const enter = st.enter ?? 1;
        const status = st.status ?? r.status;
        const flash = st.flash ?? 0;
        const isExp = expanded?.id === r.id;
        return (
          <div key={r.id} style={{ overflow: "hidden", maxHeight: enter * 220, opacity: Math.min(1, enter * 1.4) }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                borderBottom: `1px solid rgba(255,255,255,0.055)`,
                background: flash > 0 ? `rgba(46,229,157,${0.13 * flash})` : isExp ? "rgba(255,255,255,0.025)" : undefined,
                boxShadow: flash > 0 ? `inset 3px 0 0 rgba(46,229,157,${flash})` : undefined,
                fontSize: 17,
                transform: `translateY(${(1 - enter) * -14}px)`,
              }}
            >
              <div style={{ width: head[0].w, padding: cellPad, paddingLeft: 24, display: "flex", alignItems: "center", gap: 13, background: hl("customer") ? `rgba(139,125,255,${0.06 * hl("customer")})` : undefined }}>
                <Avatar name={r.customer} size={36} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{r.customer}</div>
                  <div style={{ fontSize: 13, color: c.muted }}>{r.phone}</div>
                </div>
              </div>
              <div style={{ width: head[1].w, padding: cellPad, color: c.fgSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", background: hl("purchase") ? `rgba(139,125,255,${0.06 * hl("purchase")})` : undefined }}>{r.purchase}</div>
              <div style={{ width: head[2].w, padding: cellPad, textAlign: "right", color: c.fgSoft, fontVariantNumeric: "tabular-nums", background: hl("qty") ? `rgba(139,125,255,${0.06 * hl("qty")})` : undefined }}>{r.qty}</div>
              <div style={{ width: head[3].w, padding: cellPad, textAlign: "right", fontFamily: fonts.mono, fontSize: 16, background: hl("value") ? `rgba(139,125,255,${0.06 * hl("value")})` : undefined }}>{formatINR(r.value)}</div>
              <div style={{ width: head[4].w, padding: cellPad, background: hl("status") ? `rgba(139,125,255,${0.06 * hl("status")})` : undefined }}>
                <StatusBadge status={status} glow={st.statusGlow ?? 0} />
              </div>
              <div style={{ width: head[5].w, padding: cellPad, textAlign: "right", color: c.muted, whiteSpace: "nowrap", background: hl("date") ? `rgba(139,125,255,${0.06 * hl("date")})` : undefined }}>{formatDate(r.date)}</div>
              <div style={{ width: 36, display: "flex", color: c.muted }}>
                <ChevronDown size={18} style={{ transform: isExp ? "rotate(180deg)" : undefined }} />
              </div>
            </div>
            {isExp && expanded && <SourceMessage row={r} progress={expanded.progress} />}
          </div>
        );
      })}
    </div>
  );
};

/** "Click a row to see the message it came from" (collections.tsx → SourceMessage). */
export const SourceMessage: React.FC<{ row: OrderRow; progress: number }> = ({ row, progress }) => (
  <div style={{ maxHeight: progress * 140, overflow: "hidden", background: "rgba(10,10,15,0.6)", borderBottom: `1px solid ${c.border}` }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 18, padding: "16px 24px", opacity: progress, transform: `translateY(${(1 - progress) * -8}px)` }}>
      <span style={{ marginTop: 4, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: c.muted, fontWeight: 500 }}>Source</span>
      <div style={{ flex: 1, maxWidth: 720, borderRadius: "18px 18px 18px 6px", background: c.bgElev, padding: "12px 18px", boxShadow: `inset 0 0 0 1px ${c.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: c.muted, marginBottom: 4 }}>
          <KindIcon kind={row.source.kind} size={14} /> {row.source.chat} · {formatDate(row.date)}
        </div>
        <div style={{ fontSize: 18 }}>{row.source.text}</div>
      </div>
      <span style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: c.muted }}>
        <Sparkles size={15} color={c.brand} /> Extracted with 97% confidence
      </span>
    </div>
  </div>
);

/** Toolbar above the table (desktop-collection.tsx). */
export const CollectionHeader: React.FC<{ count: number; total: number; exportPress?: number }> = ({ count, total, exportPress = 0 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 24px", borderBottom: `1px solid ${c.border}` }}>
    <span style={{ width: 44, height: 44, borderRadius: 13, display: "grid", placeItems: "center", background: "rgba(139,125,255,0.12)", color: c.brand }}>
      <Table size={20} />
    </span>
    <div style={{ marginRight: "auto" }}>
      <div style={{ fontWeight: 600, fontSize: 20, letterSpacing: "-0.01em" }}>Orders</div>
      <div style={{ fontSize: 14, color: c.muted }}>
        {count} rows · {formatINR(total)} total · Auto-updating · from 9 chats &amp; 3 groups
      </div>
    </div>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 11, border: `1px solid ${c.border}`, padding: "8px 14px", fontSize: 15, color: c.muted, width: 230 }}>
      <Search size={15} /> Search customer, product, chat…
    </span>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 11, border: `1px solid ${c.border}`, padding: "8px 12px", fontSize: 15, color: c.muted }}>
      <Funnel size={15} /> Status
    </span>
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        borderRadius: 11,
        background: c.fg,
        color: c.bg,
        padding: "8px 16px",
        fontSize: 15,
        fontWeight: 600,
        transform: `scale(${1 - 0.08 * Math.sin(Math.PI * exportPress)})`,
        boxShadow: exportPress > 0 ? `0 0 ${30 * Math.sin(Math.PI * exportPress)}px rgba(255,255,255,0.6)` : undefined,
      }}
    >
      <Download size={15} /> Export
    </span>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Phone with the Chats list (components/mockups/phone-chats.tsx)     */
/* ------------------------------------------------------------------ */
export const PhoneChats: React.FC<{ width?: number; unreadBoost?: number; dim?: number }> = ({ width = 380, unreadBoost = 0, dim = 0 }) => {
  const k = width / 248;
  return (
    <div style={{ width, borderRadius: 42 * k, background: "#0b0b10", padding: 7 * k, boxShadow: "0 40px 80px -30px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.12)" }}>
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 36 * k, background: c.bgElev, fontFamily: fonts.sans, color: c.fg }}>
        <div style={{ height: 36 * k, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `${4 * k}px ${24 * k}px 0`, fontSize: 10 * k, fontWeight: 600 }}>
          <span>9:41</span>
          <span style={{ position: "absolute", left: "50%", top: 8 * k, width: 80 * k, height: 20 * k, marginLeft: -40 * k, borderRadius: 20 * k, background: "#0b0b10" }} />
          <span style={{ width: 14 * k, height: 8 * k, borderRadius: 2 * k, border: "1px solid currentColor", opacity: 0.8 }} />
        </div>
        <div style={{ padding: `0 ${16 * k}px ${8 * k}px` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 19 * k, fontWeight: 600, letterSpacing: "-0.02em" }}>Chats</span>
            <span style={{ width: 28 * k, height: 28 * k, borderRadius: 28 * k, display: "grid", placeItems: "center", background: "rgba(139,125,255,0.12)", color: c.brand }}>
              <Sparkles size={14 * k} />
            </span>
          </div>
          <div style={{ marginTop: 8 * k, display: "flex", alignItems: "center", gap: 6 * k, borderRadius: 12 * k, background: c.bgSunken, padding: `${6 * k}px ${10 * k}px`, fontSize: 10.5 * k, color: c.muted }}>
            <Search size={12 * k} /> Ask or search chats
          </div>
          <div style={{ marginTop: 8 * k, display: "flex", gap: 6 * k, fontSize: 10 * k }}>
            {["All", "Unread", "Groups", "Tracked"].map((t, i) => (
              <span key={t} style={{ borderRadius: 99, padding: `${2 * k}px ${8 * k}px`, background: i === 0 ? c.fg : c.bgSunken, color: i === 0 ? c.bg : c.muted, fontWeight: i === 0 ? 500 : 400 }}>
                {t}
              </span>
            ))}
          </div>
        </div>
        <div style={{ paddingBottom: 12 * k, opacity: 1 - dim * 0.5 }}>
          {chats.map((ch) => {
            const unread = ch.unread ? ch.unread + Math.round(unreadBoost * (ch.unread > 10 ? 40 : 9)) : 0;
            return (
              <div key={ch.name} style={{ display: "flex", alignItems: "center", gap: 10 * k, padding: `${7 * k}px ${16 * k}px` }}>
                <div style={{ position: "relative" }}>
                  <Avatar name={ch.name} color={ch.color} size={36 * k} />
                  {ch.group && (
                    <span style={{ position: "absolute", right: -2 * k, bottom: -2 * k, width: 14 * k, height: 14 * k, borderRadius: 14 * k, display: "grid", placeItems: "center", background: c.bgElev, boxShadow: `inset 0 0 0 1px ${c.border}` }}>
                      <Users size={8 * k} color={c.muted} />
                    </span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 * k }}>
                    <span style={{ fontSize: 11.5 * k, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ch.name}</span>
                    <span style={{ fontSize: 9.5 * k, color: ch.unread ? c.brand2 : c.muted, flexShrink: 0 }}>{ch.time}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 * k }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 * k, fontSize: 10.5 * k, color: c.muted, whiteSpace: "nowrap", overflow: "hidden" }}>
                      {!ch.unread && <CheckCheck size={12 * k} color="#0ea5e9" />}
                      {ch.preview}
                    </span>
                    {unread > 0 && (
                      <span style={{ minWidth: 16 * k, height: 16 * k, padding: `0 ${4 * k}px`, borderRadius: 16 * k, display: "grid", placeItems: "center", background: c.brand2, color: "#fff", fontSize: 9 * k, fontWeight: 700, flexShrink: 0 }}>
                        {unread}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ margin: `0 auto ${8 * k}px`, width: 96 * k, height: 4 * k, borderRadius: 4 * k, background: "rgba(243,243,246,0.2)" }} />
      </div>
    </div>
  );
};

/** Chat bubble used in scenes (generic messaging style, Infera palette). */
export const Bubble: React.FC<{ text: string; from?: string; out?: boolean; kind?: string; width?: number; style?: React.CSSProperties; size?: number }> = ({ text, from, out, kind, width, style, size = 20 }) => (
  <div
    style={{
      width: "max-content",
      maxWidth: width ?? 520,
      borderRadius: out ? "22px 22px 6px 22px" : "22px 22px 22px 6px",
      background: out ? "rgba(46,229,157,0.16)" : c.bgElev,
      boxShadow: `inset 0 0 0 1px ${out ? "rgba(46,229,157,0.25)" : c.border}, 0 20px 40px -20px rgba(0,0,0,0.8)`,
      padding: "13px 18px",
      fontFamily: fonts.sans,
      color: c.fg,
      fontSize: size,
      lineHeight: 1.35,
      ...style,
    }}
  >
    {from && (
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: size * 0.66, color: c.muted, marginBottom: 4, fontWeight: 500 }}>
        {kind && <KindIcon kind={kind} size={size * 0.7} />}
        {from}
      </div>
    )}
    {text}
  </div>
);
