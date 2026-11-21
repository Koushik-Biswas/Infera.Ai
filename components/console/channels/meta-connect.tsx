"use client";

/**
 * Facebook Messenger / Instagram Direct (official Meta Messenger Platform).
 *
 *  - MetaConnectDialog: Page ID + Page access token + app secret (+ optional App ID to
 *    register the webhook automatically) → creates the channel, shows the callback URL and
 *    verify token, and starts importing recent conversations.
 *  - MetaChannelPanel: live status, history-import progress, "Import recent messages", webhook URL.
 */
import { useState } from "react";
import { Camera, MessagesSquare, RefreshCw } from "lucide-react";
import { api, invalidate, useApi } from "@/lib/client/api";
import { errorMessage, fieldErrors } from "@/lib/client/errors";
import { formatNumber } from "@/lib/client/format";
import type { ChannelDTO, ConnectionDTO } from "@/lib/shared/types";
import { Callout, KeyValue, Spinner } from "../kit/surface";
import { Badge, ConnectionBadge } from "../kit/badges";
import { Button, Checkbox, RadioCards, Select, TextField } from "../kit/form";
import { Dialog } from "../kit/overlay";
import { CopyButton, TimeAgo } from "../kit/misc";

type Platform = "messenger" | "instagram";
type Created = ChannelDTO & { generatedSecrets?: Record<string, string>; webhookRegistration?: { ok: boolean; steps: { step: string; ok: boolean; error?: string }[] } };

const Copyable = ({ value }: { value: string }) => (
  <span className="flex min-w-0 items-center gap-2">
    <code className="truncate text-xs">{value}</code>
    <CopyButton value={value} iconOnly size="xs" />
  </span>
);

export function MetaConnectDialog({ open, onClose, initial = "messenger" }: { open: boolean; onClose: () => void; initial?: Platform }) {
  const [platform, setPlatform] = useState<Platform>(initial);
  const [name, setName] = useState("");
  const [pageId, setPageId] = useState("");
  const [token, setToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [appId, setAppId] = useState("");
  const [auto, setAuto] = useState(true);
  const [days, setDays] = useState("30");
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Created | null>(null);

  const close = () => {
    onClose();
    setTimeout(() => {
      setDone(null);
      setErr(null);
      setFields({});
      setToken("");
      setAppSecret("");
    }, 200);
  };

  const submit = async () => {
    setErr(null);
    setFields({});
    try {
      const ch = await api<Created>("/api/v1/channels", {
        body: {
          type: platform,
          name: name.trim() || (platform === "instagram" ? "Instagram" : "Messenger"),
          externalId: pageId.trim(),
          config: { historyDays: Number(days), ...(appId.trim() ? { appId: appId.trim() } : {}) },
          secrets: { pageAccessToken: token.trim(), appSecret: appSecret.trim() },
          registerWebhook: auto && Boolean(appId.trim()),
        },
      });
      invalidate("/api/v1/channels");
      setDone(ch);
    } catch (e) {
      setErr(errorMessage(e));
      setFields(fieldErrors(e));
    }
  };

  const label = platform === "instagram" ? "Instagram" : "Messenger";
  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={done ? `${label} connected` : "Connect Meta Messenger"}
      description={done ? undefined : "Official Meta Messenger Platform — no ban risk. Messages from your Facebook Page or Instagram account sync live."}
      footer={
        done ? (
          <Button variant="primary" onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={submit} disabled={!pageId.trim() || !token.trim() || !appSecret.trim()}>
              Connect {label}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-3 text-sm">
          {done.webhookRegistration?.ok ? (
            <Callout tone="success" title="Webhook registered">Meta now sends new messages to Infera. Recent conversations are importing.</Callout>
          ) : (
            <Callout tone="info" title="One step left in Meta">
              In your Meta app → <b>{platform === "instagram" ? "Instagram" : "Messenger"} → Webhooks</b>, set the callback URL and verify token below, subscribe to <b>messages</b>
              {platform === "messenger" ? <>, <b>message_echoes</b></> : null} and <b>messaging_postbacks</b>, and add your Page.
              {done.webhookRegistration && !done.webhookRegistration.ok && (
                <span className="mt-1 block text-xs text-muted">Automatic setup failed: {done.webhookRegistration.steps.filter((s) => !s.ok).map((s) => s.error).join(" · ")}</span>
              )}
            </Callout>
          )}
          <KeyValue
            items={[
              { label: "Callback URL", value: done.webhookUrl ? <Copyable value={done.webhookUrl} /> : "—" },
              { label: "Verify token", value: done.generatedSecrets?.verifyToken ? <Copyable value={done.generatedSecrets.verifyToken} /> : "—", hint: "Shown only once — copy it now." },
            ]}
          />
          <p className="text-xs text-muted">Recent conversations (last {days} days) are importing in the background — see progress on the channel card. New messages arrive live once the webhook is set.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <RadioCards<Platform>
            name="meta-platform"
            value={platform}
            onChange={setPlatform}
            columns={2}
            options={[
              { value: "messenger", label: "Facebook Messenger", icon: <MessagesSquare />, description: "Messages to your Facebook Page." },
              { value: "instagram", label: "Instagram Direct", icon: <Camera />, description: "DMs to the Instagram professional account linked to your Page." },
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Channel name" value={name} onChange={(e) => setName(e.target.value)} placeholder={label} maxLength={80} />
            <Select
              label="Import recent messages"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              options={[
                { value: "7", label: "Last 7 days" },
                { value: "30", label: "Last 30 days" },
                { value: "90", label: "Last 90 days" },
              ]}
            />
          </div>
          <TextField label="Facebook Page ID" hint="Meta Business Suite → Settings → Page, or your Page → About → Page transparency." value={pageId} onChange={(e) => setPageId(e.target.value)} inputMode="numeric" error={fields.externalId} required />
          <TextField
            label="Page access token"
            hint={`A long-lived Page token with pages_messaging${platform === "instagram" ? ", instagram_basic and instagram_manage_messages" : ", pages_read_engagement"}.`}
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            error={fields["secrets.pageAccessToken"]}
            required
          />
          <TextField label="App secret" hint="Meta app → App settings → Basic. Used to verify every webhook." type="password" autoComplete="off" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} error={fields["secrets.appSecret"]} required />
          <TextField label="App ID (optional)" hint="Lets Infera register the webhook for you." value={appId} onChange={(e) => setAppId(e.target.value)} inputMode="numeric" error={fields["config.appId"]} />
          {appId.trim() && <Checkbox checked={auto} onChange={setAuto} label="Register the webhook automatically" description="Needs Infera on a public HTTPS address (APP_URL)." />}
          {err && <Callout tone="danger">{err}</Callout>}
        </div>
      )}
    </Dialog>
  );
}

export function MetaChannelPanel({ channel: c, admin }: { channel: ChannelDTO; admin: boolean }) {
  const path = `/api/v1/channels/${c.id}/connection`;
  const conn = useApi<ConnectionDTO>(path, { refreshInterval: 15_000 });
  const [err, setErr] = useState<string | null>(null);
  const s = conn.data;
  const syncing = s?.state === "syncing";

  const importNow = async () => {
    setErr(null);
    try {
      await api(`/api/v1/channels/${c.id}/history`, { body: { days: typeof c.config?.historyDays === "number" ? c.config.historyDays : 30 } });
      setTimeout(() => void conn.reload(), 1500);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {s ? <ConnectionBadge state={s.state} /> : <Spinner />}
        <Badge tone="success">Official</Badge>
        {c.lastEventAt && (
          <span className="text-xs text-muted">
            Last message <TimeAgo date={c.lastEventAt} />
          </span>
        )}
      </div>
      {syncing && (
        <p className="flex items-center gap-2 text-sm text-fg-soft">
          <Spinner /> {s?.progress?.message ?? "Importing recent conversations…"} {s?.progress?.done ? `(${formatNumber(s.progress.done)})` : ""}
        </p>
      )}
      {!syncing && s?.progress?.phase === "done" && s.progress.message && <p className="text-xs text-muted">{s.progress.message}</p>}
      {(s?.lastError || c.lastError) && <Callout tone="warning">{s?.lastError ?? c.lastError}</Callout>}
      {err && <Callout tone="danger">{err}</Callout>}
      {c.webhookUrl && <KeyValue items={[{ label: "Callback URL (Meta app → Webhooks)", value: <Copyable value={c.webhookUrl} /> }]} />}
      {admin && (
        <Button size="sm" icon={<RefreshCw />} onClick={importNow} disabled={syncing}>
          Import recent messages
        </Button>
      )}
    </div>
  );
}
