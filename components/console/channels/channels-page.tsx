"use client";

/**
 * /console/channels — connected channels with live status, and the
 * "Connect WhatsApp" wizard:
 *   - WhatsApp Business Platform (official Cloud API) — recommended default.
 *   - Link with QR code (EXPERIMENTAL linked device) — explicit risk acknowledgement,
 *     then the live QR / pairing-code panel; chats sync automatically after the scan.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Cable, Mail, MessageCircle, MessagesSquare, Pause, Play, Plus, QrCode, Send, ShieldCheck, Trash2 } from "lucide-react";
import { api, invalidate, useApi } from "@/lib/client/api";
import { errorMessage, fieldErrors } from "@/lib/client/errors";
import { channelLabel } from "@/lib/client/format";
import { isPersistentChannel, type ChannelDTO } from "@/lib/shared/types";
import { useSession } from "../session";
import { Page, PageHeader, Card, EmptyState, Callout, KeyValue } from "../kit/surface";
import { CardSkeleton } from "../kit/skeleton";
import { Badge, ChannelIcon } from "../kit/badges";
import { Button, Checkbox, IconButton, RadioCards, Select, TextField } from "../kit/form";
import { ConfirmDialog, Dialog } from "../kit/overlay";
import { CopyButton, ErrorState, TimeAgo } from "../kit/misc";
import { RiskNotice, WhatsAppLinkPanel } from "./whatsapp-link";
import { MetaChannelPanel, MetaConnectDialog } from "./meta-connect";
import { GmailConnectDialog, LinkedInConnectDialog, LinkedInPanel, LiveConnectionPanel } from "./more-connect";
import { TELEGRAM_CONNECT_PATH } from "../connect/telegram-connect";
import { Menu, MenuItem } from "../kit/overlay";

const LIST = "/api/v1/channels";

export function ChannelsPage() {
  const { can } = useSession();
  const router = useRouter();
  const admin = can("admin");
  const { data, error, loading, reload } = useApi<{ items: ChannelDTO[] }>(LIST);
  const [wizard, setWizard] = useState(false);
  const [meta, setMeta] = useState<false | "messenger" | "instagram">(false);
  const [more, setMore] = useState<null | "gmail" | "linkedin">(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  // Deep links: ?connect=cloud|messenger|instagram|telegram|gmail|linkedin, and OAuth / LinkedIn returns.
  // Telegram accounts are linked on /console/connect (QR code; no API credentials).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const want = q.get("connect");
    if (want === "telegram") {
      router.replace(TELEGRAM_CONNECT_PATH);
      return;
    }
    if (want === "messenger" || want === "instagram") setMeta(want);
    else if (want === "gmail" || want === "linkedin") setMore(want);
    else if (want) setWizard(true);
    const g = q.get("google");
    if (g) setNotice(g === "connected" ? { tone: "success", text: "Gmail is connected — recent email is importing and new mail arrives live." } : { tone: "danger", text: g === "cancelled" ? "Google sign-in was cancelled." : "Google sign-in failed. Try again, or use an app password." });
    const l = q.get("linkedin");
    if (l) setNotice(l === "connected" ? { tone: "success", text: "LinkedIn is connected — recent conversations are importing." } : { tone: "danger", text: "LinkedIn login wasn't completed. Try again." });
  }, []);
  const channels = (data?.items ?? []).filter((c) => c.type !== "whatsapp_export");
  const hasWhatsApp = channels.some((c) => c.type === "whatsapp_web" || c.type === "whatsapp_cloud");

  return (
    <Page>
      <PageHeader
        title="Channels"
        description="Where Infera receives conversations. New messages are captured, organised and searchable within seconds."
        actions={
          admin && (
            <>
              <Menu label="Connect another channel" placement="bottom-end" trigger={({ props }) => <Button icon={<Plus />} {...props}>More channels</Button>}>
                <MenuItem icon={<MessagesSquare />} description="Facebook Page or Instagram DMs" onSelect={() => setMeta("messenger")}>Messenger / Instagram</MenuItem>
                <MenuItem icon={<Send />} description="Your account — chats and groups" onSelect={() => router.push(TELEGRAM_CONNECT_PATH)}>Telegram</MenuItem>
                <MenuItem icon={<Mail />} description="Google sign-in or app password" onSelect={() => setMore("gmail")}>Gmail / email</MenuItem>
                <MenuItem icon={<Briefcase />} description="Notification emails or Unipile" onSelect={() => setMore("linkedin")}>LinkedIn</MenuItem>
              </Menu>
              <Button variant="brand" icon={<Plus />} onClick={() => setWizard(true)}>
                Connect WhatsApp
              </Button>
            </>
          )
        }
      />

      {notice && (
        <Callout tone={notice.tone} className="mb-4">
          {notice.text}
        </Callout>
      )}
      {error && !data ? (
        <ErrorState error={error} retry={reload} />
      ) : loading ? (
        <div className="grid gap-4">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={3} />
        </div>
      ) : (
        <div className="grid gap-4">
          {!hasWhatsApp && (
            <Card>
              <EmptyState
                icon={<MessageCircle />}
                title="Connect WhatsApp"
                body="Link your WhatsApp number and Infera turns every chat into contacts, orders, leads and follow-ups automatically."
                action={
                  admin ? (
                    <Button variant="brand" icon={<Plus />} onClick={() => setWizard(true)}>
                      Connect WhatsApp
                    </Button>
                  ) : (
                    <p className="text-sm text-muted">Ask a workspace admin to connect WhatsApp.</p>
                  )
                }
              />
            </Card>
          )}
          {channels.map((c) => (
            <ChannelCard key={c.id} channel={c} admin={admin} />
          ))}
        </div>
      )}

      <ConnectWhatsAppDialog open={wizard} onClose={() => setWizard(false)} />
      <MetaConnectDialog key={meta || "closed"} open={Boolean(meta)} initial={meta || "messenger"} onClose={() => setMeta(false)} />
      <GmailConnectDialog key={`gm-${more === "gmail"}`} open={more === "gmail"} onClose={() => setMore(null)} />
      <LinkedInConnectDialog key={`li-${more === "linkedin"}`} open={more === "linkedin"} onClose={() => setMore(null)} onGmail={() => setMore("gmail")} />
    </Page>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function ChannelCard({ channel: c, admin }: { channel: ChannelDTO; admin: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const paused = c.status === "paused";

  const patch = async (body: Record<string, unknown>) => {
    setErr(null);
    try {
      await api(`${LIST}/${c.id}`, { method: "PATCH", body });
      invalidate(LIST);
    } catch (e) {
      setErr(errorMessage(e));
      throw e;
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2.5">
          <ChannelIcon type={c.type} size="md" />
          <span className="min-w-0">
            <span className="block truncate">{c.name}</span>
            <span className="block text-xs font-normal text-muted">{channelLabel(c.type)}</span>
          </span>
          {c.type === "whatsapp_web" && <Badge tone="warning">Experimental</Badge>}
          {(c.type === "whatsapp_cloud" || c.type === "messenger" || c.type === "instagram") && (
            <Badge tone="success" icon={<ShieldCheck />}>
              Official
            </Badge>
          )}
          {paused && <Badge tone="muted">Paused</Badge>}
        </span>
      }
      actions={
        admin && (
          <>
            <IconButton label={paused ? "Resume channel" : "Pause channel"} onClick={() => void patch({ status: paused ? "active" : "paused" }).catch(() => {})}>
              {paused ? <Play /> : <Pause />}
            </IconButton>
            <IconButton label="Delete channel" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
            </IconButton>
          </>
        )
      }
    >
      {err && <Callout tone="danger" className="mb-3">{err}</Callout>}
      {paused ? (
        <p className="text-sm text-muted">This channel is paused: nothing is received or synced until you resume it.</p>
      ) : c.type === "whatsapp_web" ? (
        <WhatsAppLinkPanel channelId={c.id} riskAcknowledged={c.config?.riskAcknowledged === true} canManage={admin} onAcknowledge={() => patch({ config: { riskAcknowledged: true, riskAcknowledgedAt: new Date().toISOString() } })} />
      ) : c.type === "messenger" || c.type === "instagram" ? (
        <MetaChannelPanel channel={c} admin={admin} />
      ) : c.type === "telegram_user" || c.type === "email_imap" ? (
        <LiveConnectionPanel channel={c} admin={admin} />
      ) : c.type === "linkedin" ? (
        <LinkedInPanel channel={c} admin={admin} />
      ) : isPersistentChannel(c.type) ? (
        <p className="text-sm text-muted">Live connection channel.</p>
      ) : (
        <WebhookDetails channel={c} />
      )}

      <ConfirmDialog
        open={confirmDelete}
        danger
        title={`Delete "${c.name}"?`}
        body="The channel, its conversations and messages are removed from Infera. Records already extracted into collections stay. This can't be undone."
        confirmLabel="Delete channel"
        requireText={c.name}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api(`${LIST}/${c.id}`, { method: "DELETE" });
          setConfirmDelete(false);
          invalidate(LIST);
        }}
      />
    </Card>
  );
}

function WebhookDetails({ channel: c }: { channel: ChannelDTO }) {
  return (
    <div className="space-y-3">
      <KeyValue
        items={[
          {
            label: "Status",
            value: c.lastError ? <Badge tone="danger">Error</Badge> : c.lastEventAt ? <Badge tone="success">Receiving</Badge> : <Badge tone="neutral">Waiting for the first message</Badge>,
          },
          { label: "Last message", value: c.lastEventAt ? <TimeAgo date={c.lastEventAt} /> : "—" },
          ...(c.webhookUrl
            ? [
                {
                  label: "Webhook URL",
                  value: (
                    <span className="flex min-w-0 items-center gap-2">
                      <code className="truncate text-xs">{c.webhookUrl}</code>
                      <CopyButton value={c.webhookUrl} iconOnly size="xs" />
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
      {c.lastError && <Callout tone="danger">{c.lastError}</Callout>}
    </div>
  );
}

/* ------------------------------------- Connect wizard -------------------------------------- */

type Method = "cloud" | "qr";

function ConnectWhatsAppDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [method, setMethod] = useState<Method>("cloud");
  const [name, setName] = useState("WhatsApp");
  // QR
  const [ack, setAck] = useState(false);
  const [historyDays, setHistoryDays] = useState("90");
  const [ignoreGroups, setIgnoreGroups] = useState(false);
  const [chatSelection, setChatSelection] = useState<"all" | "selected">("all");
  // Cloud API
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState<ChannelDTO | null>(null);
  const [cloudDone, setCloudDone] = useState<{ channel: ChannelDTO; verifyToken: string | null } | null>(null);

  const reset = () => {
    setLinking(null);
    setCloudDone(null);
    setError(null);
    setFields({});
    setAck(false);
    setAccessToken("");
    setAppSecret("");
  };
  const close = () => {
    onClose();
    // Let the closing animation finish before clearing.
    setTimeout(reset, 200);
  };

  const submit = async () => {
    setError(null);
    setFields({});
    try {
      if (method === "qr") {
        const ch = await api<ChannelDTO>(LIST, {
          body: { type: "whatsapp_web", name, config: { riskAcknowledged: true, riskAcknowledgedAt: new Date().toISOString(), historyDays: Number(historyDays), ignoreGroups, chatSelection } },
        });
        invalidate(LIST);
        await api(`${LIST}/${ch.id}/connection`, { body: { action: "connect" } });
        setLinking(ch);
      } else {
        const secrets: Record<string, string> = { accessToken };
        if (appSecret.trim()) secrets.appSecret = appSecret.trim();
        const ch = await api<ChannelDTO & { generatedSecrets?: Record<string, string> }>(LIST, {
          body: { type: "whatsapp_cloud", name, externalId: phoneNumberId.trim(), secrets },
        });
        invalidate(LIST);
        setCloudDone({ channel: ch, verifyToken: ch.generatedSecrets?.verifyToken ?? null });
      }
    } catch (e) {
      setError(errorMessage(e));
      setFields(fieldErrors(e));
    }
  };

  const title = linking ? "Link your WhatsApp" : cloudDone ? "Finish in Meta" : "Connect WhatsApp";

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={title}
      description={linking ? "Scan the code with the phone that has this WhatsApp number." : cloudDone ? undefined : "Choose how Infera connects to your WhatsApp number."}
      footer={
        linking || cloudDone ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="brand" onClick={submit} disabled={method === "qr" ? !ack || !name.trim() : !phoneNumberId.trim() || !accessToken.trim() || !name.trim()}>
              {method === "qr" ? "Continue to QR code" : "Connect"}
            </Button>
          </>
        )
      }
    >
      {linking ? (
        <WhatsAppLinkPanel channelId={linking.id} riskAcknowledged canManage onAcknowledge={async () => {}} />
      ) : cloudDone ? (
        <div className="space-y-3 text-sm">
          <Callout tone="success" title="Channel created">
            In the Meta App Dashboard → WhatsApp → Configuration, set the callback URL below and subscribe to the <b>messages</b> field (and <b>history</b> /
            <b> smb_message_echoes</b> if you use the WhatsApp Business app on the same number).
          </Callout>
          <KeyValue
            items={[
              {
                label: "Callback URL",
                value: cloudDone.channel.webhookUrl ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <code className="truncate text-xs">{cloudDone.channel.webhookUrl}</code>
                    <CopyButton value={cloudDone.channel.webhookUrl} iconOnly size="xs" />
                  </span>
                ) : (
                  "—"
                ),
              },
              {
                label: "Verify token",
                value: cloudDone.verifyToken ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <code className="truncate text-xs">{cloudDone.verifyToken}</code>
                    <CopyButton value={cloudDone.verifyToken} iconOnly size="xs" />
                  </span>
                ) : (
                  "Use the server's WHATSAPP_VERIFY_TOKEN"
                ),
              },
            ]}
          />
          {cloudDone.verifyToken && <p className="text-xs text-muted">The verify token is shown only once — copy it now.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <RadioCards<Method>
            name="wa-method"
            value={method}
            onChange={setMethod}
            columns={2}
            options={[
              {
                value: "cloud",
                label: "WhatsApp Business Platform",
                icon: <ShieldCheck />,
                badge: <Badge tone="success">Recommended</Badge>,
                description: "Meta's official Cloud API. Safe for business numbers; receives new messages (plus history with the Business app coexistence).",
              },
              {
                value: "qr",
                label: "Link with QR code",
                icon: <QrCode />,
                badge: <Badge tone="warning">Experimental</Badge>,
                description: "Like WhatsApp Web: scan once, then every personal and group chat syncs live, including recent history.",
              },
            ]}
          />

          <TextField label="Channel name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} error={fields.name} required />

          {method === "qr" ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Import history"
                  value={historyDays}
                  onChange={(e) => setHistoryDays(e.target.value)}
                  options={[
                    { value: "0", label: "No history — new messages only" },
                    { value: "30", label: "Last 30 days" },
                    { value: "90", label: "Last 90 days" },
                    { value: "365", label: "Last 12 months" },
                  ]}
                  hint="WhatsApp decides how much history it shares with a new device."
                />
                <div className="pt-6">
                  <Checkbox checked={ignoreGroups} onChange={setIgnoreGroups} label="Skip group chats" description="Only import one-to-one conversations." />
                </div>
              </div>
              <RadioCards<"all" | "selected">
                name="wa-agents"
                legend="Agents read"
                value={chatSelection}
                onChange={setChatSelection}
                columns={2}
                options={[
                  { value: "all", label: "All chats", description: "Every chat is turned into records automatically." },
                  { value: "selected", label: "Only chats I select", description: "Chats sync and are searchable; switch Agents on per chat in the Inbox." },
                ]}
              />
              <RiskNotice />
              <Checkbox checked={ack} onChange={setAck} label="I understand the risks and want to link this WhatsApp number." />
            </div>
          ) : (
            <div className="space-y-3">
              <TextField
                label="Phone number ID"
                hint="Meta App Dashboard → WhatsApp → API Setup (digits, not the phone number)."
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                inputMode="numeric"
                error={fields.externalId}
                required
              />
              <TextField
                label="Access token"
                hint="A permanent System User token with whatsapp_business_messaging."
                type="password"
                autoComplete="off"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                error={fields["secrets.accessToken"]}
                required
              />
              <TextField
                label="App secret"
                hint="App settings → Basic. Leave empty if this server uses a shared Meta app (WHATSAPP_APP_SECRET)."
                type="password"
                autoComplete="off"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                error={fields["secrets.appSecret"]}
              />
            </div>
          )}

          {error && <Callout tone="danger">{error}</Callout>}
          {method === "qr" && <p className="flex items-center gap-1.5 text-xs text-muted"><Cable className="size-3.5" /> Credentials are encrypted at rest; message text is never written to logs.</p>}
        </div>
      )}
    </Dialog>
  );
}
