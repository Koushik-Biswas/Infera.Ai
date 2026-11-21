"use client";

/**
 * /console/settings/webhooks — outbound webhook endpoints: create (secret shown once), edit, enable/disable,
 * rotate secret, send a test ping, delivery log drawer, delete. Admin only.
 */
import { useState, type FormEvent } from "react";
import { Ellipsis, History, Pencil, Plus, RefreshCw, RotateCw, Send, Trash2, TriangleAlert, Webhook } from "lucide-react";
import { useUI } from "@/components/providers";
import { api, invalidate, setCached, useApi } from "@/lib/client/api";
import { useCursorList } from "@/lib/client/pagination";
import { errorMessage, fieldErrors, isNotFound } from "@/lib/client/errors";
import { DOMAIN_EVENT_DESCRIPTIONS } from "@/lib/client/format";
import { DOMAIN_EVENT_TYPES, type DomainEventType, type WebhookDeliveryDTO, type WebhookEndpointDTO } from "@/lib/shared/types";
import { useSession } from "../session";
import { Card, Callout, EmptyState } from "../kit/surface";
import { Badge } from "../kit/badges";
import { Button, Checkbox, IconButton, Switch, TextField } from "../kit/form";
import { ConfirmDialog, Dialog, Drawer, Menu, MenuItem, MenuSeparator } from "../kit/overlay";
import { DataTable } from "../kit/table";
import { CopyButton, ErrorState, LoadMore, TimeAgo } from "../kit/misc";
import { WEBHOOKS_PATH } from "./frame";

type Endpoints = { items: WebhookEndpointDTO[]; nextCursor?: string | null };
const endpointPath = (id: string) => `${WEBHOOKS_PATH}/${encodeURIComponent(id)}`;

function StatusCode({ code }: { code: number | null }) {
  if (code == null) return <span className="text-muted">—</span>;
  return <Badge tone={code >= 200 && code < 300 ? "success" : "danger"}>{code}</Badge>;
}

export function WebhooksSettings() {
  const { can, ready, workspace } = useSession();
  const { toast } = useUI();
  const admin = can("admin");
  const list = useApi<Endpoints>(ready && admin ? WEBHOOKS_PATH : null);
  const [editing, setEditing] = useState<WebhookEndpointDTO | "new" | null>(null);
  const [secret, setSecret] = useState<{ endpoint: WebhookEndpointDTO; secret: string; rotated: boolean } | null>(null);
  const [deleting, setDeleting] = useState<WebhookEndpointDTO | null>(null);
  const [rotating, setRotating] = useState<WebhookEndpointDTO | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookEndpointDTO | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  if (ready && !admin) return <Callout tone="info" title="Admins only">Only workspace admins can manage outbound webhooks.</Callout>;

  function replace(updated: WebhookEndpointDTO) {
    const { secret: _s, ...rest } = updated;
    void _s;
    setCached<Endpoints>(WEBHOOKS_PATH, (prev) => ({ ...(prev ?? { items: [] }), items: (prev?.items ?? []).map((e) => (e.id === rest.id ? rest : e)) }));
  }

  async function toggle(ep: WebhookEndpointDTO, enabled: boolean) {
    replace({ ...ep, enabled });
    try {
      const updated = await api<WebhookEndpointDTO>(endpointPath(ep.id), { method: "PATCH", body: { enabled } });
      replace(updated);
      toast({ title: enabled ? "Webhook enabled" : "Webhook paused" });
    } catch (e) {
      replace(ep);
      toast({ tone: "info", title: "Couldn't update webhook", body: errorMessage(e) });
    }
  }

  async function test(ep: WebhookEndpointDTO) {
    setTesting(ep.id);
    try {
      const r = await api<Partial<WebhookDeliveryDTO> | undefined>(`${endpointPath(ep.id)}/test`, { method: "POST" });
      const status = r?.responseStatus;
      toast({
        title: "Test event sent",
        body: status ? `Your endpoint answered with HTTP ${status}.` : "A ping event was queued. Check the delivery log for the result.",
      });
      invalidate(`${endpointPath(ep.id)}/deliveries`);
      invalidate(WEBHOOKS_PATH);
    } catch (e) {
      toast({ tone: "info", title: "Couldn't send test event", body: errorMessage(e) });
    } finally {
      setTesting(null);
    }
  }

  async function rotate(ep: WebhookEndpointDTO) {
    const updated = await api<WebhookEndpointDTO>(endpointPath(ep.id), { method: "PATCH", body: { rotateSecret: true } });
    replace(updated);
    if (updated.secret) setSecret({ endpoint: updated, secret: updated.secret, rotated: true });
    else toast({ title: "Secret rotated", body: "Update the signing secret in your receiver." });
  }

  async function remove(ep: WebhookEndpointDTO) {
    await api(endpointPath(ep.id), { method: "DELETE" });
    setCached<Endpoints>(WEBHOOKS_PATH, (prev) => ({ ...(prev ?? { items: [] }), items: (prev?.items ?? []).filter((e) => e.id !== ep.id) }));
    toast({ title: "Webhook deleted" });
    invalidate(WEBHOOKS_PATH);
  }

  const unavailable = list.error && isNotFound(list.error) && !list.data;

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Outbound webhooks"
        description="Infera POSTs signed JSON to your URLs when things happen — new messages, records created or changed, reviews."
        padded={false}
        actions={
          !unavailable && (
            <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setEditing("new")}>
              Add endpoint
            </Button>
          )
        }
      >
        {list.error && !list.data ? (
          <ErrorState compact error={list.error} retry={list.reload} title={unavailable ? "Webhooks aren't available yet" : undefined} />
        ) : (
          <DataTable
            caption="Webhook endpoints"
            rows={list.data?.items}
            loading={list.loading || !ready}
            skeletonRows={2}
            rowKey={(e) => e.id}
            empty={
              <EmptyState
                compact
                icon={<Webhook />}
                title="No webhook endpoints"
                body="Connect Infera to your CRM, spreadsheet or backend — every event is signed so you can verify it."
                action={
                  <Button size="sm" icon={<Plus />} onClick={() => setEditing("new")}>
                    Add endpoint
                  </Button>
                }
              />
            }
            columns={[
              {
                key: "url",
                header: "Endpoint",
                cell: (e) => (
                  <span className="block max-w-[22rem] min-w-0">
                    <code className="block truncate font-mono text-[13px] text-fg" title={e.url}>
                      {e.url}
                    </code>
                    {e.description && <span className="block truncate text-xs text-muted">{e.description}</span>}
                  </span>
                ),
              },
              {
                key: "events",
                header: "Events",
                hideBelow: "md",
                cell: (e) => (
                  <span className="flex flex-wrap gap-1" title={e.events.join(", ")}>
                    {e.events.length === DOMAIN_EVENT_TYPES.length ? (
                      <Badge>All events</Badge>
                    ) : (
                      <>
                        {e.events.slice(0, 2).map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                        {e.events.length > 2 && <Badge tone="muted">+{e.events.length - 2}</Badge>}
                      </>
                    )}
                  </span>
                ),
              },
              {
                key: "last",
                header: "Last delivery",
                hideBelow: "sm",
                cell: (e) => (
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <StatusCode code={e.lastStatus} />
                      <TimeAgo date={e.lastDeliveryAt} fallback="Never" className="text-xs text-muted" />
                    </span>
                    {e.failureCount > 0 && <span className="text-xs text-rose-700 dark:text-rose-400">{e.failureCount} failed in a row</span>}
                  </span>
                ),
              },
              {
                key: "enabled",
                header: "Enabled",
                cell: (e) => <Switch checked={e.enabled} onChange={(v) => void toggle(e, v)} label={`${e.enabled ? "Disable" : "Enable"} ${e.url}`} />,
              },
              {
                key: "actions",
                header: "Actions",
                srHeader: true,
                align: "right",
                cell: (e) => (
                  <span className="inline-flex items-center gap-1">
                    <Button size="xs" variant="ghost" icon={<History />} onClick={() => setDeliveries(e)} className="hidden sm:inline-flex">
                      Deliveries
                    </Button>
                    <Menu
                      label={`Actions for ${e.url}`}
                      placement="bottom-end"
                      trigger={({ props }) => (
                        <IconButton {...props} label="More actions" size="sm">
                          <Ellipsis />
                        </IconButton>
                      )}
                    >
                      <MenuItem icon={<Send />} onSelect={() => void test(e)} disabled={testing === e.id}>
                        Send test event
                      </MenuItem>
                      <MenuItem icon={<History />} onSelect={() => setDeliveries(e)}>
                        Delivery log
                      </MenuItem>
                      <MenuItem icon={<Pencil />} onSelect={() => setEditing(e)}>
                        Edit
                      </MenuItem>
                      <MenuItem icon={<RotateCw />} onSelect={() => setRotating(e)}>
                        Rotate signing secret
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(e)}>
                        Delete
                      </MenuItem>
                    </Menu>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Card>

      {!unavailable && (
        <Card title="Verifying signatures" description="Every request carries headers you can check before trusting the payload.">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-fg-soft">
            <li>
              <code className="font-mono text-[13px]">X-Infera-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code> — HMAC-SHA256 of <code className="font-mono text-[13px]">&quot;t.body&quot;</code> with your endpoint&apos;s
              signing secret. Reject old timestamps.
            </li>
            <li>
              <code className="font-mono text-[13px]">X-Infera-Event</code> and <code className="font-mono text-[13px]">X-Infera-Delivery</code> — the event type and a unique delivery id (use it to drop
              duplicates; failed deliveries are retried).
            </li>
            <li>Answer with any 2xx within 10 seconds. Endpoints that keep failing are paused automatically.</li>
          </ul>
          {workspace && !workspace.settings.allowExternalActions && (
            <p className="mt-3 text-xs text-muted">Automations can also call these endpoints once “Allow external actions” is on in General settings.</p>
          )}
        </Card>
      )}

      <EndpointDialog
        open={editing !== null}
        endpoint={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(ep, isNew) => {
          if (isNew) {
            const { secret: s, ...rest } = ep;
            setCached<Endpoints>(WEBHOOKS_PATH, (prev) => ({ ...(prev ?? { items: [] }), items: [rest, ...(prev?.items ?? []).filter((e) => e.id !== ep.id)] }));
            if (s) setSecret({ endpoint: ep, secret: s, rotated: false });
            else toast({ title: "Webhook added" });
          } else {
            replace(ep);
            toast({ title: "Webhook updated" });
          }
          invalidate(WEBHOOKS_PATH);
        }}
      />

      <Dialog
        open={secret !== null}
        onClose={() => setSecret(null)}
        title={secret?.rotated ? "New signing secret" : "Endpoint added"}
        description={secret ? <code className="font-mono text-xs break-all">{secret.endpoint.url}</code> : undefined}
        footer={
          <Button variant="primary" size="sm" onClick={() => setSecret(null)}>
            Done, I&apos;ve saved it
          </Button>
        }
      >
        {secret && (
          <div className="flex flex-col gap-4">
            <Callout tone="warning" icon={<TriangleAlert className="text-amber-600 dark:text-amber-400" />} title="Copy the signing secret now — it's shown only once">
              Use it to verify the <code className="font-mono text-[12px]">X-Infera-Signature</code> header.{secret.rotated ? " The previous secret no longer signs new deliveries." : ""}
            </Callout>
            <div className="flex items-center gap-2 rounded-xl border border-line bg-sunken/60 p-2 pl-3">
              <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-fg select-all">{secret.secret}</code>
              <CopyButton value={secret.secret} label="Copy secret" />
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={rotating !== null}
        onClose={() => setRotating(null)}
        title="Rotate signing secret?"
        body="A new secret is generated and shown once. Update your receiver right away — deliveries signed with the new secret fail verification against the old one."
        confirmLabel="Rotate secret"
        onConfirm={() => (rotating ? rotate(rotating) : undefined)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        danger
        title="Delete this webhook?"
        body={
          <>
            Infera stops sending events to <code className="font-mono text-[12px] break-all">{deleting?.url}</code>. Its delivery log is deleted too.
          </>
        }
        confirmLabel="Delete webhook"
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
      />
      <DeliveriesDrawer endpoint={deliveries} onClose={() => setDeliveries(null)} onTest={(ep) => test(ep)} />
    </div>
  );
}

function EndpointDialog({
  open,
  endpoint,
  onClose,
  onSaved,
}: {
  open: boolean;
  endpoint: WebhookEndpointDTO | null;
  onClose: () => void;
  onSaved: (ep: WebhookEndpointDTO, isNew: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<DomainEventType[]>([]);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ url?: string; events?: string; description?: string; form?: string }>({});
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const key = open ? (endpoint?.id ?? "new") : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    if (open) {
      setUrl(endpoint?.url ?? "");
      setDescription(endpoint?.description ?? "");
      setEvents(endpoint?.events ?? ["record.created", "record.updated", "review.created"]);
      setErrors({});
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const local: typeof errors = {};
    try {
      const u = new URL(url.trim());
      if (u.protocol !== "https:" && u.protocol !== "http:") local.url = "Use an https:// URL.";
    } catch {
      local.url = "Enter a full URL, e.g. https://example.com/hooks/infera.";
    }
    if (!events.length) local.events = "Pick at least one event.";
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setPending(true);
    setErrors({});
    try {
      const body = { url: url.trim(), description: description.trim(), events };
      const saved = endpoint
        ? await api<WebhookEndpointDTO>(endpointPath(endpoint.id), { method: "PATCH", body })
        : await api<WebhookEndpointDTO>(WEBHOOKS_PATH, { body: { ...body, enabled: true } });
      onClose();
      onSaved(saved, !endpoint);
    } catch (err) {
      const f = fieldErrors(err);
      setErrors(f.url || f.events || f.description ? { url: f.url, events: f.events, description: f.description } : { form: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  const allOn = events.length === DOMAIN_EVENT_TYPES.length;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!pending}
      size="lg"
      title={endpoint ? "Edit webhook" : "Add webhook endpoint"}
      description="Infera sends a signed POST request to this URL for each selected event."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="webhook-form" variant="primary" size="sm" pending={pending}>
            {endpoint ? "Save changes" : "Add endpoint"}
          </Button>
        </>
      }
    >
      <form id="webhook-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="URL" type="url" inputMode="url" placeholder="https://example.com/hooks/infera" value={url} onChange={(e) => setUrl(e.target.value)} required error={errors.url} className="font-mono text-[13px]" />
        <TextField label="Description" aside="Optional" placeholder="e.g. Sync new orders to our ERP" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} error={errors.description} />
        <fieldset>
          <div className="mb-2 flex items-center justify-between gap-2">
            <legend className="text-[13px] font-medium text-fg-soft">Events</legend>
            <button type="button" onClick={() => setEvents(allOn ? [] : [...DOMAIN_EVENT_TYPES])} className="text-xs font-medium text-brand hover:underline">
              {allOn ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {DOMAIN_EVENT_TYPES.map((t) => (
              <Checkbox
                key={t}
                label={<span className="font-mono text-[13px]">{t}</span>}
                description={DOMAIN_EVENT_DESCRIPTIONS[t]}
                checked={events.includes(t)}
                onChange={(on) => setEvents((cur) => (on ? DOMAIN_EVENT_TYPES.filter((x) => x === t || cur.includes(x)) : cur.filter((x) => x !== t)))}
              />
            ))}
          </div>
          {errors.events && <p className="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-400">{errors.events}</p>}
        </fieldset>
        {errors.form && <Callout tone="danger">{errors.form}</Callout>}
      </form>
    </Dialog>
  );
}

function DeliveriesDrawer({ endpoint, onClose, onTest }: { endpoint: WebhookEndpointDTO | null; onClose: () => void; onTest: (ep: WebhookEndpointDTO) => Promise<void> }) {
  const path = endpoint ? `${endpointPath(endpoint.id)}/deliveries` : null;
  const list = useCursorList<WebhookDeliveryDTO>(path, { refreshInterval: endpoint ? 15_000 : undefined });
  return (
    <Drawer
      open={endpoint !== null}
      onClose={onClose}
      width="xl"
      title="Delivery log"
      description={endpoint ? <code className="font-mono text-xs break-all">{endpoint.url}</code> : undefined}
      actions={
        endpoint && (
          <>
            <IconButton label="Refresh" onClick={() => void list.reload()}>
              <RefreshCw className={list.validating ? "animate-spin" : ""} />
            </IconButton>
            <Button size="sm" icon={<Send />} onClick={() => onTest(endpoint)}>
              Send test
            </Button>
          </>
        )
      }
    >
      {list.error && !list.data ? (
        <ErrorState compact error={list.error} retry={list.reload} />
      ) : (
        <div className="-mx-5">
          <DataTable
            caption="Webhook deliveries"
            rows={list.data ? list.items : undefined}
            loading={list.loading}
            dense
            rowKey={(d) => d.id}
            empty={<EmptyState compact icon={<History />} title="No deliveries yet" body="Send a test event to check your endpoint." />}
            columns={[
              { key: "event", header: "Event", cell: (d) => <code className="font-mono text-xs text-fg">{d.eventType}</code> },
              {
                key: "status",
                header: "Status",
                cell: (d) => (
                  <span className="flex flex-col gap-0.5">
                    {d.status === "delivered" ? <Badge tone="success">Delivered</Badge> : d.status === "failed" ? <Badge tone="danger">Failed</Badge> : <Badge tone="neutral">Pending</Badge>}
                    {d.error && (
                      <span className="max-w-56 truncate text-xs text-rose-700 dark:text-rose-400" title={d.error}>
                        {d.error}
                      </span>
                    )}
                  </span>
                ),
              },
              { key: "http", header: "HTTP", cell: (d) => <StatusCode code={d.responseStatus} /> },
              { key: "attempts", header: "Attempts", align: "right", hideBelow: "sm", cell: (d) => <span className="tabular-nums">{d.attempts}</span> },
              { key: "at", header: "Sent", align: "right", cell: (d) => <TimeAgo date={d.deliveredAt ?? d.createdAt} className="text-xs text-muted" /> },
            ]}
          />
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onLoadMore={list.loadMore} error={list.loadMoreError} />
        </div>
      )}
    </Drawer>
  );
}
