"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Cpu,
  History,
  Loader2,
  MessageCircle,
  PenSquare,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useUI } from "@/components/providers";
import { LogoMark } from "@/components/logo";
import { answerLocally, CREATE_INTENT, planFromPrompt } from "@/lib/app/assistant";
import { cloudAsk, cloudPlan } from "@/lib/app/ai-client";
import { uid } from "@/lib/app/db";
import type { AssistantMsg, Field, Plan, Thread } from "@/lib/app/types";
import { useStore } from "../store";
import { Avatar, chatTime, CollectionIcon, go, IconBtn, Menu, MenuItem, RichText, type Route } from "../ui";

const SUGGESTIONS = [
  "Create a collection of all orders",
  "Analyse my chats and create a collection titled @LeadsAndDeals",
  "Which payments are still pending?",
  "Find the product details PDF",
  "Summarise today's chats",
  "Organise product photos into a catalogue",
];

const TYPE_LABEL: Record<Field["type"], string> = {
  text: "Text",
  number: "Number",
  currency: "Amount",
  status: "Status",
  date: "Date",
  phone: "Phone",
  email: "Email",
  url: "Link",
  location: "Location",
  image: "Image",
};

export function AssistantView({ route }: { route: Route }) {
  const store = useStore();
  const { threads, saveThread, deleteThread, settings, useCloud, chatById } = store;
  const { toast } = useUI();
  const threadId = route.path[1];
  const thread = threads.find((t) => t.id === threadId);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatScope, setChatScope] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const current = useRef<Thread | null>(null);
  current.current = thread ?? null;

  // Deep links: ?new=collection, ?chat=<id>, ?q=<question>
  useEffect(() => {
    const chat = route.query.get("chat");
    if (chat) setChatScope(chat);
    if (route.query.get("new") === "collection") {
      setDraft("Create a collection of ");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    const q = route.query.get("q");
    if (q) {
      go(chat ? `ai?chat=${chat}` : "ai", true);
      send(q, chat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.query.toString()]);

  useEffect(() => {
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }));
  }, [thread?.messages.length, thread?.updatedAt]);

  function commit(t: Thread) {
    current.current = t;
    saveThread(t);
  }

  function patchMsg(id: string, patch: Partial<AssistantMsg>) {
    const t = current.current;
    if (!t) return;
    commit({ ...t, updatedAt: Date.now(), messages: t.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  }

  function push(msg: AssistantMsg) {
    const t = current.current!;
    commit({ ...t, updatedAt: Date.now(), messages: [...t.messages, msg] });
  }

  async function send(text: string, scopeArg?: string | null) {
    const q = text.trim();
    if (!q || busy) return;
    setDraft("");
    setBusy(true);
    const scope = scopeArg !== undefined ? scopeArg : chatScope;
    let t = current.current;
    if (!t) {
      t = { id: uid("t_"), title: q.slice(0, 60), createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      current.current = t;
      go(`ai/${t.id}`, true);
    }
    const scopedChat = scope ? chatById.get(scope) : undefined;
    const userMsg: AssistantMsg = { id: uid("u_"), role: "user", text: scopedChat ? `${q}` : q, at: Date.now() };
    const pending: AssistantMsg = { id: uid("a_"), role: "assistant", text: "", at: Date.now(), steps: ["Understanding your request"], engine: useCloud ? "claude" : "local" };
    commit({ ...t, updatedAt: Date.now(), messages: [...t.messages, userMsg, pending] });

    const ctx = {
      chats: scopedChat ? [scopedChat] : store.chats,
      messages: scopedChat ? store.messages.filter((m) => m.chatId === scopedChat.id) : store.messages,
      collections: store.collections,
      rows: scopedChat ? store.rows.filter((r) => r.chatId === scopedChat.id) : store.rows,
      currency: settings.currency,
    };
    const qWithScope = scopedChat && CREATE_INTENT.test(q) && !q.includes(scopedChat.name) ? `${q} from ${scopedChat.name}` : q;

    try {
      if (useCloud && store.messages.length) {
        if (CREATE_INTENT.test(q)) {
          patchMsg(pending.id, { steps: ["Understanding your request", "Analysing your conversations with Claude"] });
          const plan = await cloudPlan(qWithScope, store.chats, ctx.messages);
          patchMsg(pending.id, {
            steps: ["Understanding your request", "Analysing your conversations", "Thought complete"],
            text: `Based on your conversations, I've prepared a plan for **${plan.name}**. Review the fields, then accept to build it.`,
            plan: { ...plan, status: "pending" },
          });
        } else {
          patchMsg(pending.id, { steps: ["Understanding your request", "Reading relevant messages with Claude"] });
          const res = await cloudAsk(q, ctx);
          patchMsg(pending.id, { steps: ["Understanding your request", "Reading relevant messages", "Thought complete"], text: res.text, citations: res.citations });
        }
      } else {
        await new Promise((r) => setTimeout(r, 350));
        const a = answerLocally(qWithScope, ctx);
        patchMsg(pending.id, {
          steps: [...a.steps, "Thought complete"],
          text: a.text,
          citations: a.citations,
          collectionId: a.collectionId,
          plan: a.plan ? { ...a.plan, status: "pending" } : undefined,
          engine: "local",
        });
      }
    } catch (e) {
      const a = answerLocally(qWithScope, ctx);
      patchMsg(pending.id, {
        steps: [...a.steps, "Thought complete"],
        text: `${a.text}\n\n_(Cloud AI was unavailable — ${e instanceof Error ? e.message : "error"} — so I answered on-device.)_`.replace(/_\((.*)\)_/, "($1)"),
        citations: a.citations,
        collectionId: a.collectionId,
        plan: a.plan ? { ...a.plan, status: "pending" } : undefined,
        engine: "local",
      });
    } finally {
      setBusy(false);
    }
  }

  async function accept(msg: AssistantMsg) {
    if (!msg.plan) return;
    patchMsg(msg.id, { plan: { ...msg.plan, status: "accepted" } });
    setBusy(true);
    try {
      const { status: _s, collectionId: _c, ...plan } = msg.plan;
      const id = await store.createCollection(plan);
      patchMsg(msg.id, { plan: { ...msg.plan, status: "accepted", collectionId: id } });
      push({
        id: uid("a_"),
        role: "assistant",
        at: Date.now(),
        text: `Done! **${plan.name}** is ready and autopilot is on — new messages will keep it up to date.`,
        collectionId: id,
      });
    } catch (e) {
      toast({ tone: "info", title: "Couldn't create the collection", body: e instanceof Error ? e.message : undefined });
      patchMsg(msg.id, { plan: { ...msg.plan, status: "pending" } });
    } finally {
      setBusy(false);
    }
  }

  async function revise(msg: AssistantMsg, change: string) {
    if (!msg.plan) return;
    const plan = msg.plan;
    let next: Plan = { ...plan, fields: [...plan.fields] };
    const lower = change.toLowerCase();
    if (useCloud) {
      try {
        setBusy(true);
        const fields = plan.fields.map((f) => f.label).join(", ");
        next = await cloudPlan(`Collection "${plan.name}" with columns: ${fields}. Change request: ${change}`, store.chats, store.messages);
        next = { ...next, scope: plan.scope };
      } catch {
        /* fall through to local edits below */
      } finally {
        setBusy(false);
      }
    }
    if (next.fields === plan.fields || !useCloud) {
      const rename = change.match(/\b(?:rename|call|name|title)(?: it| this| the collection)?(?: to| as)?\s+["“']?([^"”'\n]{2,40})["”']?$/i);
      if (rename) next.name = rename[1].trim();
      for (const f of plan.fields) {
        if (new RegExp(`\\b(remove|delete|drop|without|no)\\b[^.]*\\b${f.label.toLowerCase()}\\b`).test(lower)) next.fields = next.fields.filter((x) => x.key !== f.key);
      }
      if (/\b(add|include|also|plus|with)\b/.test(lower)) {
        const extra = planFromPrompt(`with ${change}`, store.chats).fields.filter((f) => !next.fields.some((x) => x.key === f.key) && !["name", "status", "date"].includes(f.key));
        if (extra.length) next = { ...next, template: "custom", fields: [...next.fields, ...extra] };
      }
    }
    patchMsg(msg.id, { plan: { ...plan, status: "rejected" } });
    push({ id: uid("u_"), role: "user", text: change, at: Date.now() });
    push({ id: uid("a_"), role: "assistant", at: Date.now(), text: `Updated the plan for **${next.name}**.`, plan: { ...next, status: "pending" }, steps: ["Updating the plan", "Thought complete"] });
  }

  const scopeChat = chatScope ? chatById.get(chatScope) : undefined;
  const name = settings.userName.split(" ")[0];

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 px-3 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold md:text-base">{thread?.title ?? "Infera AI"}</span>
          <span
            className={`hidden items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex ${useCloud ? "bg-brand/10 text-brand" : "bg-sunken text-muted ring-1 ring-line"}`}
            title={useCloud ? "Answers use Claude via your Infera server" : "Answers are computed on this device"}
          >
            {useCloud ? <Sparkles className="size-3" /> : <Cpu className="size-3" />}
            {useCloud ? "Claude" : "On-device"}
          </span>
        </div>
        <Menu
          trigger={(t) => (
            <IconBtn label="History" onClick={t}>
              <History className="size-[18px]" />
            </IconBtn>
          )}
        >
          {(close) => (
            <div className="max-h-80 w-72 overflow-y-auto">
              {threads.length === 0 && <p className="px-3 py-2 text-sm text-muted">No conversations yet.</p>}
              {threads.map((t) => (
                <div key={t.id} className="group flex items-center rounded-xl hover:bg-sunken">
                  <button
                    onClick={() => {
                      close();
                      go(`ai/${t.id}`);
                    }}
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                  >
                    <span className="block truncate text-sm">{t.title}</span>
                    <span className="text-[11px] text-muted">{chatTime(t.updatedAt)}</span>
                  </button>
                  <button aria-label="Delete conversation" onClick={() => deleteThread(t.id)} className="mr-1 rounded-lg p-1.5 text-muted opacity-0 group-hover:opacity-100 hover:text-rose-500">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Menu>
        <IconBtn
          label="New conversation"
          onClick={() => {
            current.current = null;
            setChatScope(null);
            go("ai");
          }}
        >
          <PenSquare className="size-[18px]" />
        </IconBtn>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {!thread || thread.messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-5 py-10 text-center">
            <LogoMark className="size-11" />
            <p className="mt-4 text-xl font-semibold tracking-tight">Hi{name ? ` ${name}` : ""} 👋</p>
            <p className="text-xl text-brand">What can I do for you?</p>
            <p className="mt-3 max-w-md text-sm text-muted">
              Ask about any chat, payment, order or file — or describe a collection and I&apos;ll build it from your conversations.
            </p>
            {store.chats.length === 0 && (
              <button onClick={() => go("chats?import=1")} className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
                <Plus className="size-4" /> Import chats to get started
              </button>
            )}
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line bg-elev px-3.5 py-2 text-left text-[13px] text-fg-soft transition hover:border-line-strong hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:px-6">
            {thread.messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-[14px] text-white shadow-sm">{m.text}</div>
                </div>
              ) : (
                <AssistantBubble key={m.id} m={m} busy={busy} onAccept={() => accept(m)} onReject={() => patchMsg(m.id, { plan: m.plan && { ...m.plan, status: "rejected" } })} onRevise={(c) => revise(m, c)} />
              ),
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 pb-3 md:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="surface mx-auto max-w-3xl rounded-3xl p-2"
        >
          {scopeChat && (
            <div className="mb-1 flex items-center gap-2 px-2 pt-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-xs ring-1 ring-line">
                <MessageCircle className="size-3 text-brand" /> About {scopeChat.name}
                <button type="button" aria-label="Remove chat context" onClick={() => setChatScope(null)}>
                  <X className="size-3 text-muted" />
                </button>
              </span>
            </div>
          )}
          <div className="flex items-end gap-2">
            <IconBtn label="Import chats" onClick={() => go("ai?import=1")}>
              <Plus className="size-5" />
            </IconBtn>
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              placeholder="Ask Infera anything…"
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-muted"
            />
            <button type="submit" aria-label="Send" disabled={!draft.trim() || busy} className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-white transition disabled:opacity-40">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssistantBubble({ m, busy, onAccept, onReject, onRevise }: { m: AssistantMsg; busy: boolean; onAccept: () => void; onReject: () => void; onRevise: (c: string) => void }) {
  const { collections } = useStore();
  const thinking = !m.text && !m.plan;
  const [open, setOpen] = useState(false);
  const col = m.collectionId ? collections.find((c) => c.id === m.collectionId) : undefined;
  return (
    <div className="flex gap-3">
      <LogoMark className="mt-0.5 size-7 shrink-0" />
      <div className="min-w-0 flex-1 space-y-3 text-[14px] leading-relaxed">
        {m.steps && m.steps.length > 0 && (
          <div>
            <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
              {thinking ? <Loader2 className="size-3.5 animate-spin text-brand" /> : <Check className="size-3.5 text-brand-2" />}
              <span className={thinking ? "shimmer-text" : ""}>{thinking ? `${m.steps[m.steps.length - 1]}…` : "Thought complete"}</span>
              <ChevronDown className={`size-3.5 transition ${open ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence>
              {open && (
                <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-1 space-y-0.5 overflow-hidden border-l border-line pl-3 text-xs text-muted">
                  {m.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                  <li>{m.engine === "claude" ? "Answered with Claude" : "Answered on this device"}</li>
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )}
        {m.text && <RichText text={m.text} />}
        {m.plan && <PlanCard plan={m.plan} busy={busy} onAccept={onAccept} onReject={onReject} onRevise={onRevise} />}
        {m.citations && m.citations.length > 0 && <Citations ids={m.citations} />}
        {col && (
          <button onClick={() => go(`collections/${col.id}`)} className="inline-flex items-center gap-2 rounded-full border border-line bg-elev px-3.5 py-2 text-[13px] font-medium transition hover:border-line-strong">
            <CollectionIcon icon={col.icon} className="size-4 text-brand" /> Open {col.name} <ArrowRight className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function Citations({ ids }: { ids: string[] }) {
  const { messageById, chatById } = useStore();
  const msgs = ids.map((id) => messageById.get(id)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (!msgs.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {msgs.slice(0, 8).map((m) => {
        const chat = chatById.get(m.chatId);
        return (
          <button key={m.id} onClick={() => go(`chats/${m.chatId}?m=${m.id}`)} className="flex items-start gap-2.5 rounded-2xl border border-line bg-elev p-3 text-left transition hover:border-line-strong">
            <Avatar name={chat?.name ?? "?"} color={chat?.color} className="size-7 text-[10px]" />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{chat?.name}</span>
                <span className="shrink-0 text-[10px] text-muted">{chatTime(m.at)}</span>
              </span>
              <span className="line-clamp-2 text-xs text-muted">
                {m.fromMe ? "You: " : chat?.isGroup ? `${m.sender}: ` : ""}
                {m.attachment ? `📎 ${m.attachment.name} ` : ""}
                {m.text}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PlanCard({ plan, busy, onAccept, onReject, onRevise }: { plan: NonNullable<AssistantMsg["plan"]>; busy: boolean; onAccept: () => void; onReject: () => void; onRevise: (c: string) => void }) {
  const { chatById } = useStore();
  const [change, setChange] = useState("");
  const scope = useMemo(() => (plan.scope === "all" ? "All chats" : plan.scope.map((id) => chatById.get(id)?.name).filter(Boolean).join(", ")), [plan.scope, chatById]);
  const pending = plan.status === "pending";
  return (
    <div className={`overflow-hidden rounded-2xl border bg-elev ${pending ? "border-line-strong" : "border-line opacity-80"}`}>
      <div className="border-b border-line px-4 py-3">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">Collection creation plan</p>
        <div className="mt-2 flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
            <CollectionIcon icon={plan.icon} className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">{plan.name}</p>
            <p className="text-xs text-muted">
              {plan.fields.length} fields · {scope}
            </p>
            <p className="mt-1 text-[13px] text-fg-soft">{plan.description}</p>
          </div>
        </div>
      </div>
      <ul className="max-h-64 divide-y divide-line overflow-y-auto">
        {plan.fields.map((f) => (
          <li key={f.key} className="px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-medium">{f.label}</span>
              <span className="text-[11px] text-muted">{TYPE_LABEL[f.type]}</span>
            </div>
            <p className="text-xs text-muted">
              {f.description}
              {f.options?.length ? ` (${f.options.join(" → ")})` : ""}
            </p>
          </li>
        ))}
      </ul>
      {pending ? (
        <>
          <div className="flex items-center justify-between gap-3 border-t border-line bg-sunken/50 px-4 py-2.5">
            <span className="text-[13px] font-medium">Confirm collection plan</span>
            <div className="flex gap-2">
              <button onClick={onReject} disabled={busy} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-brand hover:bg-brand/10">
                Reject
              </button>
              <button onClick={onAccept} disabled={busy} className="rounded-full bg-brand px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">
                Accept
              </button>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (change.trim()) onRevise(change.trim());
              setChange("");
            }}
            className="flex items-center gap-2 border-t border-line px-3 py-2"
          >
            <input value={change} onChange={(e) => setChange(e.target.value)} placeholder="Describe changes to this plan… e.g. “add colour and size”" className="h-8 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" />
            <button type="submit" aria-label="Update plan" disabled={!change.trim()} className="grid size-7 place-items-center rounded-full bg-fg/80 text-bg disabled:opacity-30">
              <ArrowUp className="size-3.5" />
            </button>
          </form>
        </>
      ) : (
        <p className="border-t border-line px-4 py-2.5 text-[13px] text-muted">{plan.status === "accepted" ? (plan.collectionId ? "✓ Accepted — collection created" : "Creating collection…") : "Plan dismissed"}</p>
      )}
    </div>
  );
}
