"use client";

/**
 * Gmail / mailbox and LinkedIn channels, plus the live panel for persistent connectors:
 *  - GmailConnectDialog / LinkedInConnectDialog create the channel and start the login.
 *  - LiveConnectionPanel: Telegram accounts use the shared TelegramLoginPanel (QR / phone / two-step,
 *    components/console/connect/telegram-connect.tsx); mailboxes show sync progress and controls.
 *  - LinkedInPanel: Unipile login, history import and status.
 *
 * Telegram accounts are linked from /console/connect?with=telegram — users never enter api_id / api_hash.
 */
import { useState } from "react";
import Link from "next/link";
import { KeyRound, LogIn, LogOut, Mail, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { api, invalidate, setCached, useApi } from "@/lib/client/api";
import { errorMessage, fieldErrors } from "@/lib/client/errors";
import { formatNumber } from "@/lib/client/format";
import { useIntegrations } from "@/lib/client/integrations";
import type { ChannelDTO, ConnectionDTO } from "@/lib/shared/types";
import { Callout, Spinner } from "../kit/surface";
import { Badge, ConnectionBadge } from "../kit/badges";
import { Button, Checkbox, RadioCards, Select, TextField } from "../kit/form";
import { ConfirmDialog, Dialog } from "../kit/overlay";
import { TimeAgo } from "../kit/misc";
import { TelegramLoginPanel } from "../connect/telegram-connect";

export { useIntegrations, type Integrations } from "@/lib/client/integrations";

const HISTORY = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "0", label: "None — new messages only" },
];

/* ------------------------- Live connection panel ------------------------- */

export function LiveConnectionPanel({ channel: c, admin }: { channel: ChannelDTO; admin: boolean }) {
  return c.type === "telegram_user" ? <TelegramLoginPanel channelId={c.id} admin={admin} /> : <MailboxConnectionPanel channel={c} admin={admin} />;
}

function MailboxConnectionPanel({ channel: c, admin }: { channel: ChannelDTO; admin: boolean }) {
  const path = `/api/v1/channels/${c.id}/connection`;
  const conn = useApi<ConnectionDTO>(path, { refreshInterval: 3000, staleMs: 1000 });
  const [err, setErr] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const s = conn.data;

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    setErr(null);
    try {
      const next = await api<ConnectionDTO>(path, { body: { action, ...extra } });
      setCached<ConnectionDTO>(path, () => next);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  if (!s) return <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading…</div>;
  if (!s.syncAvailable) return <Callout tone="warning">Live sync needs a long-running server; it is off here (INFERA_SYNC / INFERA_WORKER).</Callout>;
  // A mailbox without an app password signs in with Google.
  const google = c.type === "email_imap" && !c.secretsSet.includes("password");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ConnectionBadge state={s.state} />
        {s.account && <span className="text-sm text-fg-soft">{[s.account.name, s.account.phone, s.account.email].filter(Boolean).join(" · ")}</span>}
        {s.lastSyncAt && s.state === "connected" && <span className="text-xs text-muted">Last activity <TimeAgo date={s.lastSyncAt} /></span>}
      </div>
      {s.lastError && s.state !== "connected" && <Callout tone={s.state === "error" ? "danger" : "info"}>{s.lastError}</Callout>}
      {err && <Callout tone="danger">{err}</Callout>}

      {s.state === "connecting" && <p className="flex items-center gap-2 text-sm text-fg-soft"><Spinner /> Connecting…</p>}

      {s.state === "syncing" && <p className="flex items-center gap-2 text-sm text-fg-soft"><Spinner /> {s.progress?.message ?? "Importing recent messages…"} {s.progress?.done ? `(${formatNumber(s.progress.done)})` : ""}</p>}
      {s.state === "connected" && s.progress?.phase === "done" && s.progress.message && <p className="text-xs text-muted">{s.progress.message}</p>}

      {admin && (
        <div className="flex flex-wrap gap-2">
          {(s.state === "disconnected" || s.state === "logged_out" || s.state === "error") &&
            (google && s.state !== "error" ? (
              <a href={`/api/v1/channels/${c.id}/google`} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand px-3 text-[13px] font-medium text-white"><LogIn className="size-3.5" /> Sign in with Google</a>
            ) : (
              <Button size="sm" variant="brand" icon={<PlugZap />} onClick={() => run("connect")}>{s.state === "error" ? "Reconnect" : "Connect"}</Button>
            ))}
          {(s.state === "connected" || s.state === "syncing") && (
            <>
              <Button size="sm" icon={<RefreshCw />} onClick={() => run("resync")}>Import recent messages</Button>
              <Button size="sm" icon={<Unplug />} onClick={() => run("disconnect")}>Pause sync</Button>
            </>
          )}
          {s.state === "pairing" && <Button size="sm" variant="ghost" icon={<Unplug />} onClick={() => run("disconnect")}>Cancel</Button>}
          {s.state !== "logged_out" && <Button size="sm" variant="danger-ghost" icon={<LogOut />} onClick={() => setConfirmLogout(true)}>Disconnect account</Button>}
        </div>
      )}
      <ConfirmDialog
        open={confirmLogout}
        danger
        title="Disconnect this mailbox?"
        body="Syncing stops and the stored login is deleted. Messages already imported stay in Infera."
        confirmLabel="Disconnect"
        onClose={() => setConfirmLogout(false)}
        onConfirm={async () => {
          await run("logout");
          setConfirmLogout(false);
        }}
      />
    </div>
  );
}

/* --------------------------------- Gmail -------------------------------- */

export function GmailConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const integ = useIntegrations();
  const [method, setMethod] = useState<"google" | "password">("google");
  const [provider, setProvider] = useState<"gmail" | "outlook" | "custom">("gmail");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [days, setDays] = useState("30");
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<ChannelDTO | null>(null);
  const googleOk = integ?.google !== false;
  const useGoogle = method === "google" && googleOk;

  const submit = async () => {
    setErr(null);
    setFields({});
    try {
      const ch = await api<ChannelDTO>("/api/v1/channels", {
        body: {
          type: "email_imap",
          name: useGoogle ? "Gmail" : address || "Mailbox",
          config: { provider: useGoogle ? "gmail" : provider, historyDays: Number(days), ...(address ? { address } : {}), ...(provider === "custom" && !useGoogle ? { imapHost, smtpHost } : {}) },
          ...(useGoogle ? {} : { secrets: { password } }),
        },
      });
      invalidate("/api/v1/channels");
      if (useGoogle) {
        window.location.href = `/api/v1/channels/${ch.id}/google`;
        return;
      }
      await api(`/api/v1/channels/${ch.id}/connection`, { body: { action: "connect" } });
      setCreated(ch);
    } catch (e) {
      setErr(errorMessage(e));
      setFields(fieldErrors(e));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={created ? "Mailbox connected" : "Connect Gmail"}
      description={created ? undefined : "Recent email imports automatically and new mail arrives live. LinkedIn message notifications in this inbox become LinkedIn conversations."}
      footer={created ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="brand" icon={useGoogle ? <LogIn /> : <Mail />} onClick={submit} disabled={!useGoogle && (!address || !password || (provider === "custom" && !imapHost))}>{useGoogle ? "Sign in with Google" : "Connect mailbox"}</Button></>}
    >
      {created ? (
        <LiveConnectionPanel channel={created} admin />
      ) : (
        <div className="space-y-3">
          <RadioCards<"google" | "password">
            name="mail-method"
            value={method}
            onChange={setMethod}
            columns={2}
            options={[
              { value: "google", label: "Sign in with Google", icon: <LogIn />, badge: <Badge tone="success">Easiest</Badge>, description: googleOk ? "Gmail and Google Workspace. No password stored." : "Not set up on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)." },
              { value: "password", label: "App password", icon: <KeyRound />, description: "Gmail (Google Account → Security → App passwords), Outlook or any IMAP mailbox." },
            ]}
          />
          <Select label="Import recent email" value={days} onChange={(e) => setDays(e.target.value)} options={HISTORY} containerClassName="sm:w-1/2" />
          {!useGoogle && (
            <>
              <Select label="Provider" value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} options={[{ value: "gmail", label: "Gmail / Google Workspace" }, { value: "outlook", label: "Outlook / Microsoft 365" }, { value: "custom", label: "Other (IMAP)" }]} />
              <TextField label="Email address" type="email" value={address} onChange={(e) => setAddress(e.target.value)} error={fields["config.address"]} autoComplete="email" />
              <TextField label="App password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} hint={provider === "gmail" ? "16 characters from Google Account → Security → 2-Step Verification → App passwords." : undefined} />
              {provider === "custom" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <TextField label="IMAP server" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.example.com" error={fields["config.imapHost"]} />
                  <TextField label="SMTP server (replies)" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
                </div>
              )}
            </>
          )}
          {err && <Callout tone="danger">{err}</Callout>}
        </div>
      )}
    </Dialog>
  );
}

/* -------------------------------- LinkedIn ------------------------------- */

export function LinkedInConnectDialog({ open, onClose, onGmail }: { open: boolean; onClose: () => void; onGmail: () => void }) {
  const [dsn, setDsn] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [days, setDays] = useState("30");
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async () => {
    setErr(null);
    setFields({});
    try {
      const ch = await api<ChannelDTO>("/api/v1/channels", { body: { type: "linkedin", name: "LinkedIn", config: { dsn, historyDays: Number(days) }, secrets: { apiKey } } });
      invalidate("/api/v1/channels");
      const link = await api<{ url: string }>(`/api/v1/channels/${ch.id}/linkedin`, { body: {} });
      window.location.href = link.url;
    } catch (e) {
      setErr(errorMessage(e));
      setFields(fieldErrors(e));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Connect LinkedIn"
      description="LinkedIn doesn't offer a messaging API for regular accounts, so there are two ways in."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="brand" icon={<LogIn />} onClick={submit} disabled={!dsn || !apiKey}>Continue to LinkedIn login</Button></>}
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-xl border border-line p-3">
          <p className="font-medium text-fg">1. Free: LinkedIn notification emails</p>
          <p className="mt-0.5 text-fg-soft">Connect the Gmail inbox that receives LinkedIn notifications — “X sent you a message” emails become LinkedIn conversations automatically. (You reply on LinkedIn.)</p>
          <Button size="sm" className="mt-2" icon={<Mail />} onClick={onGmail}>Connect Gmail</Button>
        </div>
        <div className="space-y-3 rounded-xl border border-line p-3">
          <p className="font-medium text-fg">2. Full inbox sync with Unipile <Badge tone="info">Paid third-party</Badge></p>
          <p className="text-fg-soft">Every LinkedIn conversation syncs live, recent history imports, and you can reply from Infera. Needs a <a href="https://www.unipile.com" target="_blank" rel="noreferrer" className="underline">Unipile</a> account; you log in to LinkedIn on Unipile&apos;s secure page.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <TextField label="Unipile DSN" placeholder="api8.unipile.com:13851" value={dsn} onChange={(e) => setDsn(e.target.value)} error={fields["config.dsn"]} />
            <TextField label="Unipile access token" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} error={fields["secrets.apiKey"]} />
          </div>
          <Select label="Import recent messages" value={days} onChange={(e) => setDays(e.target.value)} options={HISTORY.filter((h) => h.value !== "0")} containerClassName="sm:w-1/2" />
        </div>
        {err && <Callout tone="danger">{err}</Callout>}
      </div>
    </Dialog>
  );
}

export function LinkedInPanel({ channel: c, admin }: { channel: ChannelDTO; admin: boolean }) {
  const conn = useApi<ConnectionDTO>(`/api/v1/channels/${c.id}/connection`, { refreshInterval: 5000 });
  const [err, setErr] = useState<string | null>(null);
  const s = conn.data;
  const linked = typeof c.config?.accountId === "string";
  const relink = async () => {
    setErr(null);
    try {
      const link = await api<{ url: string }>(`/api/v1/channels/${c.id}/linkedin`, { body: {} });
      window.location.href = link.url;
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const importNow = async () => {
    setErr(null);
    try {
      await api(`/api/v1/channels/${c.id}/history`, { body: {} });
      setTimeout(() => void conn.reload(), 1500);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {s ? <ConnectionBadge state={linked ? s.state : "disconnected"} /> : <Spinner />}
        <Badge tone="info">via Unipile</Badge>
        {s?.account?.name && <span className="text-sm text-fg-soft">{s.account.name}</span>}
      </div>
      {s?.state === "syncing" && <p className="flex items-center gap-2 text-sm text-fg-soft"><Spinner /> {s.progress?.message ?? "Importing…"}</p>}
      {s?.state === "connected" && s.progress?.message && <p className="text-xs text-muted">{s.progress.message}</p>}
      {(s?.lastError || c.lastError) && <Callout tone="warning">{s?.lastError ?? c.lastError}</Callout>}
      {err && <Callout tone="danger">{err}</Callout>}
      {admin && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={linked ? "secondary" : "brand"} icon={<LogIn />} onClick={relink}>{linked ? "Reconnect LinkedIn" : "Log in to LinkedIn"}</Button>
          {linked && <Button size="sm" icon={<RefreshCw />} onClick={importNow} disabled={s?.state === "syncing"}>Import recent messages</Button>}
        </div>
      )}
      {!linked && <p className="text-xs text-muted">Or capture LinkedIn messages for free from notification emails — <Link href="/console/channels?connect=gmail" className="underline">connect Gmail</Link>.</p>}
    </div>
  );
}
