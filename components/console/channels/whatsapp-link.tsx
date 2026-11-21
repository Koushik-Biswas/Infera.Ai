"use client";

/**
 * Live connection panel for a WhatsApp linked-device channel: QR code (or
 * phone-number pairing code), connection state, history-sync progress and
 * connect / sync / disconnect / log-out controls.
 *
 * Follows `channel.status` realtime events (the realtime hook invalidates
 * `/api/v1/channels…`), with polling as a fallback while pairing or syncing.
 */
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { LogOut, Phone, PlugZap, QrCode, RefreshCw, Smartphone, Unplug } from "lucide-react";
import { api, setCached, useApi } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/errors";
import type { ConnectionDTO } from "@/lib/shared/types";
import { Callout, Spinner } from "../kit/surface";
import { ConnectionBadge } from "../kit/badges";
import { Button, Checkbox, TextField } from "../kit/form";
import { ConfirmDialog } from "../kit/overlay";
import { TimeAgo, useNow } from "../kit/misc";
import { formatNumber } from "@/lib/client/format";

export const connectionPath = (channelId: string) => `/api/v1/channels/${channelId}/connection`;

type Action = "connect" | "disconnect" | "logout" | "resync" | "pair_code";

export function RiskNotice() {
  return (
    <Callout tone="warning" title="Unofficial connection — use at your own risk">
      This links Infera as a WhatsApp Web-style device using an unofficial protocol. It is not Meta&apos;s API and is against WhatsApp&apos;s Terms of Service: WhatsApp may
      log the device out, restrict or ban the number. Prefer the official WhatsApp Business Platform for business-critical numbers, and avoid bulk or automated
      sending from a linked number.
    </Callout>
  );
}

export function WhatsAppLinkPanel({
  channelId,
  riskAcknowledged,
  canManage,
  onAcknowledge,
  onState,
}: {
  channelId: string;
  riskAcknowledged: boolean;
  canManage: boolean;
  onAcknowledge: () => Promise<void>;
  /** Called whenever the live connection state changes (e.g. to move on once linked). */
  onState?: (state: ConnectionDTO["state"]) => void;
}) {
  const path = connectionPath(channelId);
  const [fast, setFast] = useState(true);
  const { data: conn, error, reload } = useApi<ConnectionDTO>(path, { refreshInterval: fast ? 2500 : 20_000, staleMs: 1000 });
  const [actionError, setActionError] = useState<string | null>(null);
  const [usePhone, setUsePhone] = useState(false);
  const [phone, setPhone] = useState("");
  const [ack, setAck] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const now = useNow();

  const state = conn?.state ?? "disconnected";
  const busy = state === "connecting" || state === "pairing" || state === "syncing";
  useEffect(() => setFast(busy || !conn), [busy, conn]);
  useEffect(() => {
    if (conn) onState?.(conn.state);
  }, [conn, onState]);

  const run = async (action: Action, extra: Record<string, unknown> = {}) => {
    setActionError(null);
    try {
      const next = await api<ConnectionDTO>(path, { body: { action, ...extra } });
      setCached<ConnectionDTO>(path, () => next);
      setFast(true);
    } catch (e) {
      setActionError(errorMessage(e));
      await reload();
    }
  };

  if (!conn) {
    return error ? <Callout tone="danger">{errorMessage(error)}</Callout> : <div className="flex items-center gap-2 py-6 text-sm text-muted"><Spinner /> Loading connection…</div>;
  }

  if (!conn.syncAvailable) {
    return (
      <Callout tone="warning" title="Live sync is off on this server">
        WhatsApp linking needs a long-running server (Docker, a VM, <code>npm start</code> or <code>npm run dev</code>). It&apos;s disabled here by
        <code> INFERA_SYNC=off</code> or <code>INFERA_WORKER=off</code>.
      </Callout>
    );
  }

  const qrLeft = conn.qrExpiresAt ? Math.max(0, Math.round((new Date(conn.qrExpiresAt).getTime() - now) / 1000)) : null;
  const progress = conn.progress;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ConnectionBadge state={state} />
        {conn.live && state === "connected" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden /> Live
          </span>
        )}
        {conn.account && (
          <span className="text-sm text-fg-soft">
            {[conn.account.name, conn.account.phone].filter(Boolean).join(" · ")}
          </span>
        )}
        {conn.lastSyncAt && state === "connected" && (
          <span className="text-xs text-muted">
            Last activity <TimeAgo date={conn.lastSyncAt} />
          </span>
        )}
      </div>

      {conn.lastError && state !== "connected" && state !== "syncing" && <Callout tone={state === "error" ? "danger" : "info"}>{conn.lastError}</Callout>}
      {actionError && <Callout tone="danger">{actionError}</Callout>}

      {/* ---------- Not linked: start ---------- */}
      {(state === "disconnected" || state === "logged_out" || state === "error") && canManage && (
        <div className="space-y-3">
          {!riskAcknowledged && (
            <>
              <RiskNotice />
              <Checkbox checked={ack} onChange={setAck} label="I understand the risks and want to link this WhatsApp number." />
            </>
          )}
          <Button
            variant="brand"
            icon={<PlugZap />}
            disabled={!riskAcknowledged && !ack}
            onClick={async () => {
              if (!riskAcknowledged) await onAcknowledge();
              await run("connect");
            }}
          >
            {state === "error" ? "Reconnect" : conn.account || state === "disconnected" ? "Connect WhatsApp" : "Link again"}
          </Button>
        </div>
      )}

      {/* ---------- Starting ---------- */}
      {state === "connecting" && (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-sunken/40 px-4 py-6 text-sm text-fg-soft">
          <Spinner /> Opening a secure connection to WhatsApp… a QR code appears here in a few seconds.
        </div>
      )}

      {/* ---------- Pairing ---------- */}
      {state === "pairing" && (
        <div className="grid gap-5 rounded-xl border border-line bg-sunken/30 p-4 sm:grid-cols-[auto_1fr] sm:p-5">
          <div className="flex flex-col items-center gap-2">
            {conn.pairingCode ? (
              <div className="grid min-h-[220px] min-w-[220px] place-items-center rounded-xl bg-white p-4 text-center">
                <div>
                  <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Pairing code</p>
                  <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.2em] text-neutral-900">{conn.pairingCode}</p>
                </div>
              </div>
            ) : conn.qr ? (
              <div className="rounded-xl bg-white p-3" aria-label="WhatsApp pairing QR code" role="img">
                <QRCodeSVG value={conn.qr} size={220} level="L" bgColor="#ffffff" fgColor="#0b0b10" />
              </div>
            ) : (
              <div className="grid size-[244px] place-items-center rounded-xl border border-dashed border-line text-sm text-muted">
                <span className="flex items-center gap-2"><Spinner /> Refreshing code…</span>
              </div>
            )}
            {!conn.pairingCode && conn.qr && qrLeft !== null && <p className="text-xs text-muted tabular-nums">New code in {qrLeft}s</p>}
          </div>
          <div className="min-w-0 space-y-3 text-sm">
            <p className="font-medium text-fg">{conn.pairingCode ? "Enter this code on your phone" : "Scan with WhatsApp on your phone"}</p>
            <ol className="list-decimal space-y-1 pl-5 text-fg-soft">
              <li>Open <b>WhatsApp</b> on the phone with this number.</li>
              <li>
                Go to <b>Settings</b> (iPhone) or <b>⋮ Menu</b> (Android) → <b>Linked devices</b> → <b>Link a device</b>.
              </li>
              {conn.pairingCode ? (
                <li>
                  Tap <b>Link with phone number instead</b> and type the code shown here.
                </li>
              ) : (
                <li>Point the camera at this QR code.</li>
              )}
            </ol>
            <p className="text-xs text-muted">Your chats then sync automatically. Keep the phone online for the first few minutes while history imports.</p>

            {canManage && !conn.pairingCode && (
              <div className="pt-1">
                {usePhone ? (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run("pair_code", { phone });
                    }}
                  >
                    <TextField
                      label="WhatsApp number"
                      hint="With country code, e.g. +919876543210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      inputMode="tel"
                      autoComplete="tel"
                      leading={<Phone />}
                      containerClassName="min-w-56 flex-1"
                      required
                    />
                    <Button type="submit" variant="secondary">
                      Get code
                    </Button>
                  </form>
                ) : (
                  <Button variant="ghost" size="sm" icon={<Smartphone />} onClick={() => setUsePhone(true)}>
                    Can&apos;t scan? Link with phone number
                  </Button>
                )}
              </div>
            )}
            {canManage && (
              <Button variant="ghost" size="sm" icon={<Unplug />} onClick={() => run("disconnect")}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ---------- History import ---------- */}
      {state === "syncing" && (
        <div className="space-y-2 rounded-xl border border-line bg-sunken/30 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-fg">
            <Spinner /> {progress?.message ?? "Importing chat history…"}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full w-1/3 animate-[pulse_1.5s_ease-in-out_infinite] rounded-full bg-brand" />
          </div>
          <p className="text-xs text-muted">{formatNumber(progress?.done ?? 0)} messages imported so far. New messages already arrive live.</p>
        </div>
      )}

      {state === "connected" && progress?.phase === "done" && progress.message && <p className="text-xs text-muted">{progress.message}</p>}

      {/* ---------- Connected controls ---------- */}
      {(state === "connected" || state === "syncing") && canManage && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<RefreshCw />} onClick={() => run("resync")}>
            Sync now
          </Button>
          <Button size="sm" icon={<Unplug />} onClick={() => run("disconnect")}>
            Pause sync
          </Button>
          <Button size="sm" variant="danger-ghost" icon={<LogOut />} onClick={() => setConfirmLogout(true)}>
            Unlink device
          </Button>
        </div>
      )}

      {state === "pairing" && !conn.qr && !conn.pairingCode && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <QrCode className="size-3.5" /> Waiting for WhatsApp to issue a code…
        </p>
      )}

      <ConfirmDialog
        open={confirmLogout}
        danger
        title="Unlink this WhatsApp device?"
        body="Infera is removed from the phone's Linked devices and stops syncing. Messages already imported stay in Infera. You can link again any time with a new QR code."
        confirmLabel="Unlink"
        onClose={() => setConfirmLogout(false)}
        onConfirm={async () => {
          await run("logout");
          setConfirmLogout(false);
        }}
      />
    </div>
  );
}
