"use client";

/**
 * /console/connect — the first screen after signing in ("open the app"): connect your chats.
 *
 * Pick WhatsApp or Telegram at the top (`?with=whatsapp|telegram` deep-links a tab):
 *
 *  WhatsApp
 *  - Already connected (and no tab was requested) → straight to the Inbox.
 *  - A linked-device channel exists but isn't linked → its QR code, right here.
 *  - Nothing yet → choose: the official WhatsApp Business Platform (recommended,
 *    set up under Channels) or "Link with QR code" (experimental, syncs personal
 *    and group chats incl. recent history) with an explicit risk acknowledgement.
 *
 *  Telegram (personal account)
 *  - One click → QR code → (two-step password) → Connected ✓, with a phone-number fallback.
 *    Uses the server's Telegram API credentials; users never enter api_id / api_hash.
 *
 * Once linked, recent messages import automatically.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleCheck, MessageCircle, QrCode, Send, ShieldCheck } from "lucide-react";
import { api, invalidate, useApi } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/errors";
import type { ChannelDTO, ConnectionDTO } from "@/lib/shared/types";
import { Page, Card, Callout, Spinner } from "../kit/surface";
import { Badge } from "../kit/badges";
import { Button, Checkbox, RadioCards, Select } from "../kit/form";
import { Tabs } from "../kit/misc";
import { useSession } from "../session";
import { RiskNotice, WhatsAppLinkPanel } from "../channels/whatsapp-link";
import { TelegramConnect } from "./telegram-connect";

const LIVE = new Set<ConnectionDTO["state"]>(["connected", "syncing"]);

type Target = "whatsapp" | "telegram";

const INTRO: Record<Target, { title: string; text: string }> = {
  whatsapp: {
    title: "Connect your WhatsApp",
    text: "Link once — your chats and recent messages then sync automatically, and agents turn them into orders, leads, payments and follow-ups.",
  },
  telegram: {
    title: "Connect your Telegram",
    text: "Scan one QR code — your private chats and groups sync automatically, including recent messages.",
  },
};

export function ConnectPage() {
  const router = useRouter();
  // Read the requested tab after mount (keeps this route static; no Suspense needed for search params).
  const [target, setTarget] = useState<Target | null>(null);
  const [explicit, setExplicit] = useState(false);
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("with");
    setTarget(want === "telegram" ? "telegram" : "whatsapp");
    setExplicit(want === "telegram" || want === "whatsapp");
  }, []);

  const choose = (t: Target) => {
    setTarget(t);
    setExplicit(true);
    router.replace(`/console/connect?with=${t}`, { scroll: false });
  };

  const intro = INTRO[target ?? "whatsapp"];
  return (
    <Page>
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 text-center">
          <span
            className={`mx-auto grid size-12 place-items-center rounded-2xl ${target === "telegram" ? "bg-sky-500/12 text-sky-600 dark:text-sky-400" : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"}`}
          >
            {target === "telegram" ? <Send className="size-6" /> : <MessageCircle className="size-6" />}
          </span>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">{intro.title}</h1>
          <p className="mt-1 text-sm text-muted">{intro.text}</p>
        </div>

        <div className="mb-5 flex justify-center">
          <Tabs<Target>
            label="Choose what to connect"
            variant="pills"
            value={target ?? "whatsapp"}
            onChange={choose}
            items={[
              { id: "whatsapp", label: "WhatsApp", icon: <MessageCircle /> },
              { id: "telegram", label: "Telegram", icon: <Send /> },
            ]}
          />
        </div>

        {target === null ? (
          <div className="flex justify-center py-16 text-sm text-muted">
            <Spinner className="size-5" />
          </div>
        ) : target === "telegram" ? (
          <TelegramConnect />
        ) : (
          <WhatsAppConnect autoRedirect={!explicit} />
        )}

        <p className="mt-6 text-center text-xs text-muted">
          <Link href="/console" className="hover:text-fg hover:underline">Skip for now</Link>
          <span className="mx-2">·</span>
          <Link href="/console/channels?connect=messenger" className="hover:text-fg hover:underline">Messenger / Instagram</Link>
          <span className="mx-2">·</span>
          <Link href="/console/channels?connect=gmail" className="hover:text-fg hover:underline">Gmail</Link>
          <span className="mx-2">·</span>
          <Link href="/console/channels?connect=linkedin" className="hover:text-fg hover:underline">LinkedIn</Link>
          <span className="mx-2">·</span>
          <Link href="/console/channels" className="hover:text-fg hover:underline">All channels</Link>
        </p>
      </div>
    </Page>
  );
}

/* ------------------------------ WhatsApp ------------------------------ */

function WhatsAppConnect({ autoRedirect }: { autoRedirect: boolean }) {
  const router = useRouter();
  const { can, ready } = useSession();
  const admin = can("admin");
  const channels = useApi<{ items: ChannelDTO[] }>("/api/v1/channels");
  const web = channels.data?.items.find((c) => c.type === "whatsapp_web" && c.status === "active") ?? null;
  const cloud = channels.data?.items.find((c) => c.type === "whatsapp_cloud" && c.status === "active") ?? null;
  const conn = useApi<ConnectionDTO>(web ? `/api/v1/channels/${web.id}/connection` : null);
  const [linkedNow, setLinkedNow] = useState(false);
  const initial = useRef<"unknown" | "linked" | "unlinked">("unknown");

  // Already connected when the page opened (and no tab was asked for) → go straight to the Inbox.
  useEffect(() => {
    if (!channels.data || initial.current !== "unknown") return;
    if (cloud && !web) {
      initial.current = "linked";
      if (autoRedirect) router.replace("/console/inbox");
      return;
    }
    if (!web) {
      initial.current = "unlinked";
      return;
    }
    if (!conn.data) return;
    initial.current = LIVE.has(conn.data.state) ? "linked" : "unlinked";
    if (initial.current === "linked" && autoRedirect) router.replace("/console/inbox");
  }, [channels.data, conn.data, cloud, web, router, autoRedirect]);

  // Linked during this visit → show the confirmation, then open the Inbox.
  const onState = useCallback((state: ConnectionDTO["state"]) => {
    if (initial.current === "unlinked" && LIVE.has(state)) setLinkedNow(true);
  }, []);
  useEffect(() => {
    if (!linkedNow) return;
    const t = setTimeout(() => router.push("/console/inbox"), 2500);
    return () => clearTimeout(t);
  }, [linkedNow, router]);

  const loading = !channels.data || (web && !conn.data) || (initial.current === "linked" && autoRedirect);

  if (channels.error && !channels.data) return <Callout tone="danger">{errorMessage(channels.error)}</Callout>;
  if (loading || !ready) {
    return (
      <div className="flex justify-center py-16 text-sm text-muted">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (linkedNow) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CircleCheck className="size-10 text-emerald-500" />
          <p className="text-lg font-semibold text-fg">WhatsApp is connected</p>
          <p className="text-sm text-muted">Your recent messages are importing now and new ones arrive live. Opening your Inbox…</p>
          <Link href="/console/inbox" className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            Open Inbox now <ArrowRight className="size-4" />
          </Link>
        </div>
      </Card>
    );
  }
  if (initial.current === "linked") {
    // Opened explicitly (?with=whatsapp) while already connected.
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CircleCheck className="size-10 text-emerald-500" />
          <p className="text-lg font-semibold text-fg">WhatsApp is already connected</p>
          <Link href="/console/inbox" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            Open Inbox <ArrowRight className="size-4" />
          </Link>
        </div>
      </Card>
    );
  }
  if (!admin) {
    return (
      <Card>
        <p className="text-sm text-fg-soft">Only workspace admins can connect WhatsApp. Ask an admin to link it — or open the Inbox to see chats that are already syncing.</p>
        <Link href="/console/inbox" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">Open Inbox <ArrowRight className="size-4" /></Link>
      </Card>
    );
  }
  if (web) {
    return (
      <Card title={web.name} description="Scan the code with the phone that has this WhatsApp number.">
        <WhatsAppLinkPanel
          channelId={web.id}
          riskAcknowledged={web.config?.riskAcknowledged === true}
          canManage
          onState={onState}
          onAcknowledge={async () => {
            await api(`/api/v1/channels/${web.id}`, { method: "PATCH", body: { config: { riskAcknowledged: true, riskAcknowledgedAt: new Date().toISOString() } } });
            invalidate("/api/v1/channels");
          }}
        />
      </Card>
    );
  }
  return <SetupChoice onCreated={() => invalidate("/api/v1/channels")} />;
}

function SetupChoice({ onCreated }: { onCreated: () => void }) {
  const [method, setMethod] = useState<"cloud" | "qr">("cloud");
  const [historyDays, setHistoryDays] = useState("30");
  const [chatSelection, setChatSelection] = useState<"all" | "selected">("all");
  const [ignoreGroups, setIgnoreGroups] = useState(false);
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setErr(null);
    try {
      const ch = await api<ChannelDTO>("/api/v1/channels", {
        body: { type: "whatsapp_web", name: "WhatsApp", config: { riskAcknowledged: true, riskAcknowledgedAt: new Date().toISOString(), historyDays: Number(historyDays), ignoreGroups, chatSelection } },
      });
      await api(`/api/v1/channels/${ch.id}/connection`, { body: { action: "connect" } });
      onCreated();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <Card>
      <div className="space-y-4">
        <RadioCards<"cloud" | "qr">
          name="connect-method"
          value={method}
          onChange={setMethod}
          columns={2}
          legend="How should Infera connect?"
          options={[
            {
              value: "cloud",
              label: "WhatsApp Business Platform",
              icon: <ShieldCheck />,
              badge: <Badge tone="success">Recommended</Badge>,
              description: "Meta's official API for business numbers. Receives new customer messages; no ban risk.",
            },
            {
              value: "qr",
              label: "Link with QR code",
              icon: <QrCode />,
              badge: <Badge tone="warning">Experimental</Badge>,
              description: "Like WhatsApp Web: scan once, then all your chats — including recent messages — sync automatically.",
            },
          ]}
        />

        {method === "cloud" ? (
          <div className="space-y-3">
            <p className="text-sm text-fg-soft">You&apos;ll need your Meta app&apos;s phone number ID and a permanent access token.</p>
            <Link href="/console/channels?connect=cloud" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-medium text-white hover:brightness-110">
              Set up Business Platform <ArrowRight className="size-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Recent messages to import"
                value={historyDays}
                onChange={(e) => setHistoryDays(e.target.value)}
                options={[
                  { value: "7", label: "Last 7 days" },
                  { value: "30", label: "Last 30 days" },
                  { value: "90", label: "Last 90 days" },
                  { value: "0", label: "None — new messages only" },
                ]}
                hint="WhatsApp decides how much history it shares."
              />
              <div className="sm:pt-6">
                <Checkbox checked={ignoreGroups} onChange={setIgnoreGroups} label="Skip group chats" />
              </div>
            </div>
            <RadioCards<"all" | "selected">
              name="connect-agents"
              legend="Agents read"
              value={chatSelection}
              onChange={setChatSelection}
              columns={2}
              options={[
                { value: "all", label: "All chats", description: "Every chat is turned into records automatically." },
                { value: "selected", label: "Only chats I select", description: "Switch Agents on per chat in the Inbox." },
              ]}
            />
            <RiskNotice />
            <Checkbox checked={ack} onChange={setAck} label="I understand the risks and want to link my WhatsApp number." />
            {err && <Callout tone="danger">{err}</Callout>}
            <Button variant="brand" size="lg" icon={<QrCode />} disabled={!ack} onClick={start} className="w-full">
              Show QR code
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
