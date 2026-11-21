import { CheckCheck, Search, Sparkles, Users } from "lucide-react";
import { chats } from "@/lib/data";
import { Avatar } from "@/components/ui/status-badge";

/** Phone frame showing the Chats list with photos, voice notes and unread counts. */
export function PhoneChats() {
  return (
    <div
      role="img"
      aria-label="Infera on a phone: the Chats list, with photos, voice notes and unread counts"
      className="relative w-[248px] rounded-[42px] bg-[#0b0b10] p-[7px] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.08)_inset] dark:shadow-[0_40px_80px_-30px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.12)_inset]"
    >
      <div className="relative overflow-hidden rounded-[36px] bg-elev text-left">
        {/* status bar */}
        <div className="flex h-9 items-center justify-between px-6 pt-1 text-[10px] font-semibold">
          <span>9:41</span>
          <span className="absolute left-1/2 top-2 h-5 w-20 -translate-x-1/2 rounded-full bg-[#0b0b10]" />
          <span className="flex items-center gap-1">
            <span className="h-2 w-3.5 rounded-[2px] border border-current opacity-80" />
          </span>
        </div>

        <div className="px-4 pb-2">
          <div className="flex items-center justify-between">
            <p className="text-[19px] font-semibold tracking-tight">Chats</p>
            <span className="grid size-7 place-items-center rounded-full bg-brand/12 text-brand">
              <Sparkles className="size-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-sunken px-2.5 py-1.5 text-[10.5px] text-muted">
            <Search className="size-3" /> Ask or search chats
          </div>
          <div className="mt-2 flex gap-1.5 text-[10px]">
            <span className="rounded-full bg-fg px-2 py-0.5 font-medium text-bg">All</span>
            <span className="rounded-full bg-sunken px-2 py-0.5 text-muted">Unread</span>
            <span className="rounded-full bg-sunken px-2 py-0.5 text-muted">Groups</span>
            <span className="rounded-full bg-sunken px-2 py-0.5 text-muted">Tracked</span>
          </div>
        </div>

        <ul className="pb-3">
          {chats.map((c) => (
            <li key={c.name} className="flex items-center gap-2.5 px-4 py-[7px]">
              <div className="relative">
                <Avatar name={c.name} color={c.color} className="size-9 text-[11px]" />
                {c.group && (
                  <span className="absolute -right-0.5 -bottom-0.5 grid size-3.5 place-items-center rounded-full bg-elev ring-1 ring-line">
                    <Users className="size-2 text-muted" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[11.5px] font-semibold">{c.name}</p>
                  <span className={`shrink-0 text-[9.5px] ${c.unread ? "text-brand-2 font-medium" : "text-muted"}`}>{c.time}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-1 truncate text-[10.5px] text-muted">
                    {!c.unread && <CheckCheck className="size-3 shrink-0 text-sky-500" />}
                    <span className="truncate">{c.preview}</span>
                  </p>
                  {c.unread > 0 && (
                    <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-brand-2 px-1 text-[9px] font-bold text-white">
                      {c.unread}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="mx-auto mb-2 h-1 w-24 rounded-full bg-fg/20" />
      </div>
    </div>
  );
}
