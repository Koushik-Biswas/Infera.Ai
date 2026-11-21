"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownUp,
  ArrowLeft,
  ChevronDown,
  Copy,
  Download,
  FileSpreadsheet,
  FolderClosed,
  GalleryVerticalEnd,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Table as TableIcon,
  Trash2,
  Zap,
} from "lucide-react";
import { useUI } from "@/components/providers";
import { buttonClass } from "@/components/ui/button-class";
import { templates } from "@/lib/app/templates";
import { copyText, downloadCSV, downloadXLSX, tableOf, toCSV, toMarkdown } from "@/lib/app/export";
import type { CellValue, Collection, Field, Row } from "@/lib/app/types";
import { useBlobUrl, useStore } from "../store";
import { Avatar, Chip, chatTime, CollectionIcon, displayValue, Empty, go, IconBtn, inputCls, Menu, MenuItem, Modal, Status, Toggle, type Route } from "../ui";

export function CollectionsView({ route }: { route: Route }) {
  const id = route.path[1];
  return id ? <CollectionDetail key={id} id={id} /> : <CollectionList />;
}

/* ------------------------------------------------------------------ */

function CollectionList() {
  const { collections, rows, createCollection, busy, chats } = useStore();
  const { toast } = useUI();
  const [creating, setCreating] = useState<string | null>(null);

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex h-14 items-center gap-2 px-4 md:px-8">
        <h1 className="flex-1 text-xl font-semibold tracking-tight">Collections</h1>
        <button onClick={() => go("ai?new=collection")} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-medium text-white">
          <Plus className="size-4" /> New
        </button>
      </header>
      <div className="px-4 pb-10 md:px-8">
        {collections.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {collections.map((c) => {
              const rs = rows.filter((r) => r.collectionId === c.id);
              const sf = c.fields.find((f) => f.type === "status");
              const counts = sf ? (sf.options ?? []).map((o) => [o, rs.filter((r) => r.values[sf.key] === o).length] as const).filter(([, n]) => n) : [];
              return (
                <button key={c.id} onClick={() => go(`collections/${c.id}`)} className="surface flex flex-col rounded-2xl p-4 text-left transition hover:border-line-strong">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                      <CollectionIcon icon={c.icon} className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{c.name}</p>
                      <p className="text-xs text-muted">
                        {rs.length} rows · {c.fields.length} fields · updated {chatTime(c.updatedAt)}
                      </p>
                    </div>
                    {busy[c.id] ? (
                      <Loader2 className="size-4 animate-spin text-brand" />
                    ) : (
                      c.autopilot && (
                        <span title="Autopilot on" className="text-amber-500">
                          <Zap className="size-4 fill-current" />
                        </span>
                      )
                    )}
                  </div>
                  {counts.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {counts.slice(0, 4).map(([o, n]) => (
                        <span key={o} className="inline-flex items-center gap-1">
                          <Status value={o} /> <span className="text-xs text-muted">{n}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className={collections.length ? "mt-10" : "mt-2"}>
          <p className="text-sm font-semibold">{collections.length ? "Start from a template" : "Turn your chats into organised data"}</p>
          <p className="mt-1 text-sm text-muted">
            {chats.length ? "Pick one and Infera fills it from your chats in seconds — or describe your own to Infera AI." : "Import chats first, then pick a template."}
          </p>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <button
                key={t.id}
                disabled={Boolean(creating)}
                onClick={async () => {
                  if (!chats.length) return go("chats?import=1");
                  setCreating(t.id);
                  try {
                    const id = await createCollection({ name: t.name, description: t.description, icon: t.icon, template: t.id, fields: t.fields, scope: "all" });
                    toast({ title: `${t.name} created`, body: "Autopilot is on — it updates whenever you import new messages." });
                    go(`collections/${id}`);
                  } finally {
                    setCreating(null);
                  }
                }}
                className="flex items-start gap-3 rounded-2xl border border-line p-3.5 text-left transition hover:border-line-strong hover:bg-elev disabled:opacity-60"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sunken text-fg-soft ring-1 ring-line">
                  {creating === t.id ? <Loader2 className="size-4 animate-spin" /> : <CollectionIcon icon={t.icon} className="size-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t.name}</span>
                  <span className="line-clamp-2 text-xs text-muted">{t.description}</span>
                </span>
              </button>
            ))}
            <button onClick={() => go("ai?new=collection")} className="flex items-start gap-3 rounded-2xl border border-dashed border-line-strong p-3.5 text-left transition hover:bg-elev">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                <Sparkles className="size-4" />
              </span>
              <span>
                <span className="block text-sm font-medium">Describe your own</span>
                <span className="text-xs text-muted">“Track property enquiries with budget, BHK and locality”</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

type Sort = { key: string; dir: 1 | -1 } | null;

function CollectionDetail({ id }: { id: string }) {
  const store = useStore();
  const { collections, rows: allRows, busy, updateCollection, deleteCollection, refreshCollection, addRow, settings, cloudAvailable } = store;
  const { toast } = useUI();
  const col = collections.find((c) => c.id === id);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const rows = useMemo(() => allRows.filter((r) => r.collectionId === id), [allRows, id]);
  const statusField = col?.fields.find((f) => f.type === "status");
  const filtered = useMemo(() => {
    if (!col) return [];
    let list = rows;
    if (q) {
      const t = q.toLowerCase();
      list = list.filter((r) => Object.values(r.values).some((v) => v != null && String(v).toLowerCase().includes(t)));
    }
    if (status && statusField) list = list.filter((r) => r.values[statusField.key] === status);
    const dateField = col.fields.find((f) => f.type === "date");
    const s = sort ?? (dateField ? { key: dateField.key, dir: -1 as const } : null);
    if (s) {
      list = [...list].sort((a, b) => {
        const x = a.values[s.key];
        const y = b.values[s.key];
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * s.dir;
      });
    }
    return list;
  }, [rows, q, status, sort, col, statusField]);

  if (!col)
    return <Empty icon={<FolderClosed className="size-6" />} title="Collection not found" action={<button onClick={() => go("collections")} className={buttonClass("secondary", "md")}>All collections</button>} />;

  const table = () => tableOf(col, filtered, (k, v) => (typeof v === "number" ? v : v));
  const working = busy[col.id];
  const counts = statusField?.options?.map((o) => [o, rows.filter((r) => r.values[statusField.key] === o).length] as const) ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 px-2 py-2 md:px-6">
        <IconBtn label="Back" onClick={() => go("collections")}>
          <ArrowLeft className="size-5" />
        </IconBtn>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
          <CollectionIcon icon={col.icon} className="size-4" />
        </span>
        {renaming ? (
          <input
            autoFocus
            defaultValue={col.name}
            onBlur={(e) => {
              updateCollection(col.id, { name: e.target.value.trim() || col.name });
              setRenaming(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className={`${inputCls} h-8 max-w-56 font-semibold`}
          />
        ) : (
          <button onClick={() => setRenaming(true)} className="truncate text-base font-semibold tracking-tight md:text-lg" title="Rename">
            {col.name}
          </button>
        )}
        <button
          onClick={() => {
            updateCollection(col.id, { autopilot: !col.autopilot });
            toast({ title: col.autopilot ? "Autopilot off" : "Autopilot on", body: col.autopilot ? "This collection won't change on new imports." : "New messages will update this collection automatically." });
          }}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${col.autopilot ? "bg-amber-500/12 text-amber-700 dark:text-amber-300" : "bg-sunken text-muted ring-1 ring-line"}`}
        >
          <Zap className={`size-3 ${col.autopilot ? "fill-current" : ""}`} /> Autopilot {col.autopilot ? "on" : "off"}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => go(`ai?q=${encodeURIComponent(`Summarise ${col.name}`)}`)} className="hidden h-8 items-center gap-1.5 rounded-full bg-brand/10 px-3 text-[13px] font-medium text-brand sm:inline-flex">
            <Sparkles className="size-3.5" /> Ask AI
          </button>
          <Menu
            trigger={(t) => (
              <button onClick={t} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium hover:bg-sunken">
                <Download className="size-3.5" /> Export <ChevronDown className="size-3" />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<FileSpreadsheet />}
                  onClick={() => {
                    close();
                    downloadXLSX(col, table());
                  }}
                  hint=".xlsx"
                >
                  Excel
                </MenuItem>
                <MenuItem
                  icon={<GoogleSheetsIcon />}
                  onClick={async () => {
                    close();
                    await copyText(toCSV(table(), "\t"));
                    window.open("https://sheets.new", "_blank", "noopener");
                    toast({ title: "Copied for Google Sheets", body: "A new sheet is opening — click cell A1 and paste (Ctrl/⌘ + V)." });
                  }}
                >
                  Google Sheets
                </MenuItem>
                <MenuItem
                  icon={<NotionIcon />}
                  onClick={async () => {
                    close();
                    await copyText(toMarkdown(table()));
                    toast({ title: "Copied for Notion", body: "Paste into any Notion page — it becomes a table." });
                  }}
                >
                  Notion
                </MenuItem>
                <MenuItem
                  icon={<Download />}
                  onClick={() => {
                    close();
                    downloadCSV(col, table());
                  }}
                  hint=".csv"
                >
                  CSV
                </MenuItem>
                <MenuItem
                  icon={<Copy />}
                  onClick={async () => {
                    close();
                    await copyText(toCSV(table(), "\t"));
                    toast({ title: "Table copied", body: "Paste into Excel, Sheets or Numbers." });
                  }}
                >
                  Copy table
                </MenuItem>
              </>
            )}
          </Menu>
          <Menu
            trigger={(t) => (
              <IconBtn label="More" onClick={t}>
                <MoreHorizontal className="size-4" />
              </IconBtn>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<RefreshCw />}
                  onClick={() => {
                    close();
                    refreshCollection(col.id);
                  }}
                >
                  Re-scan chats now
                </MenuItem>
                <MenuItem
                  icon={<Pencil />}
                  onClick={() => {
                    close();
                    setRenaming(true);
                  }}
                >
                  Rename
                </MenuItem>
                {cloudAvailable && settings.cloudAI && (
                  <MenuItem
                    icon={<Sparkles />}
                    onClick={() => {
                      close();
                      updateCollection(col.id, { engine: col.engine === "claude" ? "local" : "claude" });
                      setTimeout(() => refreshCollection(col.id), 50);
                    }}
                  >
                    {col.engine === "claude" ? "Use on-device extraction" : "Use Claude for extraction"}
                  </MenuItem>
                )}
                <MenuItem
                  danger
                  icon={<Trash2 />}
                  onClick={async () => {
                    close();
                    if (!confirm(`Delete the “${col.name}” collection? Your chats are not affected.`)) return;
                    await deleteCollection(col.id);
                    go("collections", true);
                  }}
                >
                  Delete collection
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-3 md:px-6">
        <div className="flex rounded-full bg-sunken p-0.5 ring-1 ring-line">
          {(["table", "gallery"] as const).map((v) => (
            <button
              key={v}
              onClick={() => updateCollection(col.id, { view: v })}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition ${col.view === v ? "bg-elev text-brand shadow-sm" : "text-muted"}`}
            >
              {v === "table" ? <TableIcon className="size-3.5" /> : <GalleryVerticalEnd className="size-3.5" />}
              {v === "table" ? "Table" : "Gallery"}
            </button>
          ))}
        </div>
        <div className="flex h-8 min-w-40 flex-1 items-center gap-2 rounded-full bg-sunken px-3 ring-1 ring-line sm:max-w-64">
          <Search className="size-3.5 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${rows.length} rows`} className="h-full flex-1 bg-transparent text-[13px] outline-none" />
        </div>
        <Menu
          trigger={(t) => (
            <IconBtn label="Sort" onClick={t} active={Boolean(sort)}>
              <ArrowDownUp className="size-4" />
            </IconBtn>
          )}
        >
          {(close) => (
            <>
              {col.fields
                .filter((f) => f.type !== "image")
                .map((f) => (
                  <MenuItem
                    key={f.key}
                    onClick={() => {
                      setSort((s) => (s?.key === f.key ? { key: f.key, dir: s.dir === 1 ? -1 : 1 } : { key: f.key, dir: f.type === "date" || f.type === "currency" ? -1 : 1 }));
                      close();
                    }}
                    hint={sort?.key === f.key ? (sort.dir === 1 ? "↑" : "↓") : undefined}
                  >
                    {f.label}
                  </MenuItem>
                ))}
            </>
          )}
        </Menu>
        <button
          onClick={async () => {
            const rid = await addRow(col.id);
            setOpen(rid);
          }}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-full bg-brand px-3.5 text-[13px] font-medium text-white"
        >
          <Plus className="size-3.5" /> Add
        </button>
      </div>

      {counts.some(([, n]) => n) && (
        <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-3 md:px-6">
          <Chip active={!status} onClick={() => setStatus(null)}>
            All · {rows.length}
          </Chip>
          {counts
            .filter(([, n]) => n)
            .map(([o, n]) => (
              <Chip key={o} active={status === o} onClick={() => setStatus(status === o ? null : o)}>
                {o} · {n}
              </Chip>
            ))}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-auto border-t border-line">
        {working && (
          <div className="sticky top-0 left-0 z-20 flex items-center gap-2 bg-brand/8 px-4 py-2 text-[13px] text-brand backdrop-blur">
            <Loader2 className="size-3.5 animate-spin" /> <span className="shimmer-text font-medium">{working}</span>
          </div>
        )}
        {filtered.length === 0 && !working ? (
          <Empty
            icon={<TableIcon className="size-6" />}
            title={rows.length ? "No rows match" : "No rows yet"}
            body={rows.length ? "Try a different search or filter." : "Infera didn't find matching messages yet. Import more chats, or add a row by hand."}
          />
        ) : col.view === "gallery" ? (
          <Gallery col={col} rows={filtered} onOpen={setOpen} />
        ) : (
          <DataTable col={col} rows={filtered} sort={sort} onSort={setSort} onOpen={setOpen} />
        )}
      </div>

      <RowDrawer col={col} rowId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Cell({ f, v, currency }: { f: Field; v: CellValue; currency: string }) {
  if (v == null || v === "") return <span className="text-muted/50">—</span>;
  if (f.type === "status") return <Status value={String(v)} />;
  if (f.type === "image") return <Img id={String(v)} className="size-8 rounded-md" />;
  if (f.type === "url")
    return (
      <a href={String(v).startsWith("http") ? String(v) : `https://${v}`} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className="text-brand hover:underline">
        {String(v).replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}
      </a>
    );
  if (f.type === "currency") return <span className="font-medium tabular-nums">{displayValue(f, v, currency)}</span>;
  return <>{displayValue(f, v, currency)}</>;
}

function Img({ id, className }: { id: string; className: string }) {
  const url = useBlobUrl(id);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={`object-cover ${className}`} />
  ) : (
    <span className={`grid place-items-center bg-sunken ${className}`}>
      <ImageIcon className="size-3.5 text-muted" />
    </span>
  );
}

function DataTable({ col, rows, sort, onSort, onOpen }: { col: Collection; rows: Row[]; sort: Sort; onSort: (s: Sort) => void; onOpen: (id: string) => void }) {
  const { settings } = useStore();
  return (
    <table className="w-full min-w-max border-separate border-spacing-0 text-[13px]">
      <thead>
        <tr>
          <th className="sticky top-0 z-10 w-12 border-b border-line bg-elev px-3 py-2.5 text-left text-[11px] font-medium text-muted">#</th>
          {col.fields.map((f) => (
            <th key={f.key} className="sticky top-0 z-10 border-b border-line bg-elev px-3 py-2.5 text-left font-medium whitespace-nowrap text-muted">
              <button
                onClick={() => onSort(sort?.key === f.key ? { key: f.key, dir: sort.dir === 1 ? -1 : 1 } : { key: f.key, dir: 1 })}
                className="inline-flex items-center gap-1 hover:text-fg"
              >
                {f.label}
                {sort?.key === f.key && <span>{sort.dir === 1 ? "↑" : "↓"}</span>}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} onClick={() => onOpen(r.id)} className="cursor-pointer transition hover:bg-sunken/70">
            <td className="border-b border-line px-3 py-2.5 text-[11px] text-muted tabular-nums">{i + 1}</td>
            {col.fields.map((f, fi) => (
              <td key={f.key} className={`max-w-72 truncate border-b border-line px-3 py-2.5 ${fi === 0 ? "font-medium" : ""}`}>
                <Cell f={f} v={r.values[f.key] ?? null} currency={settings.currency} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Gallery({ col, rows, onOpen }: { col: Collection; rows: Row[]; onOpen: (id: string) => void }) {
  const { settings } = useStore();
  const imgField = col.fields.find((f) => f.type === "image");
  const title = col.fields.find((f) => f.type === "text") ?? col.fields[0];
  const statusF = col.fields.find((f) => f.type === "status");
  const rest = col.fields.filter((f) => f !== title && f !== imgField && f !== statusF).slice(0, 3);
  return (
    <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:p-6 lg:grid-cols-4 2xl:grid-cols-5">
      {rows.map((r) => {
        const img = (imgField && r.values[imgField.key]) || r.imageId;
        return (
          <button key={r.id} onClick={() => onOpen(r.id)} className="surface overflow-hidden rounded-2xl text-left transition hover:border-line-strong">
            {img ? (
              <Img id={String(img)} className="aspect-[4/3] w-full" />
            ) : (
              <div className="grid aspect-[4/3] w-full place-items-center bg-gradient-to-br from-brand/10 to-brand-2/10">
                <CollectionIcon icon={col.icon} className="size-6 text-brand/60" />
              </div>
            )}
            <div className="space-y-1.5 p-3">
              <p className="truncate text-sm font-semibold">{String(r.values[title.key] ?? "Untitled")}</p>
              {statusF && r.values[statusF.key] && <Status value={String(r.values[statusF.key])} />}
              {rest.map((f) =>
                r.values[f.key] != null && r.values[f.key] !== "" ? (
                  <p key={f.key} className="truncate text-xs text-muted">
                    <span className="text-fg-soft">{f.label}:</span> {displayValue(f, r.values[f.key], settings.currency)}
                  </p>
                ) : null,
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RowDrawer({ col, rowId, onClose }: { col: Collection; rowId: string | null; onClose: () => void }) {
  const { rows, updateCell, deleteRows, messageById, chatById, settings } = useStore();
  const row = rows.find((r) => r.id === rowId);
  const sources = (row?.sourceIds ?? []).map((id) => messageById.get(id)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  return (
    <Modal open={Boolean(row)} onClose={onClose} title={row ? String(row.values[(col.fields.find((f) => f.type === "text") ?? col.fields[0]).key] || "New row") : ""} wide>
      {row && (
        <div className="space-y-5 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {col.fields.map((f) => (
              <label key={f.key} className={`block ${f.type === "image" ? "sm:col-span-2" : ""}`}>
                <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-soft">
                  {f.label}
                  {row.edited?.[f.key] && <span className="rounded bg-sunken px-1 text-[10px] text-muted">edited</span>}
                </span>
                <FieldInput f={f} value={row.values[f.key] ?? null} currency={settings.currency} onChange={(v) => updateCell(row.id, f.key, v)} />
              </label>
            ))}
          </div>
          {sources.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">From these messages</p>
              <div className="space-y-2">
                {sources.map((m) => {
                  const chat = chatById.get(m.chatId);
                  return (
                    <button key={m.id} onClick={() => go(`chats/${m.chatId}?m=${m.id}`)} className="flex w-full items-start gap-2.5 rounded-xl border border-line p-3 text-left transition hover:bg-sunken/60">
                      <Avatar name={chat?.name ?? "?"} color={chat?.color} className="size-7 text-[10px]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex justify-between gap-2 text-xs">
                          <span className="font-medium">
                            {chat?.name}
                            {chat?.isGroup && !m.fromMe ? ` · ${m.sender}` : m.fromMe ? " · You" : ""}
                          </span>
                          <span className="text-muted">{chatTime(m.at)}</span>
                        </span>
                        <span className="mt-0.5 block text-[13px] text-fg-soft">
                          {m.attachment ? `📎 ${m.attachment.name} ` : ""}
                          {m.text}
                        </span>
                      </span>
                      <MessageCircle className="mt-1 size-3.5 shrink-0 text-muted" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex justify-between gap-2 border-t border-line pt-4">
            <button
              onClick={async () => {
                await deleteRows([row.id]);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
            >
              <Trash2 className="size-4" /> Delete row
            </button>
            <button onClick={onClose} className={buttonClass("primary", "md")}>
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function FieldInput({ f, value, onChange, currency }: { f: Field; value: CellValue; onChange: (v: CellValue) => void; currency: string }) {
  if (f.type === "image") return value ? <Img id={String(value)} className="max-h-60 w-full rounded-xl" /> : <p className="text-sm text-muted">No photo</p>;
  if (f.type === "status")
    return (
      <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} className={inputCls}>
        <option value="">—</option>
        {(f.options ?? []).map((o) => (
          <option key={o}>{o}</option>
        ))}
        {value && !(f.options ?? []).includes(String(value)) && <option>{String(value)}</option>}
      </select>
    );
  const type = f.type === "date" ? "date" : f.type === "number" || f.type === "currency" ? "number" : f.type === "email" ? "email" : f.type === "url" ? "url" : f.type === "phone" ? "tel" : "text";
  return (
    <div className="relative">
      {f.type === "currency" && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">{currency === "INR" ? "₹" : currency === "USD" ? "$" : currency}</span>}
      <input
        key={String(value)}
        type={type}
        defaultValue={value == null ? "" : String(value)}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const next = raw === "" ? null : type === "number" ? Number(raw) : raw;
          if (next !== value) onChange(next);
        }}
        className={`${inputCls} ${f.type === "currency" ? "pl-7" : ""}`}
      />
    </div>
  );
}

function GoogleSheetsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#0F9D58" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path fill="#87CEAC" d="M14 2v6h6z" />
      <path fill="#fff" d="M7 11h10v7H7zm1.5 1.5v1.25h3v-1.25zm4.5 0v1.25h2.5v-1.25zm-4.5 2.5v1.5h3V15zm4.5 0v1.5h2.5V15z" />
    </svg>
  );
}

function NotionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" className="text-fg" />
      <path d="M8 7.5v9M8 7.5l7 9M15 7.5v9" stroke="var(--bg)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}
