/**
 * Badges and icons for console data: tones, categories, priorities, value
 * sources (facts vs AI suggestions), channels, connection and event states.
 * No hooks — usable from server and client components.
 */
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  Camera,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  CodeXml,
  Contact,
  Copy,
  Eye,
  FileArchive,
  FileText,
  Flame,
  Hash,
  Inbox,
  LifeBuoy,
  LoaderCircle,
  LogOut,
  Mail,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  Minus,
  QrCode,
  RotateCcw,
  Send,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Star,
  Unplug,
  Upload,
  UserRound,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Category, ChannelType, ConnectorState, EventStatus, Priority, Role, ValueSource } from "@/lib/shared/types";
import { CONNECTOR_STATE_LABELS, EVENT_STATUS_LABELS, PRIORITY_LABELS, ROLE_LABELS, VALUE_SOURCE_LABELS, categoryLabel, channelLabel } from "@/lib/client/format";

/* ------------------------------- Badge ------------------------------ */

/** Colour tones shared by badges across the console. */
export type Tone = "neutral" | "muted" | "brand" | "success" | "warning" | "danger" | "info" | "violet";

const toneCls: Record<Tone, string> = {
  neutral: "bg-sunken text-fg-soft ring-line-strong",
  muted: "bg-transparent text-muted ring-line",
  brand: "bg-brand/10 text-brand ring-brand/25",
  success: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  warning: "bg-amber-500/14 text-amber-800 ring-amber-500/30 dark:text-amber-300",
  danger: "bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300",
  info: "bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300",
  violet: "bg-violet-500/12 text-violet-700 ring-violet-500/30 dark:text-violet-300",
};

/** Small pill label. `tone` sets the colour; `icon` (lucide element) or `dot` adds a non-colour cue. */
export function Badge({
  tone = "neutral",
  icon,
  dot,
  children,
  title,
  className = "",
}: {
  tone?: Tone;
  icon?: ReactNode;
  dot?: boolean;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span title={title} className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap ring-1 ring-inset ${toneCls[tone]} ${className}`}>
      {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
      {icon && (
        <span aria-hidden className="shrink-0 [&>svg]:size-3">
          {icon}
        </span>
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}

/* ----------------------------- Category ----------------------------- */

const categoryIcon: Record<Category, LucideIcon> = {
  sales_enquiry: Star,
  order: ShoppingBag,
  payment: Wallet,
  support: LifeBuoy,
  follow_up: RotateCcw,
  appointment: CalendarClock,
  contact_share: Contact,
  document_share: FileText,
  feedback: MessageCircle,
  spam: ShieldAlert,
  general: MessagesSquare,
};

/** Message category (e.g. "Sales enquiry") with its icon. Unknown categories render humanized. */
export function CategoryBadge({ category, className = "" }: { category: Category | string; className?: string }) {
  const Icon = categoryIcon[category as Category] ?? MessagesSquare;
  return (
    <Badge tone={category === "spam" ? "muted" : "neutral"} icon={<Icon />} className={className}>
      {categoryLabel(category)}
    </Badge>
  );
}

/* ----------------------------- Priority ----------------------------- */

const priorityStyle: Record<Priority, { tone: Tone; icon: LucideIcon }> = {
  urgent: { tone: "danger", icon: Flame },
  high: { tone: "warning", icon: ArrowUp },
  medium: { tone: "info", icon: Minus },
  low: { tone: "muted", icon: ArrowDown },
};

/** Message priority: urgent (flame, red), high (up, amber), medium (dash, blue), low (down, muted). */
export function PriorityBadge({ priority, className = "" }: { priority: Priority; className?: string }) {
  const s = priorityStyle[priority] ?? priorityStyle.medium;
  const Icon = s.icon;
  return (
    <Badge tone={s.tone} icon={<Icon />} className={className} title={`${PRIORITY_LABELS[priority] ?? priority} priority`}>
      {PRIORITY_LABELS[priority] ?? priority}
    </Badge>
  );
}

/* ---------------------------- Value source --------------------------- */

const sourceStyle: Record<ValueSource, { icon: LucideIcon; cls: string; title: string }> = {
  extracted: {
    icon: CircleCheck,
    cls: "bg-emerald-500/12 text-emerald-700 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-300",
    title: "Fact — taken from a message, with evidence",
  },
  ai_suggested: {
    icon: Sparkles,
    // Dashed outline + italic: never mistaken for a verified fact (rule 11).
    cls: "border border-dashed border-violet-500/60 bg-violet-500/6 italic text-violet-700 dark:text-violet-300",
    title: "AI suggestion — not verified against the message",
  },
  manual: { icon: UserRound, cls: "bg-sunken text-fg-soft ring-1 ring-inset ring-line-strong", title: "Entered or edited by a person" },
  automation: { icon: Workflow, cls: "bg-sky-500/12 text-sky-700 ring-1 ring-inset ring-sky-500/25 dark:text-sky-300", title: "Set by an automation" },
  api: { icon: CodeXml, cls: "bg-brand/10 text-brand ring-1 ring-inset ring-brand/25", title: "Written through the API" },
  import: { icon: Upload, cls: "bg-amber-500/12 text-amber-800 ring-1 ring-inset ring-amber-500/30 dark:text-amber-300", title: "Imported from a file" },
};

/**
 * Where a value came from. Facts (`extracted`) and AI suggestions (`ai_suggested`) are visually distinct:
 * solid green with a check vs dashed violet outline, italic, with sparkles. `compact` shows the icon only
 * (label kept for screen readers and as a tooltip). Pass `method` to note how an extracted value was found.
 */
export function SourceBadge({ source, method, compact, className = "" }: { source: ValueSource; method?: "rules" | "ai" | "human" | null; compact?: boolean; className?: string }) {
  const s = sourceStyle[source] ?? sourceStyle.manual;
  const Icon = s.icon;
  const label = VALUE_SOURCE_LABELS[source] ?? source;
  const title = source === "extracted" && method === "ai" ? "Fact — found by AI and verified against the message" : source === "extracted" && method === "rules" ? "Fact — found by rules in the message" : s.title;
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full text-[11px] leading-4 font-medium whitespace-nowrap ${compact ? "p-1" : "px-2 py-0.5"} ${s.cls} ${className}`}>
      <Icon className="size-3 shrink-0" aria-hidden />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

/* ------------------------------ Channels ----------------------------- */

const channelStyle: Record<ChannelType, { icon: LucideIcon; cls: string }> = {
  whatsapp_cloud: { icon: MessageCircle, cls: "bg-emerald-500/14 text-emerald-700 dark:text-emerald-300" },
  whatsapp_web: { icon: QrCode, cls: "bg-emerald-500/14 text-emerald-700 dark:text-emerald-300" },
  whatsapp_export: { icon: FileArchive, cls: "bg-emerald-500/14 text-emerald-700 dark:text-emerald-300" },
  telegram: { icon: Bot, cls: "bg-sky-500/14 text-sky-700 dark:text-sky-300" },
  telegram_user: { icon: Send, cls: "bg-sky-500/14 text-sky-700 dark:text-sky-300" },
  email: { icon: Mail, cls: "bg-amber-500/16 text-amber-800 dark:text-amber-300" },
  email_imap: { icon: Inbox, cls: "bg-amber-500/16 text-amber-800 dark:text-amber-300" },
  slack: { icon: Hash, cls: "bg-fuchsia-500/14 text-fuchsia-700 dark:text-fuchsia-300" },
  sms_twilio: { icon: MessageSquareText, cls: "bg-rose-500/14 text-rose-700 dark:text-rose-300" },
  instagram: { icon: Camera, cls: "bg-pink-500/14 text-pink-700 dark:text-pink-300" },
  messenger: { icon: MessagesSquare, cls: "bg-indigo-500/14 text-indigo-700 dark:text-indigo-300" },
  linkedin: { icon: BriefcaseBusiness, cls: "bg-blue-600/14 text-blue-700 dark:text-blue-300" },
  api: { icon: CodeXml, cls: "bg-sunken text-fg-soft ring-1 ring-inset ring-line" },
};

const channelSize = { xs: "size-5 rounded-md [&>svg]:size-3", sm: "size-6 rounded-md [&>svg]:size-3.5", md: "size-8 rounded-lg [&>svg]:size-4", lg: "size-10 rounded-xl [&>svg]:size-5" } as const;

/**
 * Tinted tile with an icon for any of the 13 channel types. Labelled for screen readers;
 * `withLabel` also prints the channel name next to it.
 */
export function ChannelIcon({ type, size = "sm", withLabel, className = "" }: { type: ChannelType; size?: keyof typeof channelSize; withLabel?: boolean; className?: string }) {
  const s = channelStyle[type] ?? channelStyle.api;
  const Icon = s.icon;
  const tile = (
    <span role={withLabel ? undefined : "img"} aria-label={withLabel ? undefined : channelLabel(type)} title={withLabel ? undefined : channelLabel(type)} className={`grid shrink-0 place-items-center ${channelSize[size]} ${s.cls} ${withLabel ? "" : className}`}>
      <Icon aria-hidden />
    </span>
  );
  if (!withLabel) return tile;
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
      {tile}
      <span className="truncate text-sm text-fg-soft">{channelLabel(type)}</span>
    </span>
  );
}

/* ------------------------- Connection & events ----------------------- */

const connectionStyle: Record<ConnectorState, { tone: Tone; icon: ReactNode }> = {
  connected: { tone: "success", icon: <CircleCheck /> },
  syncing: { tone: "info", icon: <LoaderCircle className="animate-spin" /> },
  connecting: { tone: "warning", icon: <LoaderCircle className="animate-spin" /> },
  pairing: { tone: "warning", icon: <QrCode /> },
  error: { tone: "danger", icon: <CircleAlert /> },
  logged_out: { tone: "neutral", icon: <LogOut /> },
  disconnected: { tone: "muted", icon: <Unplug /> },
};

/** Live connection state of a channel (connected, syncing, pairing, error, …) with icon + label. */
export function ConnectionBadge({ state, className = "" }: { state: ConnectorState; className?: string }) {
  const s = connectionStyle[state] ?? connectionStyle.disconnected;
  return (
    <Badge tone={s.tone} icon={s.icon} className={className}>
      {CONNECTOR_STATE_LABELS[state] ?? state}
    </Badge>
  );
}

const eventStyle: Record<EventStatus, { tone: Tone; icon: ReactNode }> = {
  queued: { tone: "neutral", icon: <Clock /> },
  processing: { tone: "info", icon: <LoaderCircle className="animate-spin" /> },
  processed: { tone: "success", icon: <CircleCheck /> },
  needs_review: { tone: "warning", icon: <Eye /> },
  skipped: { tone: "muted", icon: <CircleMinus /> },
  duplicate: { tone: "muted", icon: <Copy /> },
  failed: { tone: "danger", icon: <CircleX /> },
};

/** Processing status of an event/message (queued, processing, processed, needs review, skipped, duplicate, failed). */
export function EventStatusBadge({ status, className = "" }: { status: EventStatus | "received"; className?: string }) {
  const s = eventStyle[status as EventStatus] ?? eventStyle.queued;
  return (
    <Badge tone={s.tone} icon={s.icon} className={className}>
      {EVENT_STATUS_LABELS[status as EventStatus] ?? "Received"}
    </Badge>
  );
}

const roleTone: Record<Role, Tone> = { owner: "brand", admin: "violet", member: "neutral", viewer: "muted" };

/** Workspace role pill (owner, admin, member, viewer). */
export function RoleBadge({ role, className = "" }: { role: Role; className?: string }) {
  return (
    <Badge tone={roleTone[role] ?? "neutral"} className={className}>
      {ROLE_LABELS[role] ?? role}
    </Badge>
  );
}
