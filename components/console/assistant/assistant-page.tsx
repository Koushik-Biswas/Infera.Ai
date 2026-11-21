"use client";

/**
 * /console/assistant — ask questions about your chats and collections in plain
 * language ("Who enquired about the red basketball?", "Which payments are
 * pending?", "Summarise today"). Answers cite the messages they come from;
 * AI suggestions are shown apart from facts.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquarePlus, Send, Sparkles } from "lucide-react";
import { api, invalidate, useApi } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/errors";
import { formatDateTime, relativeTime } from "@/lib/client/format";
import type { AssistantAnswerDTO } from "@/lib/shared/types";
import { RichText } from "@/components/app/ui-base";
import { Page, Callout, Spinner, EmptyState } from "../kit/surface";
import { Badge } from "../kit/badges";
import { Button } from "../kit/form";

type Turn = { q: string; a: (AssistantAnswerDTO & { threadId: string }) | null; error?: string };
type ThreadDTO = { id: string; title: string; messages: { role: "user" | "assistant"; text: string; at: string }[] };

const SUGGESTIONS = ["Which payments are pending?", "Summarise today's chats", "Who asked for a price this week?", "What did I promise to deliver?"];

export function AssistantPage() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const threads = useApi<{ items: { id: string; title: string; updatedAt: string }[] }>("/api/v1/assistant/threads");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }), [turns.length, busy]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { q: text, a: null }]);
    try {
      const a = await api<AssistantAnswerDTO & { threadId: string }>("/api/v1/assistant/ask", { body: { question: text, threadId } });
      setThreadId(a.threadId);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
      invalidate("/api/v1/assistant/threads");
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: errorMessage(e) } : x)));
    } finally {
      setBusy(false);
    }
  };

  const openThread = async (id: string) => {
    const t = await api<ThreadDTO>(`/api/v1/assistant/threads/${id}`).catch(() => null);
    if (!t) return;
    setThreadId(t.id);
    const out: Turn[] = [];
    for (let i = 0; i < t.messages.length; i += 2) {
      const u = t.messages[i];
      const a = t.messages[i + 1];
      out.push({ q: u?.text ?? "", a: a ? { answer: a.text, facts: [], suggestions: [], citations: [], engine: "rules", threadId: t.id } : null });
    }
    setTurns(out);
  };

  return (
    <Page width="wide" className="flex gap-6">
      <aside className="hidden w-60 shrink-0 lg:block">
        <Button className="mb-3 w-full" icon={<MessageSquarePlus />} onClick={() => { setThreadId(null); setTurns([]); }}>
          New question
        </Button>
        <p className="mb-1 px-1 text-[11px] font-medium tracking-wider text-muted uppercase">Recent</p>
        <ul className="space-y-0.5">
          {(threads.data?.items ?? []).map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => void openThread(t.id)} className={`w-full truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sunken ${t.id === threadId ? "bg-sunken text-fg" : "text-fg-soft"}`} title={t.title}>
                {t.title}
                <span className="block text-[11px] text-muted">{relativeTime(t.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex min-h-[calc(100dvh-10rem)] min-w-0 flex-1 flex-col">
        <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-fg"><Sparkles className="size-5 text-brand" /> Assistant</h1>
        <p className="mb-5 text-sm text-muted">Ask anything about your chats and collections. Answers cite the messages they come from.</p>

        <div className="flex-1 space-y-6">
          {!turns.length && (
            <EmptyState
              icon={<Sparkles />}
              title="What would you like to know?"
              action={SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void ask(s)} className="rounded-full border border-line px-3 py-1.5 text-sm text-fg-soft hover:border-brand hover:text-brand">
                  {s}
                </button>
              ))}
            />
          )}
          {turns.map((t, i) => (
            <div key={i} className="space-y-3">
              <div className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-br-md bg-brand/12 px-3.5 py-2 text-sm text-fg">{t.q}</p>
              </div>
              {t.error ? (
                <Callout tone="danger">{t.error}</Callout>
              ) : !t.a ? (
                <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Reading your chats…</p>
              ) : (
                <div className="surface rounded-2xl p-4">
                  <div className="text-sm leading-relaxed text-fg"><RichText text={t.a.answer} /></div>
                  {t.a.suggestions.length > 0 && (
                    <div className="mt-3 rounded-xl bg-sunken/60 p-3">
                      <p className="mb-1 text-xs font-medium text-muted">Suggestions (not facts)</p>
                      <ul className="list-disc space-y-0.5 pl-5 text-sm text-fg-soft">{t.a.suggestions.map((s, j) => <li key={j}>{s}</li>)}</ul>
                    </div>
                  )}
                  {t.a.citations.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-1.5 text-xs font-medium text-muted">Sources</p>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {t.a.citations.map((c) => (
                          <li key={c.messageId}>
                            <Link href={`/console/inbox?c=${c.conversationId}`} className="block rounded-xl border border-line p-2.5 text-xs hover:border-brand">
                              <span className="flex justify-between text-muted"><span className="font-medium text-fg-soft">{c.senderName}</span><span>{formatDateTime(c.sentAt)}</span></span>
                              <span className="mt-1 line-clamp-2 block text-[13px] text-fg">{c.text}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="mt-2 text-right"><Badge tone="muted">{t.a.engine === "ai" ? "AI answer" : "Search answer"}</Badge></p>
                </div>
              )}
            </div>
          ))}
          <div ref={end} />
        </div>

        <form
          className="sticky bottom-20 mt-6 md:bottom-4"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
        >
          <div className="surface-lg flex items-end gap-2 rounded-2xl p-2">
            <textarea
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(q);
                }
              }}
              rows={1}
              maxLength={1000}
              placeholder="Ask about your chats…"
              aria-label="Question"
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-fg outline-none"
            />
            <Button type="submit" variant="brand" icon={<Send />} pending={busy} disabled={!q.trim()}>
              Ask
            </Button>
          </div>
        </form>
      </div>
    </Page>
  );
}
