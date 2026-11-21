"use client";

/**
 * /console — Overview dashboard: range tabs, KPI tiles, activity chart,
 * categories / sources / priorities, pipeline health, collections, recent
 * activity, a "needs review" callout and a getting-started checklist.
 */
import { startTransition, useState, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, Cable, CircleCheck, Circle, Clock, FlaskConical, FolderKanban, Gauge, ListChecks, MessagesSquare, Sparkles, Database, UserPlus, X } from "lucide-react";
import { CollectionIcon, Status, money } from "@/components/app/ui-base";
import { prefetchApi, useApi } from "@/lib/client/api";
import type { AnalyticsDTO, ChannelDTO, CollectionDTO, EventDTO, MemberDTO, Page as PageOf } from "@/lib/shared/types";
import { SOURCE_CHANNEL, categoryLabel, formatDuration, formatNumber, formatPercent, intentLabel, sourceLabel } from "@/lib/client/format";
import { useSession } from "./session";
import { useReviewCount } from "./shell";
import { Page, PageHeader, Card, StatCard, KeyValue, EmptyState, Callout } from "./kit/surface";
import { Skeleton, SkeletonText, StatGridSkeleton } from "./kit/skeleton";
import { ChannelIcon, EventStatusBadge } from "./kit/badges";
import { buttonCls, IconButton } from "./kit/form";
import { DataTable } from "./kit/table";
import { ErrorState, Tabs, TimeAgo } from "./kit/misc";

const ActivityChart = dynamic(() => import("./charts").then((m) => m.ActivityChart), {
  loading: () => <Skeleton className="h-[256px] w-full rounded-xl" />,
});
const BarList = dynamic(() => import("./charts").then((m) => m.BarList), {
  loading: () => <SkeletonText lines={5} />,
});
const PrioritySplit = dynamic(() => import("./charts").then((m) => m.PrioritySplit), {
  loading: () => <Skeleton className="h-[52px] w-full rounded-lg" />,
});

type Range = "7" | "30" | "90";
const RANGES: { id: Range; label: string }[] = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
];

/** Analytics path for a range — also used by the sidebar's Overview warm-up (30 days). */
export const analyticsPath = (days: Range | number) => `/api/v1/analytics?days=${days}`;
const EVENTS_PATH = "/api/v1/events?limit=10";

/* ------------------------- Getting started ------------------------- */

const dismissKey = (ws: string) => `infera:getting-started:${ws}`;
const dismissSubs = new Set<() => void>();
function subscribeDismiss(cb: () => void) {
  dismissSubs.add(cb);
  return () => dismissSubs.delete(cb);
}
function readDismissed(ws: string | undefined) {
  if (!ws) return true;
  try {
    return localStorage.getItem(dismissKey(ws)) === "1";
  } catch {
    return false;
  }
}

function GettingStarted({ workspaceId, hasMessages }: { workspaceId: string; hasMessages: boolean }) {
  const { can } = useSession();
  const dismissed = useSyncExternalStore(subscribeDismiss, () => readDismissed(workspaceId), () => true);
  const admin = can("admin");
  const member = can("member");
  const channels = useApi<{ items: ChannelDTO[] }>(dismissed ? null : "/api/v1/channels", { staleMs: 60_000 });
  const collections = useApi<{ items: CollectionDTO[] }>(dismissed ? null : "/api/v1/collections", { staleMs: 60_000 });
  const members = useApi<{ items: MemberDTO[] }>(dismissed || !admin ? null : "/api/v1/members", { staleMs: 60_000 });
  // Same cache key as "Recent activity" — one request serves both.
  const events = useApi<PageOf<EventDTO>>(dismissed ? null : EVENTS_PATH);
  if (dismissed || !member) return null;
  const anyMessages = hasMessages || Boolean(events.data?.items.length);

  const steps = [
    admin && {
      key: "channel",
      title: "Connect a channel",
      body: "WhatsApp, Telegram, email, Slack, SMS or the API — messages start flowing in.",
      href: "/console/connect",
      icon: <Cable />,
      done: Boolean(channels.data?.items.some((c) => c.type !== "api")),
    },
    {
      key: "test",
      title: "Send a test message",
      body: "Try the playground to see classification and extraction on your own text.",
      href: "/console/playground",
      icon: <FlaskConical />,
      done: anyMessages,
    },
    {
      key: "collection",
      title: "Create a collection",
      body: "Orders, leads, payments… tables that fill themselves from conversations.",
      href: "/console/collections",
      icon: <FolderKanban />,
      done: Boolean(collections.data?.items.length),
    },
    admin && {
      key: "invite",
      title: "Invite teammates",
      body: "Give your team access with the right role.",
      href: "/console/settings/members",
      icon: <UserPlus />,
      done: (members.data?.items.length ?? 0) > 1,
    },
  ].filter(Boolean) as { key: string; title: string; body: string; href: string; icon: ReactNode; done: boolean }[];

  // Wait for the step data so a finished checklist never flashes up.
  const loaded = collections.data !== undefined && (!admin || (channels.data !== undefined && members.data !== undefined));
  const failed = Boolean(collections.error || (admin && (channels.error || members.error)));
  const doneCount = steps.filter((s) => s.done).length;
  if (!loaded || failed || doneCount === steps.length) return null;

  function dismiss() {
    try {
      localStorage.setItem(dismissKey(workspaceId), "1");
    } catch {
      /* private mode */
    }
    for (const cb of dismissSubs) cb();
  }

  return (
    <Card
      className="mb-4"
      title="Get started"
      description={`${doneCount} of ${steps.length} done — a few steps to turn conversations into structured records.`}
      actions={
        <IconButton label="Hide getting started" size="sm" onClick={dismiss}>
          <X />
        </IconButton>
      }
    >
      <div aria-hidden className="mb-3 h-1.5 overflow-hidden rounded-full bg-brand/12">
        <div className="h-full rounded-full bg-brand transition-[width] duration-150" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className={`flex h-full items-start gap-3 rounded-xl border p-3 transition-colors duration-150 ${s.done ? "border-line bg-sunken/50" : "border-line bg-elev hover:border-brand/40 hover:bg-brand/4"}`}
            >
              <span className={`mt-0.5 shrink-0 [&>svg]:size-4 ${s.done ? "text-emerald-600 dark:text-emerald-400" : "text-muted"}`} aria-hidden>
                {s.done ? <CircleCheck /> : <Circle />}
              </span>
              <span className="min-w-0">
                <span className={`flex items-center gap-1.5 text-sm font-medium ${s.done ? "text-muted line-through decoration-line-strong" : "text-fg"}`}>
                  {s.title}
                  <span className="sr-only">{s.done ? " (done)" : ""}</span>
                </span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">{s.body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* -------------------------- Recent activity ------------------------- */

function RecentActivity() {
  const { data, error, loading, reload } = useApi<PageOf<EventDTO>>(EVENTS_PATH, { refreshInterval: 30_000 });
  return (
    <Card
      title="Recent activity"
      description="Latest messages through the pipeline"
      padded={false}
      actions={
        <Link href="/console/inbox" className="text-[13px] font-medium text-brand hover:underline">
          Inbox
        </Link>
      }
      className="h-full"
    >
      {loading ? (
        <ul className="flex flex-col" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 border-t border-line px-4 py-3 sm:px-5">
              <Skeleton className="size-6 rounded-md" />
              <span className="flex-1">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="mt-1.5 h-3 w-1/3" />
              </span>
              <Skeleton className="h-5 w-20 rounded-full" />
            </li>
          ))}
        </ul>
      ) : error && !data ? (
        <ErrorState compact error={error} retry={reload} />
      ) : !data?.items.length ? (
        <EmptyState compact icon={<MessagesSquare />} title="No messages yet" body="Messages appear here as soon as a channel delivers them." />
      ) : (
        <ul className="flex flex-col">
          {data.items.map((ev) => {
            const cls = ev.result?.message_classification;
            const title = cls ? `${categoryLabel(cls.category)} · ${intentLabel(cls.intent)}` : `${sourceLabel(ev.source)} message`;
            return (
              <li key={ev.id} className="border-t border-line">
                <Link
                  href={`/console/inbox?message=${encodeURIComponent(ev.messageId)}`}
                  onMouseEnter={() => prefetchApi(`/api/v1/messages/${ev.messageId}`)}
                  onFocus={() => prefetchApi(`/api/v1/messages/${ev.messageId}`)}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-100 hover:bg-sunken/70 sm:px-5"
                >
                  <ChannelIcon type={SOURCE_CHANNEL[ev.source] ?? "api"} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{title}</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      <TimeAgo date={ev.createdAt} />
                      {ev.durationMs != null && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{formatDuration(ev.durationMs)}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <EventStatusBadge status={ev.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------ Overview ---------------------------- */

/** The overview dashboard (client component rendered by `app/console/page.tsx`). */
export function Overview() {
  const { workspace } = useSession();
  const [range, setRange] = useState<Range>("30");
  const { data, error, loading, isPreviousData, reload } = useApi<AnalyticsDTO>(analyticsPath(range), { keepPreviousData: true });
  const openReviews = useReviewCount();
  const currency = workspace?.settings.currency ?? "INR";
  const t = data?.totals;
  const reviews = Math.max(openReviews, t?.openReviews ?? 0);
  const dim = isPreviousData;

  return (
    <Page>
      <PageHeader
        title="Overview"
        description={workspace ? `What's happening in ${workspace.name}.` : "What's happening in your workspace."}
        actions={<Tabs label="Date range" variant="pills" items={RANGES} value={range} onChange={(v) => startTransition(() => setRange(v))} />}
      />

      {reviews > 0 && (
        <Callout
          tone="warning"
          className="mb-4"
          icon={<ListChecks className="text-amber-600 dark:text-amber-400" />}
          title={`${formatNumber(reviews)} item${reviews === 1 ? "" : "s"} need${reviews === 1 ? "s" : ""} review`}
          action={
            <Link href="/console/review" onMouseEnter={() => prefetchApi("/api/v1/review?status=open")} className={buttonCls("secondary", "sm")}>
              Open review queue <ArrowRight className="size-4" aria-hidden />
            </Link>
          }
        >
          Low-confidence values, conflicts and missing required fields wait for a person before they&apos;re applied.
        </Callout>
      )}

      {workspace && <GettingStarted workspaceId={workspace.id} hasMessages={Boolean(t && t.messages > 0)} />}

      {loading ? (
        <StatGridSkeleton count={6} />
      ) : error && !data ? (
        <Card>
          <ErrorState compact error={error} retry={reload} title={error.status === 404 ? "Analytics aren't available yet" : undefined} />
        </Card>
      ) : t && data ? (
        <div className={`grid grid-cols-2 gap-3 transition-opacity duration-150 md:grid-cols-3 xl:grid-cols-6 ${dim ? "opacity-60" : ""}`} aria-busy={dim || undefined}>
          <StatCard label="Messages" value={formatNumber(t.messages, { compact: true })} hint={`${formatNumber(t.contacts)} contacts`} trend={data.byDay.map((d) => d.messages)} icon={<MessagesSquare />} />
          <StatCard
            label="Processed"
            value={formatNumber(t.processed, { compact: true })}
            hint={t.failed ? `${formatNumber(t.failed)} failed` : t.messages ? `${formatPercent(t.processed / t.messages)} of messages` : "Nothing yet"}
            icon={<Sparkles />}
          />
          <StatCard label="Records created" value={formatNumber(t.recordsCreated, { compact: true })} trend={data.byDay.map((d) => d.records)} icon={<Database />} />
          <StatCard label="Records updated" value={formatNumber(t.recordsUpdated, { compact: true })} hint="From follow-up messages" icon={<FolderKanban />} />
          <StatCard label="Open reviews" value={formatNumber(reviews)} hint={reviews ? "Waiting for a person" : "All clear"} href="/console/review" icon={<ListChecks />} />
          <StatCard
            label="Avg. processing"
            value={formatDuration(data.pipeline.avgLatencyMs)}
            hint={data.pipeline.p95LatencyMs != null ? `p95 ${formatDuration(data.pipeline.p95LatencyMs)}` : "Per message"}
            icon={<Clock />}
          />
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Activity" description={`Messages received and records written per day · last ${range} days`} className="lg:col-span-2">
          {data ? <ActivityChart data={data.byDay} dimmed={dim} /> : loading ? <Skeleton className="h-[256px] w-full rounded-xl" /> : <p className="grid h-[256px] place-items-center text-sm text-muted">No data to chart.</p>}
        </Card>
        <RecentActivity />
      </div>

      {data && (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card title="Categories" description="What messages are about">
              {data.byCategory.length ? (
                <BarList label="Messages by category" dimmed={dim} items={data.byCategory.map((c) => ({ key: c.category, label: categoryLabel(c.category), value: c.count }))} />
              ) : (
                <p className="py-6 text-center text-sm text-muted">No classified messages in this period.</p>
              )}
            </Card>
            <Card title="Sources" description="Where messages came from">
              {data.bySource.length ? (
                <BarList
                  label="Messages by source"
                  dimmed={dim}
                  items={data.bySource.map((s) => ({ key: s.source, label: sourceLabel(s.source), value: s.count, icon: <ChannelIcon type={SOURCE_CHANNEL[s.source] ?? "api"} size="xs" /> }))}
                />
              ) : (
                <p className="py-6 text-center text-sm text-muted">No messages in this period.</p>
              )}
            </Card>
            <div className="flex flex-col gap-4 md:col-span-2 xl:col-span-1">
              <Card title="Priority" description="How urgent incoming messages are">
                <PrioritySplit data={data.byPriority} dimmed={dim} />
              </Card>
              <Card title="Pipeline" description="How messages were handled" actions={<Gauge className="size-4 text-muted" aria-hidden />}>
                <KeyValue
                  columns={2}
                  items={[
                    { label: "Applied automatically", value: formatPercent(data.pipeline.autoApplyRate), hint: "Values above the auto-apply threshold" },
                    { label: "AI used", value: formatPercent(data.pipeline.aiShare), hint: "Rules handle the rest" },
                    { label: "Needs review", value: formatNumber(data.totals.needsReview) },
                    { label: "Failed", value: formatNumber(data.totals.failed) },
                  ]}
                />
              </Card>
            </div>
          </div>

          <Card
            className="mt-4"
            title="Collections"
            description="Records per collection in this period"
            padded={false}
            actions={
              <Link href="/console/collections" className="text-[13px] font-medium text-brand hover:underline">
                All collections
              </Link>
            }
          >
            <DataTable
              caption="Collections"
              rows={data.collections}
              rowKey={(c) => c.id}
              dimmed={dim}
              rowHref={(c) => `/console/collections/${c.id}`}
              onRowIntent={(c) => {
                prefetchApi(`/api/v1/collections/${c.id}`);
                prefetchApi(`/api/v1/collections/${c.id}/records`);
              }}
              empty={<EmptyState compact icon={<FolderKanban />} title="No collections yet" body="Create one to start turning messages into records." />}
              columns={[
                {
                  key: "name",
                  header: "Collection",
                  cell: (c) => (
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                        <CollectionIcon icon={c.icon} className="size-3.5" />
                      </span>
                      <span className="truncate font-medium text-fg">{c.name}</span>
                    </span>
                  ),
                },
                { key: "records", header: "Records", align: "right", cell: (c) => <span className="tabular-nums">{formatNumber(c.records)}</span> },
                {
                  key: "value",
                  header: "Value",
                  align: "right",
                  hideBelow: "sm",
                  cell: (c) => <span className="tabular-nums">{c.valueSum != null ? money(c.valueSum, currency) : "—"}</span>,
                },
                {
                  key: "status",
                  header: "By status",
                  hideBelow: "md",
                  cell: (c) =>
                    c.byStatus.length ? (
                      <span className="flex flex-wrap gap-1.5">
                        {[...c.byStatus]
                          .sort((a, b) => b.count - a.count)
                          .slice(0, 3)
                          .map((s) => (
                            <span key={s.status} className="inline-flex items-center gap-1">
                              <Status value={s.status} />
                              <span className="text-xs text-muted tabular-nums">{s.count}</span>
                            </span>
                          ))}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    ),
                },
              ]}
            />
          </Card>
        </>
      )}
    </Page>
  );
}
