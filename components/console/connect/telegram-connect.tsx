"use client";

/**
 * Linking a personal Telegram account — the one place this UI lives (used by /console/connect
 * and by the Channels page):
 *
 *  - TelegramConnect: the /console/connect section — "not set up" messages, the start button, then
 *    TelegramLoginPanel for the account.
 *  - TelegramLoginPanel: QR code (refreshes about every 30 s) → two-step password if the account has
 *    one → "Connected ✓". "Use phone number instead" falls back to phone → login code → password.
 *    Driven entirely by the channel's ConnectionDTO (state, qr, prompt, lastError).
 *
 * Users never see or enter Telegram api_id / api_hash: the server's TELEGRAM_API_ID /
 * TELEGRAM_API_HASH are used. Passwords and codes go straight to the connection API (sealed there).
 */
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { ArrowRight, CircleCheck, KeyRound, LogOut, Phone, QrCode, RefreshCw, Send, Unplug } from "lucide-react";
import { api, invalidate, setCached, useApi } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/errors";
import { formatNumber } from "@/lib/client/format";
import { useIntegrations } from "@/lib/client/integrations";
import type { ChannelDTO, ConnectionDTO, ConnectionPrompt } from "@/lib/shared/types";
import { useSession } from "../session";
import { Callout, Card, Spinner } from "../kit/surface";
import { ConnectionBadge } from "../kit/badges";
import { Button, Checkbox, Select, TextField } from "../kit/form";
import { ConfirmDialog } from "../kit/overlay";
import { TimeAgo } from "../kit/misc";

export const TELEGRAM_CONNECT_PATH = "/console/connect?with=telegram";
const connectionPath = (channelId: string) => `/api/v1/channels/${channelId}/connection`;
const LIVE = new Set<ConnectionDTO["state"]>(["connected", "syncing"]);

const HISTORY = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "0", label: "None — new messages only" },
];

/* ---------------------------- Not set up ---------------------------- */

/** Shown when the server has no TELEGRAM_API_ID / TELEGRAM_API_HASH. No input fields. */
export function TelegramNotConfigured({ admin }: { admin: boolean }) {
  return admin ? (
    <Callout tone="info" title="Telegram isn't set up on this server yet">
      An admin must add <code>TELEGRAM_API_ID</code> and <code>TELEGRAM_API_HASH</code> to <code>.env.local</code> and restart the server. See{" "}
      <code>docs/CONNECTORS_SETUP.md</code>.
    </Callout>
  ) : (
    <Callout tone="info">Telegram is not available yet. Ask your workspace admin.</Callout>
  );
}

/* ------------------------- /console/connect -------------------------- */

export function TelegramConnect({ onConnected }: { onConnected?: (channelId: string) => void }) {
  const { can, ready } = useSession();
  const admin = can("admin");
  const integ = useIntegrations();
  const channels = useApi<{ items: ChannelDTO[] }>("/api/v1/channels");
  const existing = channels.data?.items.find((c) => c.type === "telegram_user" && c.status === "active") ?? null;

  if (channels.error && !channels.data) return <Callout tone="danger">{errorMessage(channels.error)}</Callout>;
  if (!integ || !channels.data || !ready) {
    return (
      <div className="flex justify-center py-16 text-sm text-muted">
        <Spinner className="size-5" label="Loading" />
      </div>
    );
  }
  if (!integ.telegram) return <TelegramNotConfigured admin={admin} />;
  if (!integ.liveSync) {
    return admin ? (
      <Callout tone="warning" title="Live sync is off on this server">
        Telegram accounts need a long-running server (Docker, a VM, <code>npm start</code> or <code>npm run dev</code>). It&apos;s disabled here by <code>INFERA_SYNC=off</code> or{" "}
        <code>INFERA_WORKER=off</code>.
      </Callout>
    ) : (
      <Callout tone="info">Telegram is not available yet. Ask your workspace admin.</Callout>
    );
  }
  if (!admin && !existing) {
    return (
      <Card>
        <p className="text-sm text-fg-soft">Only workspace admins can link a Telegram account. Ask an admin to connect it.</p>
      </Card>
    );
  }
  return existing ? (
    <Card title={existing.name} description="Your personal Telegram account — private chats and groups sync automatically.">
      <TelegramLoginPanel channelId={existing.id} admin={admin} onConnected={onConnected} showInboxLink />
    </Card>
  ) : (
    <TelegramStart />
  );
}

/** One click: create the channel and start the QR login. */
function TelegramStart() {
  const [historyDays, setHistoryDays] = useState("30");
  const [ignoreGroups, setIgnoreGroups] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setErr(null);
    setBusy(true);
    try {
      const ch = await api<ChannelDTO>("/api/v1/channels", { body: { type: "telegram_user", name: "Telegram", config: { historyDays: Number(historyDays), ignoreGroups } } });
      await api(`/api/v1/channels/${ch.id}/connection`, { body: { action: "connect" } });
      invalidate("/api/v1/channels");
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-500/12 text-sky-600 dark:text-sky-400">
            <Send className="size-5" />
          </span>
          <div>
            <p className="font-medium text-fg">Link your Telegram account</p>
            <p className="text-sm text-muted">Scan one QR code with Telegram on your phone. Your private chats and groups — including recent messages — then sync automatically.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Recent messages to import" value={historyDays} onChange={(e) => setHistoryDays(e.target.value)} options={HISTORY} />
          <div className="sm:pt-6">
            <Checkbox checked={ignoreGroups} onChange={setIgnoreGroups} label="Skip group chats" />
          </div>
        </div>
        {err && <Callout tone="danger">{err}</Callout>}
        <Button variant="brand" size="lg" icon={<QrCode />} pending={busy} onClick={start} className="w-full">
          Show QR code
        </Button>
      </div>
    </Card>
  );
}

/* --------------------------- Login panel ---------------------------- */

type Action = "connect" | "disconnect" | "logout" | "resync" | "phone_login" | "code" | "password";

/** 1-second clock, only while a QR countdown is on screen. */
function useSecondTicker(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function TelegramLoginPanel({
  channelId,
  admin,
  onConnected,
  showInboxLink = false,
}: {
  channelId: string;
  admin: boolean;
  onConnected?: (channelId: string) => void;
  showInboxLink?: boolean;
}) {
  const path = connectionPath(channelId);
  const integ = useIntegrations();
  const [fast, setFast] = useState(true);
  const { data: conn, error, reload } = useApi<ConnectionDTO>(path, { refreshInterval: fast ? 2000 : 15_000, staleMs: 1000 });
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  /** Phone fallback: entering the number, or waiting for Telegram to send the code. */
  const [phoneStep, setPhoneStep] = useState<null | "form" | "sending">(null);
  const [qrAtPhoneSubmit, setQrAtPhoneSubmit] = useState<string | null>(null);
  /** The prompt (by its `at`) we already answered — show "Checking…" until a new one arrives. */
  const [answeredAt, setAnsweredAt] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const state = conn?.state ?? "disconnected";
  const prompt = conn?.prompt ?? null;
  const live = LIVE.has(state);
  const busy = state === "connecting" || state === "pairing" || state === "syncing" || phoneStep === "sending";
  useEffect(() => setFast(busy || !conn), [busy, conn]);
  useEffect(() => {
    if (conn && LIVE.has(conn.state)) onConnected?.(channelId);
  }, [conn, channelId, onConnected]);
  // Leave "sending the code" once Telegram asked for the code, or the server fell back to a new QR (e.g. invalid number).
  useEffect(() => {
    if (phoneStep !== "sending" || !conn) return;
    if (conn.prompt || LIVE.has(conn.state) || conn.state === "error" || (conn.qr && conn.qr !== qrAtPhoneSubmit)) setPhoneStep(null);
  }, [conn, phoneStep, qrAtPhoneSubmit]);
  useEffect(() => {
    if (phoneStep !== "sending") return;
    const t = setTimeout(() => setPhoneStep(null), 45_000);
    return () => clearTimeout(t);
  }, [phoneStep]);

  const run = async (action: Action, extra: Record<string, unknown> = {}) => {
    setActionError(null);
    setPending(action);
    try {
      const next = await api<ConnectionDTO>(path, { body: { action, ...extra } });
      setCached<ConnectionDTO>(path, () => next);
      setFast(true);
      return true;
    } catch (e) {
      setActionError(errorMessage(e));
      await reload();
      return false;
    } finally {
      setPending(null);
    }
  };

  const showQr = state === "pairing" && Boolean(conn?.qr) && !prompt && phoneStep === null;
  const now = useSecondTicker(showQr);

  if (!conn) {
    return error ? <Callout tone="danger">{errorMessage(error)}</Callout> : <div className="flex items-center gap-2 py-6 text-sm text-muted"><Spinner /> Loading connection…</div>;
  }
  if (integ && !integ.telegram && !live) return <TelegramNotConfigured admin={admin} />;
  if (!conn.syncAvailable) {
    return <Callout tone="warning" title="Live sync is off on this server">Telegram accounts need a long-running server. It&apos;s disabled here by <code>INFERA_SYNC=off</code> or <code>INFERA_WORKER=off</code>.</Callout>;
  }

  const waitingForAnswer = Boolean(prompt && answeredAt === prompt.at);
  const accountLine = conn.account ? [conn.account.name, conn.account.phone].filter(Boolean).join(" · ") : null;

  return (
    <div className="space-y-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <ConnectionBadge state={state} />
        {accountLine && <span className="text-sm text-fg-soft">{accountLine}</span>}
        {conn.lastSyncAt && state === "connected" && (
          <span className="text-xs text-muted">
            Last activity <TimeAgo date={conn.lastSyncAt} />
          </span>
        )}
      </div>

      {actionError && <Callout tone="danger">{actionError}</Callout>}

      {live ? (
        <Connected conn={conn} showInboxLink={showInboxLink} />
      ) : !admin ? (
        <p className="text-sm text-fg-soft">{state === "error" && conn.lastError ? conn.lastError : "An admin needs to finish linking this Telegram account."}</p>
      ) : prompt?.kind === "password" ? (
        waitingForAnswer ? (
          <Checking text="Checking your password…" />
        ) : (
          <PasswordForm
            prompt={prompt}
            pending={pending === "password"}
            onSubmit={async (password) => {
              if (await run("password", { password })) setAnsweredAt(prompt.at);
            }}
            onCancel={() => void run("connect")}
          />
        )
      ) : prompt?.kind === "code" ? (
        waitingForAnswer ? (
          <Checking text="Checking the code…" />
        ) : (
          <CodeForm
            prompt={prompt}
            pending={pending === "code"}
            onSubmit={async (code) => {
              if (await run("code", { code })) setAnsweredAt(prompt.at);
            }}
            onUseQr={() => void run("connect")}
          />
        )
      ) : phoneStep === "form" ? (
        <PhoneForm
          pending={pending === "phone_login"}
          onSubmit={async (phone) => {
            setQrAtPhoneSubmit(conn.qr);
            if (await run("phone_login", { phone })) setPhoneStep("sending");
          }}
          onBack={() => setPhoneStep(null)}
        />
      ) : phoneStep === "sending" ? (
        <Checking text="Asking Telegram to send you a login code…" />
      ) : showQr ? (
        <QrStep conn={conn} now={now} notice={conn.lastError} onRefresh={() => void run("connect")} refreshing={pending === "connect"} onUsePhone={() => setPhoneStep("form")} />
      ) : state === "pairing" && conn.lastError ? (
        // Waiting out a Telegram rate limit (the message says how long).
        <Callout tone="info" title="Telegram asked us to wait">
          {conn.lastError}
        </Callout>
      ) : state === "connecting" || state === "pairing" ? (
        <Checking text="Connecting to Telegram…" />
      ) : state === "error" ? (
        <Callout
          tone="danger"
          title="Telegram couldn't be linked"
          action={
            <Button size="sm" variant="brand" icon={<RefreshCw />} pending={pending === "connect"} onClick={() => void run("connect")}>
              Try again
            </Button>
          }
        >
          {conn.lastError ?? "Something went wrong while connecting to Telegram."}
        </Callout>
      ) : (
        <div className="space-y-3">
          {conn.lastError && <Callout tone="info">{conn.lastError}</Callout>}
          <Button variant="brand" icon={<QrCode />} pending={pending === "connect"} onClick={() => void run("connect")}>
            {state === "logged_out" ? "Link again with a QR code" : "Show QR code"}
          </Button>
        </div>
      )}

      {admin && live && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<RefreshCw />} pending={pending === "resync"} onClick={() => void run("resync")}>
            Import recent messages
          </Button>
          <Button size="sm" icon={<Unplug />} pending={pending === "disconnect"} onClick={() => void run("disconnect")}>
            Pause sync
          </Button>
          <Button size="sm" variant="danger-ghost" icon={<LogOut />} onClick={() => setConfirmLogout(true)}>
            Log out
          </Button>
        </div>
      )}
      {admin && !live && (state === "pairing" || state === "connecting") && (
        <Button size="sm" variant="ghost" icon={<Unplug />} pending={pending === "disconnect"} onClick={() => void run("disconnect")}>
          Cancel
        </Button>
      )}

      <ConfirmDialog
        open={confirmLogout}
        danger
        title="Log Infera out of Telegram?"
        body="Syncing stops and the stored login is deleted. Messages already imported stay in Infera."
        confirmLabel="Log out"
        onClose={() => setConfirmLogout(false)}
        onConfirm={async () => {
          await run("logout");
          setConfirmLogout(false);
        }}
      />
    </div>
  );
}

/* ------------------------------ Steps ------------------------------- */

function Checking({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 py-2 text-sm text-fg-soft">
      <Spinner /> {text}
    </p>
  );
}

function Connected({ conn, showInboxLink }: { conn: ConnectionDTO; showInboxLink: boolean }) {
  const progress = conn.progress;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4">
      <CircleCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-fg">Connected ✓</p>
        <p className="text-sm text-fg-soft">
          {conn.state === "syncing"
            ? `${progress?.message ?? "Importing recent messages…"}${progress?.done ? ` (${formatNumber(progress.done)})` : ""}`
            : (progress?.phase === "done" && progress.message) || "New Telegram messages arrive in Infera live."}
        </p>
        {showInboxLink && (
          <Link href="/console/inbox" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            Open Inbox <ArrowRight className="size-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

function QrStep({
  conn,
  now,
  notice,
  onRefresh,
  refreshing,
  onUsePhone,
}: {
  conn: ConnectionDTO;
  now: number;
  notice: string | null;
  onRefresh: () => void;
  refreshing: boolean;
  onUsePhone: () => void;
}) {
  const expiresAt = conn.qrExpiresAt ? new Date(conn.qrExpiresAt).getTime() : null;
  const left = expiresAt ? Math.round((expiresAt - now) / 1000) : null;
  // A new code normally replaces the old one right at expiry; if it doesn't arrive, offer a manual refresh.
  const expired = left !== null && left <= 0;
  const stuck = left !== null && left < -10;

  return (
    <div className="space-y-3">
      {notice && <Callout tone="info">{notice}</Callout>}
      <div className="grid gap-4 rounded-xl border border-line bg-sunken/30 p-4 sm:grid-cols-[auto_1fr]">
        <div className="relative justify-self-center">
          <div className={`rounded-xl bg-white p-3 transition-opacity duration-150 ${expired ? "opacity-30" : ""}`} role="img" aria-label="Telegram login QR code">
            <QRCodeSVG value={conn.qr!} size={200} level="M" />
          </div>
          {expired && (
            <div className="absolute inset-0 grid place-items-center">
              {stuck ? (
                <Button size="sm" variant="brand" icon={<RefreshCw />} pending={refreshing} onClick={onRefresh}>
                  New QR code
                </Button>
              ) : (
                <span className="flex items-center gap-2 rounded-full bg-elev px-3 py-1 text-xs text-fg-soft shadow-sm ring-1 ring-line">
                  <Spinner /> New code…
                </span>
              )}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-soft">
            <li>
              Open <b>Telegram</b> on your phone.
            </li>
            <li>
              Go to <b>Settings → Devices → Link Desktop Device</b>.
            </li>
            <li>Point your phone at this code.</li>
          </ol>
          <p className="text-xs text-muted">
            {stuck ? "This QR code expired." : expired ? "Getting a fresh code…" : left !== null ? `The code refreshes in ${left}s — scan whichever one you see.` : "The code refreshes about every 30 seconds."}
          </p>
          <button type="button" onClick={onUsePhone} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            <Phone className="size-4" /> Use phone number instead
          </button>
        </div>
      </div>
    </div>
  );
}

function PhoneForm({ pending, onSubmit, onBack }: { pending: boolean; onSubmit: (phone: string) => Promise<void>; onBack: () => void }) {
  const [phone, setPhone] = useState("");
  const valid = /^\+?[1-9][\d\s().-]{6,20}$/.test(phone.trim());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) void onSubmit(phone.trim().startsWith("+") ? phone.trim() : `+${phone.trim()}`);
  };
  return (
    <form className="space-y-3 rounded-xl border border-line bg-sunken/30 p-4" onSubmit={submit}>
      <p className="text-sm text-fg-soft">Telegram will send a login code to your Telegram app (or by SMS).</p>
      <TextField
        label="Phone number"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        placeholder="+91 98765 43210"
        hint="Include the country code."
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        leading={<Phone />}
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="brand" pending={pending} disabled={!valid}>
          Send code
        </Button>
        <Button type="button" variant="ghost" icon={<QrCode />} onClick={onBack}>
          Use QR code instead
        </Button>
      </div>
    </form>
  );
}

function CodeForm({
  prompt,
  pending,
  onSubmit,
  onUseQr,
}: {
  prompt: Extract<ConnectionPrompt, { kind: "code" }>;
  pending: boolean;
  onSubmit: (code: string) => Promise<void>;
  onUseQr: () => void;
}) {
  const [code, setCode] = useState("");
  const where =
    prompt.via === "app"
      ? "We sent a login code to your Telegram app — look for a message from “Telegram” on your other device."
      : prompt.via === "sms"
        ? `We sent a login code by SMS to ${prompt.phoneMasked ?? "your phone"}.`
        : prompt.via === "call"
          ? `Telegram is calling ${prompt.phoneMasked ?? "your phone"} with the login code.`
          : prompt.via === "email"
            ? "We sent a login code to your Telegram login email."
            : `We sent a login code to ${prompt.phoneMasked ?? "your phone"}.`;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) void onSubmit(code.trim());
  };
  return (
    <form className="space-y-3 rounded-xl border border-line bg-sunken/30 p-4" onSubmit={submit}>
      <p className="text-sm text-fg-soft">{where}</p>
      <TextField
        label="Login code"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        error={prompt.error}
        containerClassName="max-w-56"
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="brand" pending={pending} disabled={!code.trim()}>
          Continue
        </Button>
        <Button type="button" variant="ghost" icon={<QrCode />} onClick={onUseQr}>
          Use QR code instead
        </Button>
      </div>
    </form>
  );
}

function PasswordForm({
  prompt,
  pending,
  onSubmit,
  onCancel,
}: {
  prompt: Extract<ConnectionPrompt, { kind: "password" }>;
  pending: boolean;
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) void onSubmit(password).then(() => setPassword(""));
  };
  return (
    <form className="space-y-3 rounded-xl border border-line bg-sunken/30 p-4" onSubmit={submit}>
      <p className="text-sm text-fg-soft">This account has two-step verification. Enter your Telegram cloud password to finish linking.</p>
      <TextField
        label="Two-step verification password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={prompt.hint ? `Hint: ${prompt.hint}` : undefined}
        error={prompt.error}
        leading={<KeyRound />}
        containerClassName="max-w-sm"
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="brand" pending={pending} disabled={!password}>
          Unlock
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Start over
        </Button>
      </div>
    </form>
  );
}
