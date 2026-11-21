"use client";

/**
 * /console/collections/[id] — the auto-filled table.
 *
 * Search, status filter and column sorting; export (CSV / Excel / JSON);
 * "Import past messages" (backfill); Autopilot on/off. Clicking a row opens
 * the record: edit values (hand edits are never overwritten by agents) and see
 * the exact messages each value came from. Updates live as agents add rows.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, History, MessageSquareQuote, Trash2 } from "lucide-react";
import { api, invalidate, qs, useApi, useDebounced } from "@/lib/client/api";
import { useCursorList } from "@/lib/client/pagination";
import { errorMessage } from "@/lib/client/errors";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/client/format";
import type { CellValue, CollectionDTO, Field, RecordDTO, RecordSourceDTO } from "@/lib/shared/types";
import { CollectionIcon, money } from "@/components/app/ui-base";
import { Page, PageHeader, Card, EmptyState, Callout } from "../kit/surface";
import { Badge } from "../kit/badges";
import { Button, SearchInput, Select, Switch, TextField } from "../kit/form";
import { ConfirmDialog, Drawer } from "../kit/overlay";
import { DataTable, type Column } from "../kit/table";
import { ErrorState, LoadMore } from "../kit/misc";
import { useSession } from "../session";

function show(f: Field, v: CellValue | undefined, currency: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (f.type === "currency" && typeof v === "number") return money(v, currency);
  if (f.type === "boolean") return v ? "Yes" : "No";
  if (f.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(v).toLocaleDateString();
  return String(v);
}

export function CollectionDetail({ id }: { id: string }) {
  const { can, workspace } = useSession();
  const currency = workspace?.settings?.currency ?? "INR";
  const colPath = `/api/v1/collections/${id}`;
  const col = useApi<CollectionDTO>(colPath);
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("-updatedAt");
  const recs = useCursorList<RecordDTO>(`${colPath}/records${qs({ q: dq || null, status: status || null, sort, limit: 50 })}`);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (col.error && !col.data) return <Page><ErrorState error={col.error} retry={col.reload} /></Page>;
  const c = col.data;
  const fields = (c?.fields ?? []).filter((f) => f.type !== "image");
  const statusField = c?.fields.find((f) => f.type === "status");

  const toggleSort = (key: string) => setSort((s) => (s === `-${key}` ? key : `-${key}`));
  const columns: Column<RecordDTO>[] = [
    ...fields.slice(0, 8).map<Column<RecordDTO>>((f) => ({
      key: f.key,
      header: (
        <button type="button" onClick={() => toggleSort(f.key)} className="inline-flex items-center gap-1 hover:text-fg">
          {f.label}
          {sort.replace(/^-/, "") === f.key && <span aria-hidden>{sort.startsWith("-") ? "↓" : "↑"}</span>}
        </button>
      ),
      cell: (r) =>
        f.type === "status" && r.values[f.key] ? (
          <Badge tone="brand">{String(r.values[f.key])}</Badge>
        ) : (
          <span className={`block max-w-64 truncate ${r.fieldMeta[f.key]?.source === "ai_suggested" ? "italic text-fg-soft" : ""}`}>{show(f, r.values[f.key], currency)}</span>
        ),
      align: f.type === "currency" || f.type === "number" ? "right" : "left",
    })),
    { key: "updated", header: "Updated", cell: (r) => <span className="text-xs whitespace-nowrap text-muted">{relativeTime(r.updatedAt)}</span>, hideBelow: "md" },
  ];

  const backfill = async () => {
    setErr(null);
    setMsg(null);
    try {
      const r = await api<{ queued: number; capped: boolean }>(`${colPath}/backfill`, { body: { since: new Date(Date.now() - 30 * 86_400_000).toISOString() } });
      setMsg(r.queued ? `Processing ${formatNumber(r.queued)} messages from the last 30 days — rows appear as they're found.` : "No past messages to process from the last 30 days.");
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <Page width="wide">
      <PageHeader
        breadcrumbs={[{ label: "Collections", href: "/console/collections" }, { label: c?.name ?? "…" }]}
        title={
          <span className="flex items-center gap-2.5">
            {c && <span className="grid size-9 place-items-center rounded-xl bg-brand/10 text-brand"><CollectionIcon icon={c.icon} className="size-5" /></span>}
            {c?.name ?? "…"}
          </span>
        }
        description={c?.description}
        meta={c && <span>{formatNumber(c.recordCount)} {c.recordCount === 1 ? "record" : "records"}</span>}
        actions={
          c && (
            <>
              {can("member") && (
                <span className="flex items-center gap-2 text-sm text-fg-soft" title="When on, agents add and update rows from new messages">
                  Autopilot
                  <Switch
                    label="Autopilot"
                    checked={c.autopilot}
                    onChange={async (v) => {
                      await api(colPath, { method: "PATCH", body: { autopilot: v } }).catch((e) => setErr(errorMessage(e)));
                      void col.reload();
                    }}
                  />
                </span>
              )}
              {can("member") && (
                <Button size="sm" icon={<History />} onClick={backfill}>
                  Import past messages
                </Button>
              )}
              <a className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium text-fg hover:bg-sunken" href={`${colPath}/export?format=xlsx`}>
                <Download className="size-3.5" /> Excel
              </a>
              <a className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium text-fg hover:bg-sunken" href={`${colPath}/export?format=csv`}>
                CSV
              </a>
            </>
          )
        }
      />
      {msg && <Callout tone="success" className="mb-3">{msg}</Callout>}
      {err && <Callout tone="danger" className="mb-3">{err}</Callout>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search this collection" className="min-w-56 flex-1 sm:max-w-sm" />
        {statusField && (
          <Select size="sm" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "", label: "All statuses" }, ...(statusField.options ?? []).map((o) => ({ value: o, label: o }))]} containerClassName="w-44" />
        )}
      </div>

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={recs.items}
          rowKey={(r) => r.id}
          loading={recs.loading || !c}
          dimmed={recs.isPreviousData}
          onRowClick={(r) => setOpen(r.id)}
          selectedKey={open}
          caption={c?.name}
          empty={<EmptyState compact title={dq || status ? "No matching records" : "No records yet"} body={dq || status ? undefined : "Agents add rows as relevant messages arrive in chats with Agents on. Use “Import past messages” to process history."} />}
        />
      </Card>
      {recs.error && <ErrorState error={recs.error} retry={recs.reload} compact />}
      <LoadMore hasMore={recs.hasMore} loading={recs.loadingMore} onLoadMore={recs.loadMore} error={recs.loadMoreError} />

      {c && <RecordDrawer recordId={open} collection={c} currency={currency} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function RecordDrawer({ recordId, collection, currency, onClose }: { recordId: string | null; collection: CollectionDTO; currency: string; onClose: () => void }) {
  const { can } = useSession();
  const router = useRouter();
  const path = recordId ? `/api/v1/records/${recordId}` : null;
  const rec = useApi<RecordDTO & { sources: RecordSourceDTO[] }>(path);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const r = rec.data;
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    if (!r) return;
    setErr(null);
    try {
      await api(`/api/v1/records/${r.id}`, { method: "PATCH", body: { values: draft, expectedVersion: r.version } });
      setDraft({});
      await rec.reload();
      invalidate(`/api/v1/collections/${collection.id}`);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <Drawer
      open={Boolean(recordId)}
      onClose={() => {
        setDraft({});
        setErr(null);
        onClose();
      }}
      title={collection.name}
      description={r ? `Updated ${relativeTime(r.updatedAt)} · ${r.origin === "pipeline" ? "extracted by agents" : r.origin}` : undefined}
      footer={
        can("member") && r ? (
          <div className="flex w-full items-center gap-2">
            {can("admin") && (
              <Button variant="danger-ghost" size="sm" icon={<Trash2 />} onClick={() => setConfirm(true)}>
                Delete
              </Button>
            )}
            <span className="flex-1" />
            {dirty && <Button variant="ghost" onClick={() => setDraft({})}>Discard</Button>}
            <Button variant="brand" disabled={!dirty} onClick={save}>Save</Button>
          </div>
        ) : undefined
      }
    >
      {err && <Callout tone="danger" className="mb-3">{err}</Callout>}
      {!r ? (
        rec.error ? <ErrorState error={rec.error} retry={rec.reload} compact /> : <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="space-y-3">
            {collection.fields.map((f) => {
              const meta = r.fieldMeta[f.key];
              const current = draft[f.key] ?? (r.values[f.key] === null || r.values[f.key] === undefined ? "" : String(r.values[f.key]));
              return (
                <div key={f.key}>
                  {f.type === "status" ? (
                    <Select label={f.label} value={current} disabled={!can("member")} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} options={[{ value: "", label: "—" }, ...(f.options ?? []).map((o) => ({ value: o, label: o }))]} />
                  ) : (
                    <TextField
                      label={f.label}
                      value={current}
                      disabled={!can("member")}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      hint={f.type === "currency" && typeof r.values[f.key] === "number" ? money(r.values[f.key] as number, currency) : undefined}
                    />
                  )}
                  {meta && meta.source !== "manual" && (
                    <p className="mt-1 text-[11px] text-muted">
                      {meta.source === "ai_suggested" ? "AI suggestion" : meta.source === "extracted" ? "Extracted" : meta.source}
                      {meta.confidence != null ? ` · ${Math.round(meta.confidence * 100)}% confident` : ""}
                      {meta.evidence ? ` · “${meta.evidence.slice(0, 80)}”` : ""}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-fg-soft">
              <MessageSquareQuote className="size-4" /> Source messages
            </p>
            {!r.sources.length ? (
              <p className="text-sm text-muted">Added by hand.</p>
            ) : (
              <ul className="space-y-2">
                {[...new Map(r.sources.filter((s) => s.message).map((s) => [s.messageId, s])).values()].slice(0, 10).map((s) => (
                  <li key={s.messageId}>
                    <button
                      type="button"
                      onClick={() => router.push(`/console/inbox?c=${s.message!.conversationId}`)}
                      className="w-full rounded-xl border border-line p-2.5 text-left text-sm hover:border-brand"
                    >
                      <span className="flex items-center justify-between text-xs text-muted">
                        <span className="font-medium text-fg-soft">{s.message!.senderName}</span>
                        <span>{formatDateTime(s.message!.sentAt)}</span>
                      </span>
                      <span className="mt-1 line-clamp-3 block text-fg">{s.message!.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-muted">
            Hand edits are kept: agents never overwrite a value you changed. <Link href="/console/inbox" className="underline">Open inbox</Link>
          </p>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        danger
        title="Delete this record?"
        body="It disappears from the collection and exports. Admins can restore it later."
        confirmLabel="Delete"
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          if (!r) return;
          await api(`/api/v1/records/${r.id}`, { method: "DELETE" });
          setConfirm(false);
          invalidate(`/api/v1/collections/${collection.id}`);
          onClose();
        }}
      />
    </Drawer>
  );
}
