/**
 * Console UI kit — import everything for console pages from here:
 *
 *   import { Page, PageHeader, Card, DataTable, Button, ErrorState, PageSkeleton } from "@/components/console/kit";
 *
 * Conventions (see docs/ARCHITECTURE.md §9):
 *  - Wrap each page in `<Page>` and give the route a `loading.tsx` that renders the matching `PageSkeleton`.
 *  - Data: `useApi` / `useCursorList` with `keepPreviousData` for lists; pass `isPreviousData` to `DataTable dimmed`.
 *  - First load → skeletons (`loading`), failures → `<ErrorState error retry />`, nothing → `<EmptyState />`.
 *  - Buttons: return a Promise from `onClick` (or pass `pending`) for instant pending feedback.
 *  - Mutations: optimistic `setCached` → `api()` → `invalidate()`; toast success/failure with `useUI().toast`.
 *  - Heavy widgets (`JsonView`, charts) are lazy-loaded with next/dynamic.
 *  - Facts vs AI suggestions: always show `SourceBadge` next to extracted values.
 *
 * This file only re-exports; the implementations live in `./kit/*`.
 */

export { Page, PageHeader, Card, StatCard, KeyValue, EmptyState, Callout, Spinner, Kbd } from "./kit/surface";
export type { Crumb, StatDelta } from "./kit/surface";

export { Skeleton, SkeletonText, PageHeaderSkeleton, TableSkeleton, StatGridSkeleton, CardSkeleton, FormSkeleton, PageSkeleton } from "./kit/skeleton";

export { Badge, CategoryBadge, PriorityBadge, SourceBadge, ChannelIcon, ConnectionBadge, EventStatusBadge, RoleBadge } from "./kit/badges";
export type { Tone } from "./kit/badges";

export { ConfidenceMeter } from "./kit/meter";

export { Button, IconButton, buttonCls, fieldCls, FieldRow, TextField, TextArea, Select, Checkbox, Switch, SwitchRow, RadioCards, SearchInput } from "./kit/form";
export type { ButtonVariant, ButtonSize, SelectOption, RadioCardOption } from "./kit/form";

export { Dialog, Drawer, ConfirmDialog, Popover, Menu, MenuItem, MenuLabel, MenuSeparator, usePopoverClose } from "./kit/overlay";
export type { Placement, PopoverTriggerProps } from "./kit/overlay";

export { DataTable } from "./kit/table";
export type { Column, DataTableProps } from "./kit/table";

export { Tabs, CopyButton, TimeAgo, useNow, LoadMore, ErrorState } from "./kit/misc";
export type { TabItem } from "./kit/misc";

export { JsonView } from "./kit/json";

export { ConsoleNavLink, LinkPendingDot, LinkPendingPulse, isActivePath } from "./nav-link";
export { useSession, useOptionalSession } from "./session";

export {
  formatNumber,
  formatPercent,
  formatDuration,
  formatBytes,
  formatDate,
  formatDateTime,
  relativeTime,
  humanize,
  categoryLabel,
  intentLabel,
  channelLabel,
  sourceLabel,
  CATEGORY_LABELS,
  CHANNEL_LABELS,
  SOURCE_LABELS,
  SOURCE_CHANNEL,
  VALUE_SOURCE_LABELS,
  PRIORITY_LABELS,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  EVENT_STATUS_LABELS,
  CONNECTOR_STATE_LABELS,
  SCOPE_DESCRIPTIONS,
  DOMAIN_EVENT_DESCRIPTIONS,
} from "@/lib/client/format";
export { errorMessage, fieldErrors, isNotFound, isForbidden, errorStatus } from "@/lib/client/errors";
export { useCursorList } from "@/lib/client/pagination";
export { copyText, downloadFile, safeNext } from "@/lib/client/browser";
