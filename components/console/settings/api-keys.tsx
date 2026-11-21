"use client";

/** /console/settings/api-keys — list, create (key shown once), revoke. Admin only. */
import { useState, type FormEvent } from "react";
import { KeyRound, Plus, TriangleAlert } from "lucide-react";
import { useUI } from "@/components/providers";
import { api, invalidate, setCached, useApi } from "@/lib/client/api";
import { errorMessage, fieldErrors } from "@/lib/client/errors";
import { SCOPE_DESCRIPTIONS, formatDate } from "@/lib/client/format";
import { API_SCOPES, type ApiKeyDTO, type ApiScope } from "@/lib/shared/types";
import { useSession } from "../session";
import { Card, Callout, EmptyState } from "../kit/surface";
import { Badge } from "../kit/badges";
import { Button, Checkbox, Select, TextField } from "../kit/form";
import { ConfirmDialog, Dialog } from "../kit/overlay";
import { DataTable } from "../kit/table";
import { CopyButton, ErrorState, TimeAgo, useNow } from "../kit/misc";
import { Chip } from "@/components/app/ui-base";
import { API_KEYS_PATH } from "./frame";

type Keys = { items: ApiKeyDTO[]; nextCursor?: string | null };

function keyState(k: ApiKeyDTO, now: number): "active" | "expired" | "revoked" {
  if (k.revokedAt) return "revoked";
  if (k.expiresAt && now && new Date(k.expiresAt).getTime() <= now) return "expired";
  return "active";
}

export function ApiKeysSettings() {
  const { can, ready } = useSession();
  const { toast } = useUI();
  const admin = can("admin");
  const keys = useApi<Keys>(ready && admin ? API_KEYS_PATH : null);
  const now = useNow();
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyDTO | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  if (ready && !admin) {
    return <Callout tone="info" title="Admins only">Only workspace admins can view and manage API keys.</Callout>;
  }

  const all = keys.data?.items ?? [];
  const inactive = all.filter((k) => keyState(k, now) !== "active").length;
  const rows = showInactive ? all : all.filter((k) => keyState(k, now) === "active");

  async function revoke(k: ApiKeyDTO) {
    const updated = await api<ApiKeyDTO>(`/api/v1/api-keys/${encodeURIComponent(k.id)}`, { method: "DELETE" });
    setCached<Keys>(API_KEYS_PATH, (prev) => ({ ...(prev ?? { items: [] }), items: (prev?.items ?? []).map((x) => (x.id === k.id ? (updated ?? { ...x, revokedAt: new Date().toISOString() }) : x)) }));
    toast({ title: "API key revoked", body: `${k.name} stopped working.` });
    invalidate(API_KEYS_PATH);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="API keys"
        description="Let other systems send messages into Infera and read your data. Keys are stored hashed — we can't show them again."
        padded={false}
        actions={
          <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setCreateOpen(true)}>
            Create key
          </Button>
        }
      >
        {inactive > 0 && (
          <div className="flex items-center gap-2 px-4 pb-3 sm:px-5">
            <Chip active={showInactive} onClick={() => setShowInactive((v) => !v)}>
              Show revoked & expired ({inactive})
            </Chip>
          </div>
        )}
        {keys.error && !keys.data ? (
          <ErrorState compact error={keys.error} retry={keys.reload} />
        ) : (
          <DataTable
            caption="API keys"
            rows={keys.data ? rows : undefined}
            loading={keys.loading || !ready}
            skeletonRows={3}
            rowKey={(k) => k.id}
            empty={
              <EmptyState
                compact
                icon={<KeyRound />}
                title="No API keys yet"
                body="Create a key to send messages from your own systems with POST /api/v1/events."
                action={
                  <Button size="sm" icon={<Plus />} onClick={() => setCreateOpen(true)}>
                    Create key
                  </Button>
                }
              />
            }
            rowClassName={(k) => (keyState(k, now) === "active" ? "" : "opacity-60")}
            columns={[
              {
                key: "name",
                header: "Name",
                cell: (k) => (
                  <span className="block min-w-0">
                    <span className="block truncate font-medium text-fg">{k.name}</span>
                    <code className="block truncate font-mono text-xs text-muted">{k.prefix}…</code>
                  </span>
                ),
              },
              {
                key: "scopes",
                header: "Scopes",
                cell: (k) => (
                  <span className="flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <Badge key={s} tone={s === "delete" ? "danger" : s === "write" ? "warning" : "neutral"}>
                        {s}
                      </Badge>
                    ))}
                  </span>
                ),
              },
              { key: "used", header: "Last used", hideBelow: "md", cell: (k) => <TimeAgo date={k.lastUsedAt} fallback="Never" className="text-muted" /> },
              { key: "expires", header: "Expires", hideBelow: "lg", cell: (k) => <span className="text-muted">{k.expiresAt ? formatDate(k.expiresAt) : "Never"}</span> },
              {
                key: "status",
                header: "Status",
                hideBelow: "sm",
                cell: (k) => {
                  const st = keyState(k, now);
                  return st === "active" ? <Badge tone="success" dot>Active</Badge> : st === "expired" ? <Badge tone="warning">Expired</Badge> : <Badge tone="muted">Revoked</Badge>;
                },
              },
              {
                key: "actions",
                header: "Actions",
                srHeader: true,
                align: "right",
                cell: (k) =>
                  keyState(k, now) === "revoked" ? null : (
                    <Button size="xs" variant="danger-ghost" onClick={() => setRevoking(k)} aria-label={`Revoke ${k.name}`}>
                      Revoke
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </Card>

      <CreateKeyDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        danger
        title={`Revoke “${revoking?.name ?? ""}”?`}
        body="Anything using this key stops working immediately. This can't be undone."
        confirmLabel="Revoke key"
        onConfirm={() => (revoking ? revoke(revoking) : undefined)}
      />
    </div>
  );
}

function CreateKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["ingest", "read"]);
  const [expires, setExpires] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; scopes?: string; form?: string }>({});
  const [created, setCreated] = useState<ApiKeyDTO | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setScopes(["ingest", "read"]);
      setExpires("");
      setErrors({});
      setCreated(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const local: typeof errors = {};
    if (!name.trim()) local.name = "Give the key a name.";
    if (!scopes.length) local.scopes = "Pick at least one scope.";
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setPending(true);
    setErrors({});
    try {
      const key = await api<ApiKeyDTO>(API_KEYS_PATH, { body: { name: name.trim(), scopes, ...(expires ? { expiresInDays: Number(expires) } : {}) } });
      const { key: secret, ...listed } = key;
      void secret;
      setCached<Keys>(API_KEYS_PATH, (prev) => ({ ...(prev ?? { items: [] }), items: [listed, ...(prev?.items ?? []).filter((k) => k.id !== key.id)] }));
      invalidate(API_KEYS_PATH);
      setCreated(key);
    } catch (err) {
      const f = fieldErrors(err);
      setErrors(f.name || f.scopes ? { name: f.name, scopes: f.scopes } : { form: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  if (created) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const example = `curl -X POST ${origin}/api/v1/events \\
  -H "Authorization: Bearer ${created.key ?? "<your key>"}" \\
  -H "Content-Type: application/json" \\
  -d '{"conversation":{"id":"chat-1"},"sender":{"name":"Asha","phone":"+919800000000"},"message":{"id":"msg-1","text":"Need 2 boxes, can pay 1500 today"}}'`;
    return (
      <Dialog
        open={open}
        onClose={onClose}
        size="lg"
        title="Your new API key"
        description={`“${created.name}” · ${created.scopes.join(", ")}${created.expiresAt ? ` · expires ${formatDate(created.expiresAt)}` : ""}`}
        footer={
          <Button variant="primary" size="sm" onClick={onClose}>
            Done, I&apos;ve saved it
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Callout tone="warning" icon={<TriangleAlert className="text-amber-600 dark:text-amber-400" />} title="Copy it now — you won't see it again">
            Store it in a password manager or your server&apos;s secrets. Anyone with this key can use it with the scopes above.
          </Callout>
          {created.key && (
            <div className="flex items-center gap-2 rounded-xl border border-line bg-sunken/60 p-2 pl-3">
              <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-fg select-all">{created.key}</code>
              <CopyButton value={created.key} label="Copy key" />
            </div>
          )}
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-fg-soft">Try it</p>
            <div className="relative">
              <pre className="overflow-x-auto rounded-xl border border-line bg-sunken/60 p-3 pr-12 font-mono text-[12px] leading-5 text-fg-soft">{example}</pre>
              <span className="absolute top-2 right-2">
                <CopyButton value={example} iconOnly size="xs" label="Copy example" />
              </span>
            </div>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!pending}
      title="Create API key"
      description="Give each integration its own key so you can revoke it independently."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="api-key-form" variant="primary" size="sm" pending={pending}>
            Create key
          </Button>
        </>
      }
    >
      <form id="api-key-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="Name" placeholder="e.g. Shopify sync" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required error={errors.name} />
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-fg-soft">Scopes</legend>
          <div className="flex flex-col gap-2.5">
            {API_SCOPES.map((s) => (
              <Checkbox
                key={s}
                label={<span className="font-mono text-[13px]">{s}</span>}
                description={SCOPE_DESCRIPTIONS[s]}
                checked={scopes.includes(s)}
                onChange={(on) => setScopes((cur) => (on ? API_SCOPES.filter((x) => x === s || cur.includes(x)) : cur.filter((x) => x !== s)))}
              />
            ))}
          </div>
          {errors.scopes && <p className="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-400">{errors.scopes}</p>}
        </fieldset>
        {scopes.includes("delete") && <Callout tone="warning">Keys with the delete scope can remove records. Only grant it when needed.</Callout>}
        <Select
          label="Expires"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          options={[
            { value: "", label: "Never" },
            { value: "30", label: "In 30 days" },
            { value: "90", label: "In 90 days" },
            { value: "180", label: "In 6 months" },
            { value: "365", label: "In 1 year" },
          ]}
        />
        {errors.form && <Callout tone="danger">{errors.form}</Callout>}
      </form>
    </Dialog>
  );
}
