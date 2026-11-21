"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  AudioLines,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderPlus,
  Image as ImageIcon,
  Link2,
  MessageCircle,
  MoreVertical,
  Pin,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  User,
  Users,
  Video,
  X,
} from "lucide-react";
import { useUI } from "@/components/providers";
import { useInstall } from "@/components/install";
import { buttonClass } from "@/components/ui/button-class";
import { findUrls } from "@/lib/app/extract";
import type { Chat, Message } from "@/lib/app/types";
import { openBlob, useBlobUrl, useStore } from "../store";
import { Avatar, bytes, Chip, chatTime, clockTime, CollectionIcon, dayLabel, Empty, go, IconBtn, Menu, MenuItem, type Route } from "../ui";

type Filter = "all" | "unread" | "groups" | "document" | "image" | "link" | "contact";

export function ChatsView({ route }: { route: Route }) {
  const chatId = route.path[1];
  return (
    <div className="flex h-full">
      <div className={`flex min-w-0 flex-col border-r border-line md:w-[360px] md:shrink-0 ${chatId ? "hidden md:flex" : "flex flex-1"}`}>
        <ChatList activeId={chatId} />
      </div>
      <div className={`min-w-0 flex-1 ${chatId ? "flex" : "hidden md:flex"}`}>
        {chatId ? <ChatThread key={chatId} chatId={chatId} focus={route.query.get("m")} /> : <NoChat />}
      </div>
    </div>
  );
}

function NoChat() {
  return (
    <div className="grid w-full place-items-center bg-sunken/40">
      <Empty icon={<MessageCircle className="size-6" />} title="Pick a chat" body="Every message, photo, PDF and voice note — searchable and ready to turn into data." />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function GettingStarted() {
  const { chats, collections, settings, updateSettings } = useStore();
  const { standalone, installed, install } = useInstall();
  if (settings.dismissedChecklist) return null;
  const steps = [
    { done: chats.length > 0, label: "Import your WhatsApp chats", action: () => go("chats?import=1") },
    { done: collections.length > 0, label: "Create your first collection", action: () => go("ai?new=collection") },
    { done: standalone || installed, label: "Install Infera on this device", action: () => install() },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <div className="mx-3 mb-2 rounded-2xl border border-line bg-elev p-3">
      <div className="flex items-center gap-3">
        <span className="relative grid size-10 place-items-center">
          <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border-strong)" strokeWidth="3" />
            <circle cx="18" cy="18" r="15" fill="none" stroke="var(--brand)" strokeWidth="3" strokeDasharray={`${(done / steps.length) * 94.2} 94.2`} strokeLinecap="round" />
          </svg>
          <span className="text-[11px] font-semibold">
            {done}/{steps.length}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Getting started</p>
          <p className="text-xs text-muted">Let&apos;s finish setting up Infera</p>
        </div>
        <IconBtn label="Dismiss" onClick={() => updateSettings({ dismissedChecklist: true })}>
          <X className="size-4" />
        </IconBtn>
      </div>
      <div className="mt-2 space-y-0.5">
        {steps.map((s) => (
          <button key={s.label} onClick={s.action} disabled={s.done} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition enabled:hover:bg-sunken">
            <span className={`grid size-4 place-items-center rounded-full ${s.done ? "bg-brand-2 text-white" : "ring-1 ring-line-strong"}`}>{s.done && <Check className="size-3" />}</span>
            <span className={s.done ? "text-muted line-through" : ""}>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const kindIcon = (m: Message) =>
  m.kind === "image" ? (
    <ImageIcon className="size-3.5" />
  ) : m.kind === "document" ? (
    <FileText className="size-3.5" />
  ) : m.kind === "audio" ? (
    <AudioLines className="size-3.5" />
  ) : m.kind === "video" ? (
    <Video className="size-3.5" />
  ) : m.kind === "contact" ? (
    <User className="size-3.5" />
  ) : null;

function ChatList({ activeId }: { activeId?: string }) {
  const { chats, messages, chatById } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);

  const sorted = useMemo(
    () =>
      [...chats]
        .filter((c) => (filter === "unread" ? c.unread > 0 : filter === "groups" ? c.isGroup : true))
        .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.preview.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.lastAt - a.lastAt),
    [chats, filter, q],
  );

  const media = useMemo(() => {
    if (!["document", "image", "link", "contact"].includes(filter)) return [];
    return messages
      .filter((m) => (filter === "link" ? findUrls(m.text).length > 0 : m.kind === filter))
      .filter((m) => !q || `${m.text} ${m.attachment?.name ?? ""} ${chatById.get(m.chatId)?.name}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.at - a.at);
  }, [messages, filter, q, chatById]);

  const isMedia = ["document", "image", "link", "contact"].includes(filter);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        {searching ? (
          <div className="flex flex-1 items-center gap-2 rounded-full bg-sunken px-3 ring-1 ring-line">
            <Search className="size-4 text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" className="h-9 flex-1 bg-transparent text-sm outline-none" />
            <button
              onClick={() => {
                setQ("");
                setSearching(false);
              }}
              aria-label="Close search"
            >
              <X className="size-4 text-muted" />
            </button>
          </div>
        ) : (
          <>
            <h1 className="flex-1 text-xl font-semibold tracking-tight">Chats</h1>
            <IconBtn label="Search chats" onClick={() => setSearching(true)}>
              <Search className="size-[18px]" />
            </IconBtn>
            <IconBtn label="Import WhatsApp chats" onClick={() => go("chats?import=1")}>
              <Plus className="size-5" />
            </IconBtn>
          </>
        )}
      </header>
      <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-3">
        {(
          [
            ["all", "All", null],
            ["unread", "Unread", null],
            ["groups", "Groups", <Users key="g" className="size-3.5" />],
            ["document", "Documents", <FileText key="d" className="size-3.5" />],
            ["image", "Images", <ImageIcon key="i" className="size-3.5" />],
            ["link", "Links", <Link2 key="l" className="size-3.5" />],
            ["contact", "Contacts", <User key="c" className="size-3.5" />],
          ] as [Filter, string, React.ReactNode][]
        ).map(([id, label, icon]) => (
          <Chip key={id} active={filter === id} onClick={() => setFilter(id)}>
            {icon}
            {label}
          </Chip>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {!isMedia && <GettingStarted />}
        {chats.length === 0 ? (
          <Empty
            icon={<MessageCircle className="size-6" />}
            title="No chats yet"
            body="Export a chat from WhatsApp and import it — or load the sample workspace to explore."
            action={
              <button onClick={() => go("chats?import=1")} className={buttonClass("brand", "md")}>
                <Plus className="size-4" /> Import chats
              </button>
            }
          />
        ) : isMedia ? (
          <MediaList items={media} kind={filter} />
        ) : (
          sorted.map((c) => <ChatRow key={c.id} chat={c} active={c.id === activeId} />)
        )}
        {!isMedia && chats.length > 0 && sorted.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">No chats match.</p>}
      </div>
    </>
  );
}

function ChatRow({ chat, active }: { chat: Chat; active: boolean }) {
  return (
    <button
      onClick={() => go(`chats/${chat.id}`)}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${active ? "bg-brand/8" : "hover:bg-sunken/70"}`}
    >
      <Avatar name={chat.name} color={chat.color} />
      <span className="min-w-0 flex-1 border-b border-line pb-2.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-medium">{chat.name}</span>
          <span className={`shrink-0 text-[11px] ${chat.unread ? "font-medium text-brand" : "text-muted"}`}>{chatTime(chat.lastAt)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="truncate text-[13px] text-muted">{chat.preview}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {chat.pinned && <Pin className="size-3 text-muted" />}
            {chat.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{chat.unread}</span>}
          </span>
        </span>
      </span>
    </button>
  );
}

function MediaList({ items, kind }: { items: Message[]; kind: Filter }) {
  const { chatById } = useStore();
  if (!items.length) return <p className="px-4 py-10 text-center text-sm text-muted">Nothing here yet.</p>;
  if (kind === "image")
    return (
      <div className="grid grid-cols-3 gap-1 px-3">
        {items.map((m) => (
          <Thumb key={m.id} m={m} onClick={() => go(`chats/${m.chatId}?m=${m.id}`)} />
        ))}
      </div>
    );
  return (
    <div className="px-2">
      {items.map((m) => (
        <button key={m.id} onClick={() => go(`chats/${m.chatId}?m=${m.id}`)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-sunken/70">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sunken text-muted ring-1 ring-line">
            {kind === "link" ? <Link2 className="size-4" /> : kind === "contact" ? <User className="size-4" /> : <FileText className="size-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{kind === "link" ? findUrls(m.text)[0] : (m.attachment?.name ?? "Attachment")}</span>
            <span className="block truncate text-xs text-muted">
              {chatById.get(m.chatId)?.name} · {m.fromMe ? "You" : m.sender} · {chatTime(m.at)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Thumb({ m, onClick }: { m: Message; onClick: () => void }) {
  const url = useBlobUrl(m.attachment?.id);
  return (
    <button onClick={onClick} className="relative aspect-square overflow-hidden rounded-lg bg-sunken ring-1 ring-line">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={m.text || m.attachment?.name || "Photo"} className="size-full object-cover" />
      ) : (
        <ImageIcon className="m-auto size-5 text-muted" />
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */

const PAGE = 300;

function ChatThread({ chatId, focus }: { chatId: string; focus: string | null }) {
  const { chatById, messages, markRead, togglePin, deleteChat, collections, addMessageToCollection } = useStore();
  const { toast } = useUI();
  const chat = chatById.get(chatId);
  const list = useMemo(() => messages.filter((m) => m.chatId === chatId), [messages, chatId]);
  const [limit, setLimit] = useState(PAGE);
  const [ask, setAsk] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    markRead(chatId);
  }, [chatId, markRead]);

  useEffect(() => {
    if (focus) {
      const idx = list.findIndex((m) => m.id === focus);
      if (idx >= 0 && list.length - idx > limit) setLimit(list.length - idx + 20);
      requestAnimationFrame(() => document.getElementById(`msg-${focus}`)?.scrollIntoView({ block: "center" }));
    } else {
      requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, list.length]);

  if (!chat) return <Empty icon={<MessageCircle className="size-6" />} title="Chat not found" action={<button onClick={() => go("chats")} className={buttonClass("secondary", "md")}>Back to chats</button>} />;

  const shown = list.slice(-limit);
  const phone = chat.name.replace(/[^\d+]/g, "");
  const waLink = phone.replace(/\D/g, "").length >= 10 ? `https://wa.me/${phone.replace(/\D/g, "")}` : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2 md:px-4">
        <IconBtn label="Back" onClick={() => go("chats")} className="md:hidden">
          <ArrowLeft className="size-5" />
        </IconBtn>
        <Avatar name={chat.name} color={chat.color} className="size-9 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{chat.name}</p>
          <p className="truncate text-xs text-muted">
            {chat.isGroup ? `${chat.participants.length + 1} members` : "Chat"} · {list.length.toLocaleString()} messages
          </p>
        </div>
        <button onClick={() => go(`ai?chat=${chat.id}`)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand/10 px-3 text-[13px] font-medium text-brand transition hover:bg-brand/15">
          <Sparkles className="size-3.5" /> Ask AI
        </button>
        <Menu
          trigger={(t) => (
            <IconBtn label="Chat options" onClick={t}>
              <MoreVertical className="size-4" />
            </IconBtn>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon={<Pin />}
                onClick={() => {
                  togglePin(chat.id);
                  close();
                }}
              >
                {chat.pinned ? "Unpin chat" : "Pin chat"}
              </MenuItem>
              {waLink && (
                <MenuItem icon={<ExternalLink />} onClick={() => window.open(waLink, "_blank", "noopener")}>
                  Open in WhatsApp
                </MenuItem>
              )}
              <MenuItem icon={<Plus />} onClick={() => go(`chats/${chat.id}?import=1&into=${encodeURIComponent(chat.id)}`)} hint="new messages">
                Re-import chat
              </MenuItem>
              <MenuItem
                danger
                icon={<Trash2 />}
                onClick={async () => {
                  close();
                  if (!confirm(`Delete “${chat.name}” and its media from this device?`)) return;
                  await deleteChat(chat.id);
                  toast({ title: "Chat deleted" });
                  go("chats", true);
                }}
              >
                Delete chat
              </MenuItem>
            </>
          )}
        </Menu>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-sunken/40 px-3 py-4 md:px-8">
        {list.length > limit && (
          <div className="mb-3 text-center">
            <button onClick={() => setLimit((l) => l + PAGE)} className={buttonClass("secondary", "sm")}>
              Load earlier messages
            </button>
          </div>
        )}
        {shown.map((m, i) => {
          const prev = shown[i - 1];
          const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-3 text-center">
                  <span className="rounded-full bg-elev px-3 py-1 text-[11px] font-medium text-muted ring-1 ring-line">{dayLabel(m.at)}</span>
                </div>
              )}
              <Bubble
                m={m}
                group={chat.isGroup}
                showSender={chat.isGroup && !m.fromMe && (!prev || prev.sender !== m.sender || newDay)}
                focused={m.id === focus}
                collections={collections.map((c) => ({ id: c.id, name: c.name, icon: c.icon }))}
                onAdd={async (colId) => {
                  await addMessageToCollection(m.id, colId);
                  const col = collections.find((c) => c.id === colId);
                  toast({ title: `Added to ${col?.name}`, body: "Open the collection to review the new row." });
                }}
              />
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ask.trim()) return;
          go(`ai?chat=${chat.id}&q=${encodeURIComponent(ask.trim())}`);
        }}
        className="flex shrink-0 items-center gap-2 border-t border-line bg-elev px-3 py-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)]"
      >
        <Sparkles className="size-4 shrink-0 text-brand" />
        <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={`Ask about ${chat.name}… e.g. “what did they order?”`} className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
        <button type="submit" aria-label="Ask" className="grid size-9 place-items-center rounded-full bg-brand text-white disabled:opacity-40" disabled={!ask.trim()}>
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(\bhttps?:\/\/[^\s<>()"']+|\bwww\.[^\s<>()"']+)/gi);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <a key={i} href={p.startsWith("http") ? p : `https://${p}`} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand underline underline-offset-2">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Bubble({
  m,
  showSender,
  focused,
  collections,
  onAdd,
}: {
  m: Message;
  group: boolean;
  showSender: boolean;
  focused: boolean;
  collections: { id: string; name: string; icon: string }[];
  onAdd: (collectionId: string) => void;
}) {
  const { toast } = useUI();
  if (m.kind === "system")
    return (
      <div className="my-2 text-center">
        <span className="rounded-lg bg-amber-500/10 px-3 py-1 text-[11px] text-amber-800 dark:text-amber-300">{m.text}</span>
      </div>
    );
  const hue = [...m.sender].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div id={`msg-${m.id}`} className={`group my-1 flex items-end gap-1.5 ${m.fromMe ? "flex-row-reverse" : ""}`}>
      <div
        className={`relative max-w-[85%] rounded-2xl px-3 py-2 text-[14px] leading-snug shadow-sm ring-1 md:max-w-[65%] ${
          m.fromMe ? "rounded-br-md bg-brand/12 ring-brand/15" : "rounded-bl-md bg-elev ring-line"
        } ${focused ? "ring-2 ring-brand" : ""}`}
      >
        {showSender && (
          <p className="mb-0.5 text-xs font-semibold" style={{ color: `hsl(${hue} 55% 45%)` }}>
            {m.sender}
          </p>
        )}
        {m.attachment && <AttachmentView m={m} />}
        {m.kind === "deleted" ? <p className="text-muted italic">This message was deleted</p> : m.text && <p className="break-words whitespace-pre-wrap"><Linkified text={m.text} /></p>}
        <p className="mt-0.5 text-right text-[10px] text-muted">{clockTime(m.at)}</p>
      </div>
      <div className="mb-1 flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        <Menu
          align={m.fromMe ? "right" : "left"}
          trigger={(t) => (
            <button onClick={t} aria-label="Message actions" className="rounded-full p-1.5 text-muted hover:bg-elev hover:text-fg">
              <MoreVertical className="size-3.5" />
            </button>
          )}
        >
          {(close) => (
            <>
              <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Add to collection</p>
              {collections.length === 0 && (
                <MenuItem icon={<FolderPlus />} onClick={() => go("ai?new=collection")}>
                  Create a collection first
                </MenuItem>
              )}
              {collections.map((c) => (
                <MenuItem
                  key={c.id}
                  icon={<CollectionIcon icon={c.icon} />}
                  onClick={() => {
                    close();
                    onAdd(c.id);
                  }}
                >
                  {c.name}
                </MenuItem>
              ))}
              <div className="my-1 border-t border-line" />
              <MenuItem
                icon={<Copy />}
                onClick={async () => {
                  close();
                  await navigator.clipboard?.writeText(m.text);
                  toast({ title: "Copied" });
                }}
              >
                Copy text
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </div>
  );
}

function AttachmentView({ m }: { m: Message }) {
  const url = useBlobUrl(m.kind === "image" || m.kind === "audio" || m.kind === "video" ? m.attachment?.id : null);
  const a = m.attachment!;
  if (m.kind === "image" && a.id)
    return url ? (
      <button onClick={() => openBlob(a.id!, a.name)} className="-mx-1 mb-1 block overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={m.text || a.name} className="max-h-72 w-full max-w-xs object-cover" />
      </button>
    ) : (
      <div className="mb-1 h-40 w-56 animate-pulse rounded-xl bg-sunken" />
    );
  if (m.kind === "audio" && url) return <audio controls src={url} className="mb-1 h-10 max-w-60" />;
  if (m.kind === "video" && url) return <video controls src={url} className="mb-1 max-h-72 max-w-xs rounded-xl" />;
  return (
    <div className="mb-1 flex min-w-52 items-center gap-3 rounded-xl bg-sunken/80 p-2.5 ring-1 ring-line">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-rose-500/12 text-[10px] font-bold text-rose-600 uppercase">
        {kindIcon(m) ?? null}
        {!kindIcon(m) && (a.name.split(".").pop() ?? "file").slice(0, 4)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{a.name}</span>
        <span className="block text-[11px] text-muted">{a.id ? `${bytes(a.size)} · ${a.name.split(".").pop()?.toUpperCase()}` : "Not included in the export"}</span>
      </span>
      {a.id && (
        <span className="flex gap-0.5">
          <button onClick={() => openBlob(a.id!, a.name)} aria-label="Open" className="rounded-full p-1.5 text-muted hover:bg-elev hover:text-fg">
            <ExternalLink className="size-3.5" />
          </button>
          <button onClick={() => openBlob(a.id!, a.name, true)} aria-label="Download" className="rounded-full p-1.5 text-muted hover:bg-elev hover:text-fg">
            <Download className="size-3.5" />
          </button>
        </span>
      )}
    </div>
  );
}
