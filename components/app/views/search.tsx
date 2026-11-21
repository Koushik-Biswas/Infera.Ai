"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { FileText, Image as ImageIcon, Link2, MessageCircle, Search as SearchIcon, Sparkles, Table, X } from "lucide-react";
import { escape, searchMessages, timeRange, tokens } from "@/lib/app/assistant";
import type { Message } from "@/lib/app/types";
import { useStore } from "../store";
import { Avatar, chatTime, Chip, CollectionIcon, displayValue, Empty, go, type Route } from "../ui";

type Kind = "all" | "messages" | "document" | "image" | "link" | "rows";
type When = "any" | "today" | "this week" | "this month";

export function SearchView({ route }: { route: Route }) {
  const { messages, chats, collections, rows, chatById, settings } = useStore();
  const [q, setQ] = useState(route.query.get("q") ?? "");
  const [kind, setKind] = useState<Kind>("all");
  const [when, setWhen] = useState<When>("any");
  const [chatId, setChatId] = useState("");
  const dq = useDeferredValue(q);

  useEffect(() => {
    const t = setTimeout(() => go(dq ? `search?q=${encodeURIComponent(dq)}` : "search", true), 400);
    return () => clearTimeout(t);
  }, [dq]);

  const range = when === "any" ? null : timeRange(when);
  const active = Boolean(dq.trim()) || kind !== "all" || when !== "any" || chatId;

  const msgHits = useMemo(() => {
    if (!active || kind === "rows") return [];
    const kinds = kind === "document" ? ["document"] : kind === "image" ? ["image"] : kind === "link" ? ["link"] : undefined;
    return searchMessages(dq, messages, chats, { kinds, chatId: chatId || undefined, from: range?.from, to: range?.to, limit: 120 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, kind, when, chatId, messages, chats, active]);

  const rowHits = useMemo(() => {
    if (!dq.trim() || !(kind === "all" || kind === "rows")) return [];
    const toks = tokens(dq);
    return rows
      .filter((r) => !chatId || r.chatId === chatId)
      .map((r) => {
        const hay = Object.values(r.values).filter((v) => v != null).join(" ").toLowerCase();
        const n = toks.filter((t) => hay.includes(t)).length;
        return { r, n };
      })
      .filter((x) => x.n > 0 && x.n >= Math.ceil(toks.length / 2))
      .sort((a, b) => b.n - a.n)
      .slice(0, 30)
      .map((x) => x.r);
  }, [dq, kind, rows, chatId]);

  const re = useMemo(() => {
    const t = tokens(dq);
    return t.length ? new RegExp(`(${t.map(escape).join("|")})`, "gi") : null;
  }, [dq]);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 px-4 pt-3 md:px-8">
        <h1 className="mb-3 text-xl font-semibold tracking-tight md:hidden">Search</h1>
        <div className="flex h-12 items-center gap-2 rounded-2xl bg-sunken px-4 ring-1 ring-line focus-within:ring-2 focus-within:ring-brand">
          <SearchIcon className="size-4 text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search messages, files, people, amounts, rows…"
            className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
          {q && (
            <button aria-label="Clear" onClick={() => setQ("")}>
              <X className="size-4 text-muted" />
            </button>
          )}
        </div>
        <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {(
            [
              ["all", "All", null],
              ["messages", "Messages", <MessageCircle key="m" className="size-3.5" />],
              ["document", "Documents", <FileText key="d" className="size-3.5" />],
              ["image", "Images", <ImageIcon key="i" className="size-3.5" />],
              ["link", "Links", <Link2 key="l" className="size-3.5" />],
              ["rows", "Collections", <Table key="r" className="size-3.5" />],
            ] as [Kind, string, React.ReactNode][]
          ).map(([k, label, icon]) => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
              {icon}
              {label}
            </Chip>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 pb-3">
          <select value={when} onChange={(e) => setWhen(e.target.value as When)} className="h-8 rounded-full border border-line bg-elev px-3 text-[13px]">
            <option value="any">Any time</option>
            <option value="today">Today</option>
            <option value="this week">This week</option>
            <option value="this month">This month</option>
          </select>
          <select value={chatId} onChange={(e) => setChatId(e.target.value)} className="h-8 max-w-52 rounded-full border border-line bg-elev px-3 text-[13px]">
            <option value="">All chats</option>
            {[...chats]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          {dq.trim() && (
            <button onClick={() => go(`ai?q=${encodeURIComponent(dq)}`)} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-brand/10 px-3 text-[13px] font-medium text-brand">
              <Sparkles className="size-3.5" /> Ask AI instead
            </button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-2 pb-6 md:px-6">
        {!active ? (
          <Empty icon={<SearchIcon className="size-6" />} title="Find anything" body="A lead, a payment, a PDF, a photo — across every chat you've imported." />
        ) : msgHits.length + rowHits.length === 0 ? (
          <Empty icon={<SearchIcon className="size-6" />} title="No results" body="Try fewer words, or ask Infera AI." />
        ) : (
          <>
            {rowHits.length > 0 && (
              <section className="pt-4">
                <p className="px-2 pb-2 text-xs font-medium tracking-wide text-muted uppercase">In collections · {rowHits.length}</p>
                {rowHits.map((r) => {
                  const col = collections.find((c) => c.id === r.collectionId);
                  if (!col) return null;
                  const fields = col.fields.filter((f) => f.type !== "image");
                  return (
                    <button key={r.id} onClick={() => go(`collections/${col.id}`)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-sunken/70">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                        <CollectionIcon icon={col.icon} className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{String(r.values[fields[0].key] ?? "—")}</span>
                        <span className="block truncate text-xs text-muted">
                          {col.name} ·{" "}
                          {fields
                            .slice(1, 4)
                            .map((f) => displayValue(f, r.values[f.key] ?? null, settings.currency))
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </section>
            )}
            {msgHits.length > 0 && (
              <section className="pt-4">
                <p className="px-2 pb-2 text-xs font-medium tracking-wide text-muted uppercase">Messages · {msgHits.length}</p>
                {msgHits.map(({ message: m }) => (
                  <MessageResult key={m.id} m={m} chatName={chatById.get(m.chatId)?.name ?? ""} color={chatById.get(m.chatId)?.color} re={re} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MessageResult({ m, chatName, color, re }: { m: Message; chatName: string; color?: string; re: RegExp | null }) {
  const text = `${m.attachment ? `📎 ${m.attachment.name}  ` : ""}${m.text}`;
  const parts = re ? text.split(re) : [text];
  return (
    <button onClick={() => go(`chats/${m.chatId}?m=${m.id}`)} className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-sunken/70">
      <Avatar name={chatName} color={color} className="size-9 text-xs" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">
            {chatName}
            {m.sender && m.sender !== chatName ? <span className="font-normal text-muted"> · {m.fromMe ? "You" : m.sender}</span> : null}
          </span>
          <span className="shrink-0 text-[11px] text-muted">{chatTime(m.at)}</span>
        </span>
        <span className="line-clamp-2 text-[13px] text-fg-soft">
          {parts.map((p, i) =>
            i % 2 ? (
              <mark key={i} className="rounded bg-brand/15 px-0.5 text-fg">
                {p}
              </mark>
            ) : (
              p
            ),
          )}
        </span>
      </span>
    </button>
  );
}
