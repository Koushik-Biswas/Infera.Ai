"use client";

/**
 * /console/collections — tables that fill themselves from chats.
 *
 * "New collection": describe it in words ("Find all leads from my chats for the
 * last month") → Infera proposes a plan (columns, what feeds it, history range)
 * → Accept creates it and imports matching past messages; or start from a template.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, Plus, Sparkles, Wand2 } from "lucide-react";
import { api, invalidate, useApi } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/errors";
import { categoryLabel, formatNumber } from "@/lib/client/format";
import type { CollectionDTO, CollectionPlanDTO } from "@/lib/shared/types";
import { CollectionIcon } from "@/components/app/ui-base";
import { Page, PageHeader, Card, EmptyState, Callout } from "../kit/surface";
import { CardSkeleton } from "../kit/skeleton";
import { Badge } from "../kit/badges";
import { Button, TextArea, TextField } from "../kit/form";
import { Dialog } from "../kit/overlay";
import { ErrorState, Tabs } from "../kit/misc";
import { useSession } from "../session";

type PlanResult = { plan: CollectionPlanDTO; since: string | null; rangeLabel: string | null; engine: "ai" | "rules" };

export function CollectionsPage() {
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<{ items: CollectionDTO[] }>("/api/v1/collections");
  const [creating, setCreating] = useState(false);
  const items = data?.items ?? [];

  return (
    <Page>
      <PageHeader
        title="Collections"
        description="Spreadsheets that update themselves: agents read your chats and keep every order, lead, payment and follow-up up to date."
        actions={
          can("member") && (
            <Button variant="brand" icon={<Plus />} onClick={() => setCreating(true)}>
              New collection
            </Button>
          )
        }
      />
      {error && !data ? (
        <ErrorState error={error} retry={reload} />
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} lines={3} />)}</div>
      ) : !items.length ? (
        <Card>
          <EmptyState
            icon={<FolderKanban />}
            title="No collections yet"
            body="Describe what you want to track — e.g. “all leads from my chats for the last month” — and Infera builds the table."
            action={can("member") && <Button variant="brand" icon={<Sparkles />} onClick={() => setCreating(true)}>Create from a prompt</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Link key={c.id} href={`/console/collections/${c.id}`} className="surface group rounded-2xl p-4 transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                  <CollectionIcon icon={c.icon} className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-fg group-hover:text-brand">{c.name}</p>
                  <p className="text-sm text-muted">{formatNumber(c.recordCount)} {c.recordCount === 1 ? "record" : "records"}</p>
                </div>
                {!c.autopilot && <Badge tone="muted">Paused</Badge>}
              </div>
              {c.description && <p className="mt-3 line-clamp-2 text-[13px] text-fg-soft">{c.description}</p>}
              <div className="mt-3 flex flex-wrap gap-1">
                {c.routing.categories.slice(0, 3).map((cat) => (
                  <Badge key={cat} tone="neutral">{categoryLabel(cat)}</Badge>
                ))}
                {(c.routing.keywords ?? []).slice(0, 2).map((k) => (
                  <Badge key={k} tone="info">“{k}”</Badge>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
      <NewCollectionDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

function NewCollectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<"prompt" | "template">("prompt");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<PlanResult | null>(null);
  const [name, setName] = useState("");
  const [importHistory, setImportHistory] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const templates = useApi<{ items: CollectionPlanDTO[] }>(open ? "/api/v1/collection-templates" : null, { staleMs: Infinity });

  const close = () => {
    onClose();
    setTimeout(() => {
      setResult(null);
      setPrompt("");
      setName("");
      setErr(null);
    }, 200);
  };

  const plan = async () => {
    setErr(null);
    try {
      const r = await api<PlanResult>("/api/v1/collection-plans", { body: { prompt } });
      setResult(r);
      setName(r.plan.name);
      setImportHistory(true);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  const create = async (p: CollectionPlanDTO, since: string | null) => {
    setErr(null);
    try {
      const made = await api<CollectionDTO & { backfill: { queued: number } | null }>("/api/v1/collections", {
        body: { ...p, name: name.trim() || p.name, ...(since ? { backfillSince: since } : {}) },
      });
      invalidate("/api/v1/collections");
      close();
      router.push(`/console/collections/${made.id}`);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={result ? "Review the plan" : "New collection"}
      description={result ? "Infera will fill this table automatically from your chats." : undefined}
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={() => setResult(null)}>
              Reject
            </Button>
            <Button variant="brand" onClick={() => create(result.plan, importHistory ? (result.since ?? new Date(Date.now() - 30 * 86_400_000).toISOString()) : null)}>
              Accept & create
            </Button>
          </>
        ) : tab === "prompt" ? (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="brand" icon={<Wand2 />} onClick={plan} disabled={prompt.trim().length < 3}>
              Plan it
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={close}>Cancel</Button>
        )
      }
    >
      {err && <Callout tone="danger" className="mb-3">{err}</Callout>}
      {result ? (
        <div className="space-y-4 text-sm">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-fg-soft">Columns</p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {result.plan.fields.map((f) => (
                <li key={f.key} className="flex items-start gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-fg">{f.label}</span>
                    {f.description && <span className="block text-xs text-muted">{f.description}</span>}
                    {f.options?.length ? <span className="mt-1 block text-xs text-fg-soft">{f.options.join(" → ")}</span> : null}
                  </span>
                  <Badge tone="neutral">{f.type}</Badge>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-fg-soft">Fed by messages about</p>
            <div className="flex flex-wrap gap-1">
              {result.plan.routing.categories.map((c) => <Badge key={c} tone="brand">{categoryLabel(c)}</Badge>)}
              {(result.plan.routing.keywords ?? []).map((k) => <Badge key={k} tone="info">“{k}”</Badge>)}
            </div>
          </div>
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={importHistory} onChange={(e) => setImportHistory(e.target.checked)} className="mt-0.5 size-4 accent-brand" />
            <span>
              <span className="font-medium text-fg">Also process past messages {result.rangeLabel ?? "from the last 30 days"}</span>
              <span className="block text-xs text-muted">Only chats with Agents on are read. New messages are added automatically either way.</span>
            </span>
          </label>
          <p className="text-xs text-muted">Planned by {result.engine === "ai" ? "AI" : "Infera's built-in rules"}.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Tabs<"prompt" | "template">
            label="How to create"
            value={tab}
            onChange={setTab}
            items={[
              { id: "prompt", label: "Describe it", icon: <Sparkles className="size-4" /> },
              { id: "template", label: "Templates", icon: <FolderKanban className="size-4" /> },
            ]}
          />
          {tab === "prompt" ? (
            <div className="space-y-3">
              <TextArea
                label="What do you want to track?"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Find all leads from my chats for the last month, with budget and location"
                maxLength={2000}
                autoFocus
              />
              <div className="flex flex-wrap gap-1.5">
                {["Find all leads from my chats for the last month", "Track orders with item, quantity, amount and delivery date", "Pending payments from customers", "Commitments I made this week"].map((s) => (
                  <button key={s} type="button" onClick={() => setPrompt(s)} className="rounded-full border border-line px-2.5 py-1 text-xs text-fg-soft hover:border-brand hover:text-brand">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {(templates.data?.items ?? []).map((t) => (
                <button key={t.template} type="button" onClick={() => void create(t, null)} className="flex items-start gap-3 rounded-xl border border-line p-3 text-left transition-colors hover:border-brand">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><CollectionIcon icon={t.icon} className="size-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">{t.name}</span>
                    <span className="line-clamp-2 block text-xs text-muted">{t.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
