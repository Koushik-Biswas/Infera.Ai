import {
  Download,
  Funnel,
  Inbox,
  Layers,
  MessageCircle,
  Plus,
  Search,
  Settings,
  Sparkles,
  Table,
} from "lucide-react";
import { formatDate, formatINR, orders } from "@/lib/data";
import { Avatar, StatusBadge } from "@/components/ui/status-badge";
import { LogoMark } from "@/components/logo";

/** Static desktop app window showing an Orders collection. */
export function DesktopCollection({ reserveRight = false }: { reserveRight?: boolean }) {
  const rows = orders.slice(0, 7);
  return (
    <div className="surface-lg overflow-hidden rounded-[22px] text-left" role="img" aria-label="Infera on desktop: an Orders collection, one row per WhatsApp order with customer, purchase, value and status">
      {/* title bar */}
      <div className="flex h-10 items-center gap-2 border-b border-line bg-sunken/60 px-4">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <div className="mx-auto flex items-center gap-1.5 rounded-md bg-elev px-3 py-0.5 text-[11px] text-muted ring-1 ring-line">
          <LogoMark className="size-3" /> Infera — Orders
        </div>
        <span className="w-12" />
      </div>

      <div className="flex">
        {/* sidebar */}
        <aside className="hidden w-48 shrink-0 flex-col gap-0.5 border-r border-line bg-sunken/40 p-3 text-[12px] sm:flex">
          <div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5">
            <span className="grid size-5 place-items-center rounded-md bg-brand-2/15 text-[10px] font-bold text-brand-2">M</span>
            <span className="font-medium">Menon Traders</span>
          </div>
          <SideItem icon={<Inbox className="size-3.5" />} label="Chats" badge="54" />
          <SideItem icon={<Sparkles className="size-3.5" />} label="Ask Infera" />
          <p className="mt-3 mb-1 px-2 text-[10px] font-medium tracking-wider text-muted uppercase">Collections</p>
          <SideItem icon={<Table className="size-3.5" />} label="Orders" active badge="24" />
          <SideItem icon={<Table className="size-3.5" />} label="Leads" badge="61" />
          <SideItem icon={<Table className="size-3.5" />} label="Payments" />
          <SideItem icon={<Table className="size-3.5" />} label="Vendors" />
          <SideItem icon={<Plus className="size-3.5" />} label="New collection" muted />
          <div className="mt-auto pt-6">
            <SideItem icon={<Layers className="size-3.5" />} label="Agents" />
            <SideItem icon={<Settings className="size-3.5" />} label="Settings" />
          </div>
        </aside>

        {/* main */}
        <div className={`min-w-0 flex-1 ${reserveRight ? "md:pr-40 lg:pr-28" : ""}`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <div>
              <p className="text-[13px] font-semibold">Orders</p>
              <p className="text-[11px] text-muted">Auto-updating · from 9 chats & 3 groups</p>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11px] text-muted md:inline-flex">
                <Search className="size-3" /> Search orders…
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-muted">
                <Funnel className="size-3" /> Status
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-fg px-2 py-1 text-[11px] font-medium text-bg">
                <Download className="size-3" /> Export
              </span>
            </div>
          </div>

          <div className="overflow-hidden">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] tracking-wide text-muted uppercase">
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-2 py-2 font-medium">Purchase</th>
                  <th className="hidden px-2 py-2 text-right font-medium md:table-cell">Value</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="hidden px-4 py-2 text-right font-medium lg:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={`border-b border-line/70 ${i === 0 ? "bg-brand/[0.05]" : ""}`}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Avatar name={r.customer} className="size-5 text-[8.5px]" />
                        <span className="truncate font-medium">{r.customer}</span>
                      </div>
                    </td>
                    <td className="max-w-[9rem] truncate px-2 py-2 text-fg-soft">{r.purchase}</td>
                    <td className="hidden px-2 py-2 text-right font-mono tabular-nums md:table-cell">{formatINR(r.value)}</td>
                    <td className="px-2 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="hidden px-4 py-2 text-right text-muted lg:table-cell">{formatDate(r.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 px-4 py-2.5 text-[11px] text-muted">
            <MessageCircle className="size-3 text-brand-2" />
            Synced 12 seconds ago · 3 new messages processed
          </div>
        </div>
      </div>
    </div>
  );
}

function SideItem({
  icon,
  label,
  active,
  badge,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
        active ? "bg-elev font-medium text-fg ring-1 ring-line" : muted ? "text-muted" : "text-fg-soft"
      }`}
    >
      <span className={active ? "text-brand" : "text-muted"}>{icon}</span>
      {label}
      {badge && <span className="ml-auto text-[10px] text-muted tabular-nums">{badge}</span>}
    </div>
  );
}
