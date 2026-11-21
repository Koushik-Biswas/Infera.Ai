"use client";

/**
 * /console/inbox — synced conversations (WhatsApp and every other channel), live.
 *
 * Left: chats, most recent first (search, unread, archived). Right: the thread
 * (oldest → newest, "load older"), attachments, the per-message category, a
 * reply box, and the chat's "Agents" switch — agents extract records only from
 * chats where it is on. New messages appear without reloading (realtime
 * invalidation of /api/v1/conversations…).
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, Bot, FileText, Inbox, MessagesSquare, Paperclip, Send, Users } from "lucide-react";
import { api, invalidate, qs, setCached, useApi, useDebounced } from "@/lib/client/api";
import { useCursorList } from "@/lib/client/pagination";
import { categoryLabel, formatBytes, formatDateTime, relativeTime } from "@/lib/client/format";
import { errorMessage } from "@/lib/client/errors";
import type { ContactDTO, ConversationDTO, MessageDTO } from "@/lib/shared/types";
import { Page, EmptyState, Callout, Spinner } from "../kit/surface";
import { ChannelIcon } from "../kit/badges";
import { Button, IconButton, SearchInput, Switch } from "../kit/form";
import { LoadMore, Tabs, ErrorState } from "../kit/misc";
import { Skeleton } from "../kit/skeleton";
import { useSession } from "../session";

const REPLY_TYPES = new Set(["whatsapp_web", "whatsapp_cloud", "telegram", "slack", "sms_twilio", "messenger", "instagram", "telegram_user", "email_imap", "linkedin"]);
type Filter = "all" | "unread" | "archived";

export function InboxPage() {
  return (
    <Suspense fallback={<Page width="full"><div className="p-6"><Skeleton className="h-96 w-full" /></div></Page>}>
      <Inbox_ />
    </Suspense>
  );
}

function Inbox_() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("c");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const path = `/api/v1/conversations${qs({ q: dq || null, unread: filter === "unread" ? 1 : null, archived: filter === "archived" ? 1 : null, limit: 50 })}`;
  const list = useCursorList<ConversationDTO>(path, { refreshInterval: 30_000 });

  const open = (id: string | null) => router.replace(id ? `${pathname}?c=${id}` : pathname, { scroll: false });

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-0 md:h-dvh">
      {/* Chat list */}
      <aside className={`flex w-full min-w-0 flex-col border-r border-line md:w-80 lg:w-96 ${selected ? "hidden md:flex" : "flex"}`}>
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-fg">Inbox</h1>
            {list.validating && <Spinner className="size-3.5 text-muted" />}
          </div>
          <SearchInput value={q} onChange={setQ} placeholder="Search chats" label="Search chats" />
          <Tabs<Filter>
            label="Filter chats"
            variant="pills"
            size="sm"
            value={filter}
            onChange={setFilter}
            items={[
              { id: "all", label: "All" },
              { id: "unread", label: "Unread" },
              { id: "archived", label: "Archived" },
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.error && !list.items.length ? (
            <ErrorState error={list.error} retry={list.reload} compact />
          ) : list.loading ? (
            <div className="space-y-3 p-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !list.items.length ? (
            <EmptyState compact icon={<Inbox />} title={dq ? "No chats match" : filter === "all" ? "No chats yet" : "Nothing here"} body={filter === "all" && !dq ? "Connect WhatsApp under Channels — chats appear here as they sync." : undefined} />
          ) : (
            <ul className={list.isPreviousData ? "opacity-60" : ""}>
              {list.items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    aria-current={c.id === selected ? "true" : undefined}
                    className={`flex w-full items-start gap-3 border-b border-line/60 px-3 py-2.5 text-left transition-colors hover:bg-sunken ${c.id === selected ? "bg-brand/8" : ""}`}
                  >
                    <span className="relative mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-sm font-medium text-fg-soft">
                      {c.isGroup ? <Users className="size-4" /> : (c.title || "?").replace(/^\+/, "").slice(0, 1).toUpperCase()}
                      <span className="absolute -right-1 -bottom-1"><ChannelIcon type={c.channelType} size="xs" /></span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`truncate text-sm ${c.unreadCount ? "font-semibold text-fg" : "font-medium text-fg"}`}>{c.title || c.externalId}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-muted">{c.lastMessageAt ? relativeTime(c.lastMessageAt) : ""}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={`truncate text-[13px] ${c.unreadCount ? "text-fg-soft" : "text-muted"}`}>{c.lastMessagePreview || "—"}</span>
                        {!c.agentsEnabled && <Bot className="size-3.5 shrink-0 text-muted opacity-50" aria-label="Agents off" />}
                        {c.unreadCount > 0 && <span className="ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{c.unreadCount > 99 ? "99+" : c.unreadCount}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onLoadMore={list.loadMore} error={list.loadMoreError} />
        </div>
      </aside>

      {/* Thread */}
      <section className={`min-w-0 flex-1 flex-col ${selected ? "flex" : "hidden md:flex"}`}>
        {selected ? (
          <Thread key={selected} id={selected} onBack={() => open(null)} />
        ) : (
          <div className="grid flex-1 place-items-center">
            <EmptyState icon={<MessagesSquare />} title="Select a chat" body="Messages sync live. Turn Agents on for the chats you want turned into records." />
          </div>
        )}
      </section>
    </div>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const { can } = useSession();
  const convPath = `/api/v1/conversations/${id}`;
  const conv = useApi<ConversationDTO & { contact: ContactDTO | null }>(convPath);
  const msgs = useCursorList<MessageDTO>(`${convPath}/messages?limit=40`, { refreshInterval: 20_000 });
  const ordered = useMemo(() => [...msgs.items].sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id)), [msgs.items]);
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = ordered[ordered.length - 1]?.id;
  const [err, setErr] = useState<string | null>(null);

  // Scroll to the newest message when the thread opens or a new one arrives.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  // Opening a chat marks it read.
  const unread = conv.data?.unreadCount ?? 0;
  useEffect(() => {
    if (!unread || !can("member")) return;
    void api<ConversationDTO>(convPath, { method: "PATCH", body: { read: true } })
      .then(() => invalidate("/api/v1/conversations"))
      .catch(() => {});
  }, [unread, convPath, can]);

  const patch = async (body: Record<string, unknown>) => {
    setErr(null);
    try {
      const next = await api<ConversationDTO>(convPath, { method: "PATCH", body });
      setCached<ConversationDTO & { contact: ContactDTO | null }>(convPath, (prev) => ({ ...(prev as ConversationDTO & { contact: ContactDTO | null }), ...next }));
      invalidate("/api/v1/conversations");
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  if (conv.error && !conv.data) return <ErrorState error={conv.error} retry={conv.reload} />;
  const c = conv.data;

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-3 py-2.5 sm:px-4">
        <button type="button" onClick={onBack} className="text-sm text-muted hover:text-fg md:hidden">
          ← Chats
        </button>
        {c ? (
          <>
            <ChannelIcon type={c.channelType} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-fg">{c.title || c.externalId}</p>
              <p className="truncate text-xs text-muted">{c.isGroup ? "Group chat" : [c.contact?.phone, c.contact?.email].filter(Boolean).join(" · ") || c.externalId}</p>
            </div>
            {can("member") && (
              <div className="flex items-center gap-1.5" title="Agents extract orders, leads, payments… from this chat into your collections">
                <Bot className="size-4 text-muted" aria-hidden />
                <span className="hidden text-xs text-fg-soft sm:inline">Agents</span>
                <Switch label="Agents on this chat" checked={c.agentsEnabled} onChange={(v) => void patch({ agentsEnabled: v })} />
              </div>
            )}
            {can("member") && (
              <IconButton label={c.archived ? "Unarchive" : "Archive"} onClick={() => void patch({ archived: !c.archived })}>
                {c.archived ? <ArchiveRestore /> : <Archive />}
              </IconButton>
            )}
          </>
        ) : (
          <Skeleton className="h-9 w-48" />
        )}
      </header>
      {err && <Callout tone="danger" className="m-3">{err}</Callout>}
      {c && !c.agentsEnabled && <p className="border-b border-line bg-sunken/40 px-4 py-1.5 text-xs text-muted">Agents are off for this chat: messages are stored and searchable, but nothing is extracted into collections.</p>}

      <div className="min-h-0 flex-1 overflow-y-auto bg-sunken/30 px-3 py-4 sm:px-6">
        <LoadMore hasMore={msgs.hasMore} loading={msgs.loadingMore} onLoadMore={msgs.loadMore} error={msgs.loadMoreError} label="Load older messages" />
        {msgs.loading ? (
          <div className="space-y-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className={`h-10 ${i % 2 ? "ml-auto w-1/2" : "w-2/3"}`} />)}</div>
        ) : (
          <ol className="space-y-1.5">
            {ordered.map((m, i) => {
              const prev = ordered[i - 1];
              const newDay = !prev || prev.sentAt.slice(0, 10) !== m.sentAt.slice(0, 10);
              return (
                <li key={m.id}>
                  {newDay && <p className="my-3 text-center text-[11px] font-medium text-muted">{new Date(m.sentAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p>}
                  <Bubble m={m} showSender={Boolean(c?.isGroup) && m.direction === "inbound" && prev?.senderName !== m.senderName} />
                </li>
              );
            })}
          </ol>
        )}
        <div ref={bottom} />
      </div>

      {c && REPLY_TYPES.has(c.channelType) && can("member") && <Composer conversationId={id} />}
    </>
  );
}

function Bubble({ m, showSender }: { m: MessageDTO; showSender: boolean }) {
  const out = m.direction === "outbound";
  const cat = m.classification?.category;
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${out ? "rounded-br-md bg-brand/12 text-fg" : "rounded-bl-md bg-elev text-fg ring-1 ring-line"}`}>
        {showSender && <p className="mb-0.5 text-xs font-semibold text-brand">{m.senderName}</p>}
        {m.attachments.map((a, i) =>
          a.fileId && a.mime.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={`/api/v1/files/${a.fileId}`} alt={a.name} loading="lazy" className="mb-1 max-h-72 rounded-lg object-contain" />
          ) : a.fileId && a.mime.startsWith("audio/") ? (
            <audio key={i} src={`/api/v1/files/${a.fileId}`} controls preload="none" className="mb-1 h-9 max-w-full" />
          ) : (
            <a key={i} href={a.fileId ? `/api/v1/files/${a.fileId}` : undefined} target="_blank" rel="noreferrer" className={`mb-1 flex items-center gap-2 rounded-lg bg-sunken px-2 py-1.5 text-xs ${a.fileId ? "hover:underline" : "opacity-70"}`}>
              {a.mime === "application/pdf" ? <FileText className="size-4" /> : <Paperclip className="size-4" />}
              <span className="truncate">{a.name}</span>
              {a.size ? <span className="shrink-0 text-muted">{formatBytes(a.size)}</span> : null}
            </a>
          ),
        )}
        {m.text && <p className="break-words whitespace-pre-wrap">{m.text}</p>}
        <p className="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] text-muted">
          {cat && cat !== "general" && <span className="rounded-full bg-sunken px-1.5 py-px">{categoryLabel(cat)}</span>}
          <time dateTime={m.sentAt} title={formatDateTime(m.sentAt)}>{new Date(m.sentAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>
        </p>
      </div>
    </div>
  );
}

function Composer({ conversationId }: { conversationId: string }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setErr(null);
    try {
      await api(`/api/v1/conversations/${conversationId}/reply`, { body: { text: t } });
      setText("");
      invalidate(`/api/v1/conversations/${conversationId}`);
      invalidate("/api/v1/conversations");
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSending(false);
    }
  };
  return (
    <form
      className="border-t border-line p-2 sm:p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {err && <p className="mb-1.5 text-xs text-rose-700 dark:text-rose-400">{err}</p>}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Type a reply…"
          aria-label="Reply"
          className="max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-line bg-elev px-3.5 py-2 text-sm text-fg outline-none focus:border-brand"
        />
        <Button type="submit" variant="brand" icon={<Send />} pending={sending} disabled={!text.trim()}>
          Send
        </Button>
      </div>
    </form>
  );
}
