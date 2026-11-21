/**
 * Postgres schema (Drizzle). Every tenant-owned table carries `workspace_id`
 * and every query against it MUST filter by the caller's workspace (rule 6).
 *
 * After changing this file run `npm run db:generate` to create a migration.
 */
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, customType, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type {
  ActorType,
  ApiScope,
  AttachmentDTO,
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
  CellValue,
  ChannelType,
  CollectionRouting,
  ConnectionCommand,
  ConnectionPrompt,
  ConnectorState,
  SyncProgress,
  DomainEventType,
  EventStatus,
  Field,
  FieldConflict,
  FieldMeta,
  MessageClassification,
  MessageKind,
  MessageStatus,
  ProcessingResult,
  ProposedOperation,
  Role,
  Source,
  TemplateId,
  WorkspaceSettings,
} from "@/lib/shared/types";

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const workspaceRef = () =>
  text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

/* ------------------------------------------------------------------ */
/*  Identity & tenancy                                                 */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  /** Always stored lower-cased. */
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastLoginAt: ts("last_login_at"),
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  settings: jsonb("settings").$type<WorkspaceSettings>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 hex of the session token; the token itself is only in the user's cookie. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Active workspace for this session. */
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: workspaceRef(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    email: text("email").notNull(),
    role: text("role").$type<Role>().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_ws_idx").on(t.workspaceId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    name: text("name").notNull(),
    /** First characters of the key, shown in the UI to identify it. */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: jsonb("scopes").$type<ApiScope[]>().notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: ts("last_used_at"),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("api_keys_ws_idx").on(t.workspaceId)],
);

/* ------------------------------------------------------------------ */
/*  Channels, contacts, conversations, messages                        */
/* ------------------------------------------------------------------ */

export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    type: text("type").$type<ChannelType>().notNull(),
    name: text("name").notNull(),
    status: text("status").$type<"active" | "paused" | "error">().notNull().default("active"),
    /** Provider-side id used to route shared webhooks (WhatsApp phone_number_id, Slack team id, ...). */
    externalId: text("external_id"),
    /** Random token in the per-channel webhook URL. */
    webhookToken: text("webhook_token").notNull().unique(),
    /** Non-secret configuration. */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    /** AES-256-GCM encrypted JSON of secrets (tokens, signing secrets). See lib/server/crypto.ts. */
    secretsEnc: text("secrets_enc"),
    lastEventAt: ts("last_event_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("channels_ws_idx").on(t.workspaceId),
    uniqueIndex("channels_type_external_uq")
      .on(t.type, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    displayName: text("display_name").notNull().default(""),
    /** E.164 */
    phone: text("phone"),
    email: text("email"),
    /** Channel type → provider user id. */
    handles: jsonb("handles").$type<Record<string, string>>().notNull().default({}),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contacts_ws_updated_idx").on(t.workspaceId, t.updatedAt),
    // Handle lookups (`handles @> '{"telegram":"123"}'`) for senders without phone/email.
    index("contacts_handles_gin").using("gin", sql`${t.handles} jsonb_path_ops`),
    // One contact per phone / email per workspace (concurrent webhooks upsert safely).
    uniqueIndex("contacts_ws_phone_uq")
      .on(t.workspaceId, t.phone)
      .where(sql`${t.phone} is not null`),
    uniqueIndex("contacts_ws_email_uq")
      .on(t.workspaceId, t.email)
      .where(sql`${t.email} is not null`),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title").notNull().default(""),
    isGroup: boolean("is_group").notNull().default(false),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    lastMessageAt: ts("last_message_at"),
    lastMessagePreview: text("last_message_preview").notNull().default(""),
    unreadCount: integer("unread_count").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    /** Agents (classification + extraction into collections) run on this chat. Off = messages are stored and searchable only. */
    agentsEnabled: boolean("agents_enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("conversations_channel_ext_uq").on(t.channelId, t.externalId), index("conversations_ws_last_idx").on(t.workspaceId, t.lastMessageAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    /** Provider message id. Unique per channel → duplicate webhooks are dropped. */
    externalId: text("external_id").notNull(),
    direction: text("direction").$type<"inbound" | "outbound">().notNull().default("inbound"),
    senderName: text("sender_name").notNull().default(""),
    senderHandle: text("sender_handle"),
    kind: text("kind").$type<MessageKind>().notNull().default("text"),
    /** Sealed at rest (`enc:v1…`, lib/server/data/sealed.ts) — read with openText(). */
    text: text("text").notNull().default(""),
    /** Blind search index: keyed hashes of words and prefixes (null = not indexed yet). */
    searchTokens: text("search_tokens").array(),
    attachments: jsonb("attachments").$type<AttachmentDTO[]>().notNull().default([]),
    sentAt: ts("sent_at").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    status: text("status").$type<MessageStatus>().notNull().default("received"),
    classification: jsonb("classification").$type<MessageClassification>(),
    /** Latest processing event. */
    eventId: text("event_id"),
    /** Trimmed provider payload, for debugging. Never contains secrets. */
    raw: jsonb("raw").$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_channel_ext_uq").on(t.channelId, t.externalId),
    index("messages_ws_conv_sent_idx").on(t.workspaceId, t.conversationId, t.sentAt),
    index("messages_ws_sent_idx").on(t.workspaceId, t.sentAt),
    index("messages_search_tokens_gin").using("gin", t.searchTokens),
  ],
);

/** Media/document bytes. Kept in Postgres (capped size) so a deploy needs no object store. */
export const files = pgTable(
  "files",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    messageId: text("message_id").references(() => messages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("files_ws_msg_idx").on(t.workspaceId, t.messageId)],
);

/* ------------------------------------------------------------------ */
/*  Processing                                                         */
/* ------------------------------------------------------------------ */

/** One processing event per message (re-processing reuses it and bumps `attempts`). */
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    source: text("source").$type<Source>().notNull(),
    status: text("status").$type<EventStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    result: jsonb("result").$type<ProcessingResult>(),
    error: text("error"),
    model: text("model"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    processedAt: ts("processed_at"),
  },
  (t) => [index("events_ws_created_idx").on(t.workspaceId, t.createdAt), index("events_message_idx").on(t.messageId), index("events_ws_status_idx").on(t.workspaceId, t.status)],
);

/* ------------------------------------------------------------------ */
/*  Collections & records                                              */
/* ------------------------------------------------------------------ */

export const collections = pgTable(
  "collections",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    icon: text("icon").notNull().default("table"),
    template: text("template").$type<TemplateId>().notNull().default("custom"),
    fields: jsonb("fields").$type<Field[]>().notNull(),
    routing: jsonb("routing").$type<CollectionRouting>().notNull(),
    /** Field keys that identify "the same" record (dedupe). Empty → contact + conversation. */
    matchFields: jsonb("match_fields").$type<string[]>().notNull().default([]),
    autopilot: boolean("autopilot").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: ts("archived_at"),
  },
  (t) => [index("collections_ws_idx").on(t.workspaceId)],
);

export const records = pgTable(
  "records",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    values: jsonb("values").$type<Record<string, CellValue>>().notNull(),
    fieldMeta: jsonb("field_meta").$type<Record<string, FieldMeta>>().notNull().default({}),
    /** Normalised identity used to update instead of duplicating. */
    matchKey: text("match_key"),
    /** Denormalised value of the collection's status field, for filtering. */
    status: text("status"),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    origin: text("origin").$type<"pipeline" | "manual" | "api" | "automation" | "import">().notNull(),
    /** Optimistic concurrency: incremented on every write. */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
    deletedBy: text("deleted_by"),
  },
  (t) => [
    index("records_ws_col_updated_idx").on(t.workspaceId, t.collectionId, t.updatedAt),
    uniqueIndex("records_col_match_uq")
      .on(t.collectionId, t.matchKey)
      .where(sql`${t.deletedAt} is null and ${t.matchKey} is not null`),
    index("records_fts_idx").using("gin", sql`to_tsvector('simple', ${t.values}::text)`),
  ],
);

/** Which messages each record (and field) came from — source traceability (rule 10). */
export const recordSources = pgTable(
  "record_sources",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    workspaceId: workspaceRef(),
    recordId: text("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    eventId: text("event_id"),
    fieldKey: text("field_key"),
    evidence: text("evidence"),
    confidence: real("confidence"),
    createdAt: createdAt(),
  },
  (t) => [index("record_sources_record_idx").on(t.recordId), index("record_sources_message_idx").on(t.messageId)],
);

export const reviewItems = pgTable(
  "review_items",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    kind: text("kind").$type<"low_confidence" | "conflict" | "ambiguous_target" | "missing_required" | "classification">().notNull(),
    reason: text("reason").notNull(),
    status: text("status").$type<"open" | "approved" | "rejected">().notNull().default("open"),
    eventId: text("event_id"),
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    collectionId: text("collection_id").references(() => collections.id, { onDelete: "cascade" }),
    recordId: text("record_id").references(() => records.id, { onDelete: "set null" }),
    proposed: jsonb("proposed").$type<ProposedOperation>(),
    current: jsonb("current").$type<Record<string, CellValue>>(),
    conflicts: jsonb("conflicts").$type<FieldConflict[]>().notNull().default([]),
    resolvedBy: text("resolved_by"),
    resolvedAt: ts("resolved_at"),
    resolutionNote: text("resolution_note"),
    createdAt: createdAt(),
  },
  (t) => [index("review_ws_status_idx").on(t.workspaceId, t.status, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/*  Automations, outbound webhooks, notifications                      */
/* ------------------------------------------------------------------ */

export const automations = pgTable(
  "automations",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
    conditions: jsonb("conditions").$type<AutomationCondition[]>().notNull().default([]),
    actions: jsonb("actions").$type<AutomationAction[]>().notNull(),
    createdBy: text("created_by"),
    runCount: integer("run_count").notNull().default(0),
    lastRunAt: ts("last_run_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("automations_ws_idx").on(t.workspaceId)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    triggerType: text("trigger_type").notNull(),
    /** Domain event id — a run is recorded at most once per (automation, event). */
    domainEventId: text("domain_event_id"),
    subjectId: text("subject_id"),
    status: text("status").$type<"success" | "failed" | "skipped">().notNull(),
    output: jsonb("output").$type<unknown>(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("automation_runs_aut_idx").on(t.automationId, t.createdAt),
    uniqueIndex("automation_runs_event_uq")
      .on(t.automationId, t.domainEventId)
      .where(sql`${t.domainEventId} is not null`),
  ],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    url: text("url").notNull(),
    description: text("description").notNull().default(""),
    secretEnc: text("secret_enc").notNull(),
    events: jsonb("events").$type<DomainEventType[]>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by"),
    lastDeliveryAt: ts("last_delivery_at"),
    lastStatus: integer("last_status"),
    failureCount: integer("failure_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("webhook_endpoints_ws_idx").on(t.workspaceId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: text("status").$type<"pending" | "delivered" | "failed">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    error: text("error"),
    createdAt: createdAt(),
    deliveredAt: ts("delivered_at"),
  },
  (t) => [index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    /** null = everyone in the workspace. */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_ws_user_idx").on(t.workspaceId, t.userId, t.createdAt)],
);

export const assistantThreads = pgTable(
  "assistant_threads",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    messages: jsonb("messages").$type<{ role: "user" | "assistant"; text: string; at: string; data?: unknown }[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("assistant_threads_ws_user_idx").on(t.workspaceId, t.userId)],
);

/* ------------------------------------------------------------------ */
/*  Infrastructure                                                     */
/* ------------------------------------------------------------------ */

export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"queued" | "running" | "done" | "dead">().notNull().default("queued"),
    /** Lower runs first. */
    priority: integer("priority").notNull().default(100),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedUntil: ts("locked_until"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    /** Optional idempotency key: a second enqueue with the same key is ignored. */
    dedupeKey: text("dedupe_key").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("jobs_claim_idx").on(t.status, t.priority, t.runAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id"),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    /** Source references (eventId, messageIds), request ip, etc. */
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_ws_created_idx").on(t.workspaceId, t.createdAt), index("audit_ws_target_idx").on(t.workspaceId, t.targetType, t.targetId)],
);

/**
 * Live connection state of a channel, owned by the sync manager
 * (lib/server/sync). One row per channel; a lease ensures exactly one server
 * instance holds a persistent connection at a time.
 */
export const connectorSessions = pgTable(
  "connector_sessions",
  {
    channelId: text("channel_id")
      .primaryKey()
      .references(() => channels.id, { onDelete: "cascade" }),
    workspaceId: workspaceRef(),
    state: text("state").$type<ConnectorState>().notNull().default("disconnected"),
    qr: text("qr"),
    qrExpiresAt: ts("qr_expires_at"),
    pairingCode: text("pairing_code"),
    /** What the login flow waits for (Telegram login code / two-step password); never contains secrets. */
    prompt: jsonb("prompt").$type<ConnectionPrompt>(),
    account: jsonb("account").$type<{ id?: string; name?: string; phone?: string; email?: string }>(),
    /** AES-GCM encrypted auth/session blob (Telegram session string, OAuth tokens, linked-device creds). */
    authEnc: text("auth_enc"),
    /** Non-secret sync cursors (IMAP last UID per mailbox, last backfill time...). */
    cursor: jsonb("cursor").$type<Record<string, unknown>>().notNull().default({}),
    progress: jsonb("progress").$type<SyncProgress>(),
    /** Pending command for the instance holding the lease. */
    command: text("command").$type<ConnectionCommand>(),
    commandArg: text("command_arg"),
    commandAt: ts("command_at"),
    leaseOwner: text("lease_owner"),
    leaseUntil: ts("lease_until"),
    lastConnectedAt: ts("last_connected_at"),
    lastSyncAt: ts("last_sync_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("connector_sessions_ws_idx").on(t.workspaceId)],
);

/** Encrypted key-value store per channel (e.g. WhatsApp linked-device signal keys). */
export const connectorKv = pgTable(
  "connector_kv",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    valueEnc: text("value_enc").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.key] })],
);

/** Monthly usage counters per workspace (messages ingested, AI calls, tokens...). */
export const usageCounters = pgTable(
  "usage_counters",
  {
    workspaceId: workspaceRef(),
    /** YYYY-MM */
    period: text("period").notNull(),
    metric: text("metric").notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.period, t.metric] })],
);

export type UserRow = typeof users.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type CollectionRow = typeof collections.$inferSelect;
export type RecordRow = typeof records.$inferSelect;
export type ReviewItemRow = typeof reviewItems.$inferSelect;
export type AutomationRow = typeof automations.$inferSelect;
export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type ConnectorSessionRow = typeof connectorSessions.$inferSelect;
