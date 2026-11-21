/**
 * Types shared by the server (API, pipeline) and the browser (console UI).
 * Pure types and constants only — no runtime dependencies, safe to import anywhere.
 *
 * JSON over the wire: Date columns are serialised as ISO-8601 strings, so every
 * DTO below uses `string` for timestamps.
 */

/* ------------------------------------------------------------------ */
/*  Enums                                                              */
/* ------------------------------------------------------------------ */

export const ROLES = ["viewer", "member", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];
/** viewer < member < admin < owner */
export const roleRank = (r: Role) => ROLES.indexOf(r);
export const roleAtLeast = (have: Role, need: Role) => roleRank(have) >= roleRank(need);

export const API_SCOPES = ["ingest", "read", "write", "delete"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const CHANNEL_TYPES = [
  "whatsapp_cloud", // official Meta Cloud API (+ WhatsApp Business app coexistence: history + echoes)
  "whatsapp_web", // EXPERIMENTAL linked device via QR (unofficial; ban risk, explicit opt-in)
  "telegram", // bot (webhook)
  "telegram_user", // personal account (MTProto, persistent connection)
  "email", // inbound-parse webhook (Postmark/Mailgun/SendGrid)
  "email_imap", // mailbox sync (IMAP IDLE + SMTP replies; Gmail/Outlook OAuth or app password)
  "slack",
  "sms_twilio",
  "instagram", // Instagram professional account DMs (Meta webhooks)
  "messenger", // Facebook Page Messenger (Meta webhooks)
  "linkedin", // LinkedIn via Unipile (optional; notification emails are also captured by email channels)
  "api",
  "whatsapp_export",
] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

/** Channel types that keep a persistent connection run by the sync manager (long-running servers only). */
export const PERSISTENT_CHANNEL_TYPES = ["whatsapp_web", "telegram_user", "email_imap"] as const satisfies readonly ChannelType[];
export type PersistentChannelType = (typeof PERSISTENT_CHANNEL_TYPES)[number];
export const isPersistentChannel = (t: ChannelType): t is PersistentChannelType => (PERSISTENT_CHANNEL_TYPES as readonly string[]).includes(t);

/** The `source` reported in processing results (spec: "whatsapp", ...). */
export const SOURCES = ["whatsapp", "telegram", "email", "slack", "sms", "instagram", "messenger", "linkedin", "api"] as const;
export type Source = (typeof SOURCES)[number];
export const sourceOf: Record<ChannelType, Source> = {
  whatsapp_cloud: "whatsapp",
  whatsapp_web: "whatsapp",
  whatsapp_export: "whatsapp",
  telegram: "telegram",
  telegram_user: "telegram",
  email: "email",
  email_imap: "email",
  slack: "slack",
  sms_twilio: "sms",
  instagram: "instagram",
  messenger: "messenger",
  linkedin: "linkedin",
  api: "api",
};

/* ---------------------------- Live sync ----------------------------- */

export const CONNECTOR_STATES = ["disconnected", "pairing", "connecting", "connected", "syncing", "error", "logged_out"] as const;
export type ConnectorState = (typeof CONNECTOR_STATES)[number];

export type SyncProgress = {
  phase: "idle" | "contacts" | "history" | "done";
  /** Conversations or messages expected (null = unknown). */
  total: number | null;
  done: number;
  startedAt: string | null;
  finishedAt: string | null;
  message?: string;
};

/**
 * phone_login / code / password: Telegram account login (phone-number fallback, login code, two-step password).
 * Their args are sealed (lib/server/data/sealed.ts) while they wait in connector_sessions.
 */
export type ConnectionCommand = "connect" | "disconnect" | "logout" | "resync" | "pair_code" | "password" | "phone_login" | "code";

/** What a login flow is waiting for from the person connecting (null = nothing). `at` changes with every new prompt. */
export type ConnectionPrompt =
  | { kind: "password"; hint: string | null; error: string | null; at: string }
  | { kind: "code"; phoneMasked: string | null; via: "app" | "sms" | "call" | "email" | "other" | null; error: string | null; at: string };

/** Live connection status of a channel (persistent connectors and webhook channels alike). */
export type ConnectionDTO = {
  channelId: string;
  type: ChannelType;
  state: ConnectorState;
  /** WhatsApp linked-device pairing QR payload (render as a QR code). */
  qr: string | null;
  qrExpiresAt: string | null;
  /** WhatsApp phone-number pairing code (alternative to QR). */
  pairingCode: string | null;
  /** Input the login flow is waiting for (Telegram login code / two-step password). */
  prompt: ConnectionPrompt | null;
  /** Connected identity (non-secret). */
  account: { id?: string; name?: string; phone?: string; email?: string } | null;
  progress: SyncProgress | null;
  lastConnectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  /** True while a server instance holds this connection (lease heartbeat fresh). */
  live: boolean;
  /** Whether this deployment can run persistent connectors (long-running server with the sync manager on). */
  syncAvailable: boolean;
  realtime: "webhook" | "persistent";
};

/** Server → browser live events on GET /api/v1/stream (Server-Sent Events). */
export type RealtimeEvent = {
  type: DomainEventType | "channel.status" | "job.progress";
  workspaceId: string;
  at: string;
  /** Small payload: ids only, never message text. */
  data: { messageId?: string; conversationId?: string; eventId?: string; recordId?: string; collectionId?: string; reviewItemId?: string; channelId?: string; state?: ConnectorState };
};

export const CATEGORIES = [
  "sales_enquiry",
  "order",
  "payment",
  "support",
  "follow_up",
  "appointment",
  "contact_share",
  "document_share",
  "feedback",
  "spam",
  "general",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Suggested intents. The classifier may return others; UIs should render unknown ones verbatim. */
export const INTENTS = [
  "purchase_interest",
  "price_request",
  "availability_check",
  "place_order",
  "modify_order",
  "cancel_order",
  "order_status",
  "payment_confirmation",
  "payment_promise",
  "payment_request",
  "refund_request",
  "complaint",
  "question",
  "task_request",
  "task_done",
  "schedule_meeting",
  "share_contact",
  "share_document",
  "share_link",
  "feedback",
  "greeting",
  "acknowledgement",
  "spam",
  "unknown",
] as const;
export type Intent = (typeof INTENTS)[number] | (string & {});

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MESSAGE_KINDS = ["text", "image", "video", "audio", "document", "contact", "location", "sticker", "system", "deleted"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_STATUSES = ["received", "queued", "processing", "processed", "needs_review", "skipped", "failed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const EVENT_STATUSES = ["queued", "processing", "processed", "needs_review", "skipped", "duplicate", "failed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/* ------------------------------------------------------------------ */
/*  Collections, fields and values                                     */
/* ------------------------------------------------------------------ */

export const FIELD_TYPES = ["text", "number", "currency", "status", "date", "phone", "email", "url", "location", "image", "boolean"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  /** Extraction instruction for this column. */
  description: string;
  /** Allowed values for `status` fields, in pipeline order. */
  options?: string[];
  /** Critical field: if it can't be extracted confidently, the record goes to human review. */
  required?: boolean;
};

export type CellValue = string | number | boolean | null;

export const TEMPLATE_IDS = ["orders", "leads", "payments", "products", "tasks", "support", "contacts", "documents", "links", "custom"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** Which messages a collection listens to. */
export type CollectionRouting = {
  /** Message categories that feed this collection. Empty = none (manual only). */
  categories: Category[];
  /** Optional: only these channels (ids). Empty/undefined = all channels. */
  channelIds?: string[];
  /** Optional extra keywords; a message containing any of them is also routed here. */
  keywords?: string[];
};

/** Where a value came from — rule 11: always distinguish extracted facts from AI suggestions. */
export const VALUE_SOURCES = ["extracted", "ai_suggested", "manual", "automation", "api", "import"] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];

export type FieldMeta = {
  source: ValueSource;
  /** 0..1, null for human input. */
  confidence: number | null;
  /** Message the value was taken from (source traceability). */
  messageId: string | null;
  eventId: string | null;
  /** Verbatim snippet of the source message supporting the value. */
  evidence: string | null;
  method: "rules" | "ai" | "human" | null;
  updatedAt: string;
  /** Set when a person edited the value. The pipeline never overwrites edited values. */
  edited?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Standard backend output format (one per processed message)         */
/* ------------------------------------------------------------------ */

export type ExtractedEntity = {
  field: string;
  value: CellValue;
  confidence: number;
  /** Verbatim quote from the source message, or null when inferred from metadata (e.g. sender phone). */
  evidence: string | null;
  method: "rules" | "ai" | "metadata";
  /** Collection this entity was extracted for (null = generic entity like a phone number). */
  collection_id?: string | null;
};

export type RecordAction = "CREATE_RECORD" | "UPDATE_RECORD" | "NO_OP" | "PENDING_REVIEW";
export type RecordOpStatus = "pending" | "completed" | "failed" | "skipped" | "needs_review";

export type FieldChange = { field: string; from: CellValue; to: CellValue };
export type FieldConflict = { field: string; existing: CellValue; proposed: CellValue; reason: "human_edited" | "lower_confidence" | "conflicting_value" };

export type RecordOperation = {
  action: RecordAction;
  /** Collection name (spec field). */
  collection: string | null;
  collection_id: string | null;
  /** Populated by the backend after execution — never by the AI. */
  record_id: string | null;
  status: RecordOpStatus;
  changes: FieldChange[];
  conflicts: FieldConflict[];
  /** True once the written record was read back and matched. */
  verified: boolean;
  review_item_id?: string | null;
};

export type AutomationOutcome = {
  automation_id: string;
  name: string;
  status: "success" | "failed" | "skipped" | "queued";
  actions: string[];
  error?: string | null;
};

export type ProcessingWarning = { code: string; message: string; field?: string };

/** AI-generated suggestions — never applied as facts. */
export type Suggestion = {
  type: "field_value" | "new_collection" | "follow_up" | "reply" | "classification";
  text: string;
  field?: string;
  value?: CellValue;
  confidence?: number;
  collection_id?: string | null;
};

export type SourceReference = {
  message_id: string;
  external_id: string;
  conversation_id: string;
  channel_id: string;
  sent_at: string;
};

export type MessageClassification = {
  category: Category;
  intent: Intent;
  priority: Priority;
  confidence: number;
  method: "rules" | "ai";
};

export type ProcessingStep = { name: string; status: "ok" | "skipped" | "failed"; ms: number; note?: string };

export type ProcessingResult = {
  event_id: string;
  status: "processed" | "needs_review" | "skipped" | "duplicate" | "failed";
  source: Source;
  message_classification: MessageClassification;
  extracted_entities: ExtractedEntity[];
  /** Primary operation (spec field). Null when the message produced no record operation. */
  record_operation: RecordOperation | null;
  /** All operations, when one message touches several collections. */
  record_operations: RecordOperation[];
  automation: AutomationOutcome[];
  suggestions: Suggestion[];
  warnings: ProcessingWarning[];
  requires_human_review: boolean;
  review_item_ids: string[];
  source_references: SourceReference[];
  processing_metadata: {
    processed_at: string | null;
    model: string | null;
    duration_ms: number | null;
    pipeline_version: string;
    ai_used: boolean;
    steps: ProcessingStep[];
  };
};

/* ------------------------------------------------------------------ */
/*  Workspace settings                                                 */
/* ------------------------------------------------------------------ */

export type WorkspaceSettings = {
  currency: string;
  timezone: string;
  /** Country calling code assumed for local phone numbers without "+", e.g. "+91". */
  defaultCountryCode: string;
  /** "off": rules only. "assist": AI only when rules are unsure. "full": AI on every relevant message. */
  aiMode: "off" | "assist" | "full";
  /** Replace phone numbers / emails with placeholders before text is sent to the AI provider. */
  redactPII: boolean;
  /** Values at or above this confidence are applied automatically. */
  autoApplyThreshold: number;
  /** Values below this confidence are dropped to suggestions; between the two → human review. */
  reviewThreshold: number;
  /** Delete messages older than this many days (records are kept). null = keep forever. */
  retentionDays: number | null;
  /** Allow automations to call external URLs / send replies. Off by default (rule 8). */
  allowExternalActions: boolean;
};

export const defaultWorkspaceSettings: WorkspaceSettings = {
  currency: "INR",
  timezone: "Asia/Kolkata",
  defaultCountryCode: "+91",
  aiMode: "assist",
  redactPII: true,
  autoApplyThreshold: 0.8,
  reviewThreshold: 0.5,
  retentionDays: null,
  allowExternalActions: false,
};

/* ------------------------------------------------------------------ */
/*  Automations                                                        */
/* ------------------------------------------------------------------ */

export const DOMAIN_EVENT_TYPES = [
  "message.received",
  "message.processed",
  "record.created",
  "record.updated",
  "record.status_changed",
  "record.deleted",
  "review.created",
  "review.resolved",
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export type DomainEvent = {
  /** Unique id — receivers use it to drop duplicates. */
  id: string;
  type: DomainEventType;
  workspaceId: string;
  at: string;
  /** Who caused it. */
  actor: Actor;
  data: {
    messageId?: string;
    eventId?: string;
    recordId?: string;
    collectionId?: string;
    reviewItemId?: string;
    category?: Category;
    priority?: Priority;
    intent?: string;
    /** record.status_changed */
    fromStatus?: string | null;
    toStatus?: string | null;
    changes?: FieldChange[];
    /** Snapshot of record values after the change. */
    values?: Record<string, CellValue>;
  };
};

export type AutomationTrigger = {
  type: DomainEventType | "schedule.daily";
  /** Restrict to one collection (record.* triggers). */
  collectionId?: string | null;
  /** record.status_changed: only when the new status equals this. */
  toStatus?: string | null;
  /** message.processed: only these categories. */
  categories?: Category[];
  /** schedule.daily: hour of day 0-23 in the workspace timezone. */
  hour?: number;
};

export const CONDITION_OPS = ["eq", "neq", "contains", "not_contains", "gt", "gte", "lt", "lte", "exists", "not_exists", "in"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
/** `field` is a record value key, or one of: "category", "priority", "intent", "channel", "source". */
export type AutomationCondition = { field: string; op: ConditionOp; value?: CellValue | CellValue[] };

export type AutomationAction =
  | { type: "notify"; title: string; body?: string; to: "all" | "admins" | string[] }
  | { type: "set_field"; key: string; value: CellValue }
  | { type: "create_record"; collectionId: string; values: Record<string, CellValue> }
  /** Delivers to a registered outbound webhook endpoint (signed, logged, retried). */
  | { type: "webhook"; endpointId: string }
  | { type: "reminder"; afterMinutes: number; title: string; body?: string }
  | { type: "reply"; text: string }
  | { type: "add_tag"; tag: string };

/* ------------------------------------------------------------------ */
/*  Actors & audit                                                     */
/* ------------------------------------------------------------------ */

export type ActorType = "user" | "api_key" | "system" | "pipeline" | "automation";
export type Actor = { type: ActorType; id: string | null; label?: string };

/* ------------------------------------------------------------------ */
/*  API DTOs                                                           */
/* ------------------------------------------------------------------ */

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };
export type Page<T> = { items: T[]; nextCursor: string | null };

export type UserDTO = { id: string; email: string; name: string; createdAt: string };
export type WorkspaceDTO = { id: string; name: string; slug: string; settings: WorkspaceSettings; createdAt: string };
export type MeDTO = {
  user: UserDTO;
  workspace: WorkspaceDTO | null;
  role: Role | null;
  workspaces: { id: string; name: string; slug: string; role: Role }[];
  /** Single-user auto sign-in is on (no login, logout or passwords). */
  autoLogin?: boolean;
};
export type MemberDTO = { userId: string; email: string; name: string; role: Role; joinedAt: string };
export type InvitationDTO = { id: string; email: string; role: Role; expiresAt: string; createdAt: string; acceptedAt: string | null; /** Only on create. */ url?: string };
export type ApiKeyDTO = { id: string; name: string; prefix: string; scopes: ApiScope[]; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; /** Only on create — shown once. */ key?: string };

export type ChannelDTO = {
  id: string;
  type: ChannelType;
  name: string;
  status: "active" | "paused" | "error";
  externalId: string | null;
  config: Record<string, unknown>;
  /** Names of secrets that are set (values are never returned). */
  secretsSet: string[];
  /** Where the provider should send webhooks (absolute URL). */
  webhookUrl: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export type ContactDTO = { id: string; displayName: string; phone: string | null; email: string | null; handles: Record<string, string>; tags: string[]; notes: string; createdAt: string; updatedAt: string };

export type ConversationDTO = {
  id: string;
  channelId: string;
  channelType: ChannelType;
  externalId: string;
  title: string;
  isGroup: boolean;
  contactId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  unreadCount: number;
  archived: boolean;
  /** Agents extract records from this chat ("agents on selected chats"). */
  agentsEnabled: boolean;
};

export type AttachmentDTO = { name: string; mime: string; size: number | null; fileId: string | null; url: string | null };

export type MessageDTO = {
  id: string;
  conversationId: string;
  channelId: string;
  contactId: string | null;
  externalId: string;
  direction: "inbound" | "outbound";
  senderName: string;
  senderHandle: string | null;
  kind: MessageKind;
  text: string;
  attachments: AttachmentDTO[];
  sentAt: string;
  receivedAt: string;
  status: MessageStatus;
  classification: MessageClassification | null;
  eventId: string | null;
};

export type EventDTO = {
  id: string;
  messageId: string;
  source: Source;
  status: EventStatus;
  attempts: number;
  result: ProcessingResult | null;
  error: string | null;
  durationMs: number | null;
  model: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type CollectionDTO = {
  id: string;
  name: string;
  description: string;
  icon: string;
  template: TemplateId;
  fields: Field[];
  routing: CollectionRouting;
  matchFields: string[];
  autopilot: boolean;
  recordCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type RecordDTO = {
  id: string;
  collectionId: string;
  values: Record<string, CellValue>;
  fieldMeta: Record<string, FieldMeta>;
  status: string | null;
  contactId: string | null;
  conversationId: string | null;
  origin: "pipeline" | "manual" | "api" | "automation" | "import";
  version: number;
  sourceMessageIds: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type RecordSourceDTO = {
  messageId: string;
  fieldKey: string | null;
  evidence: string | null;
  confidence: number | null;
  message: { text: string; senderName: string; sentAt: string; conversationId: string } | null;
};

export type ProposedOperation = {
  action: "CREATE_RECORD" | "UPDATE_RECORD";
  collectionId: string;
  recordId: string | null;
  values: Record<string, CellValue>;
  fieldMeta: Record<string, FieldMeta>;
  matchKey: string | null;
  contactId: string | null;
  conversationId: string | null;
  messageId: string | null;
  eventId: string | null;
};

export type ReviewItemDTO = {
  id: string;
  kind: "low_confidence" | "conflict" | "ambiguous_target" | "missing_required" | "classification";
  reason: string;
  status: "open" | "approved" | "rejected";
  collectionId: string | null;
  recordId: string | null;
  messageId: string | null;
  eventId: string | null;
  proposed: ProposedOperation | null;
  current: Record<string, CellValue> | null;
  conflicts: FieldConflict[];
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
};

export type AutomationDTO = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AutomationRunDTO = { id: string; automationId: string; triggerType: string; subjectId: string | null; status: "success" | "failed" | "skipped"; output: unknown; error: string | null; createdAt: string };

export type WebhookEndpointDTO = { id: string; url: string; description: string; events: DomainEventType[]; enabled: boolean; lastDeliveryAt: string | null; lastStatus: number | null; failureCount: number; createdAt: string; /** Only on create — shown once. */ secret?: string };
export type WebhookDeliveryDTO = { id: string; endpointId: string; eventType: string; status: "pending" | "delivered" | "failed"; attempts: number; responseStatus: number | null; error: string | null; createdAt: string; deliveredAt: string | null };

export type NotificationDTO = { id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };

export type AuditEntryDTO = { id: string; actorType: ActorType; actorId: string | null; actorLabel: string | null; action: string; targetType: string; targetId: string | null; before: unknown; after: unknown; meta: unknown; createdAt: string };

export type SearchHitDTO =
  | { type: "message"; id: string; conversationId: string; title: string; snippet: string; at: string; score: number }
  | { type: "record"; id: string; collectionId: string; title: string; snippet: string; at: string; score: number }
  | { type: "contact"; id: string; title: string; snippet: string; at: string; score: number };

export type AnalyticsDTO = {
  range: { from: string; to: string; days: number };
  totals: { messages: number; processed: number; needsReview: number; failed: number; recordsCreated: number; recordsUpdated: number; openReviews: number; contacts: number };
  byDay: { date: string; messages: number; records: number }[];
  byCategory: { category: Category; count: number }[];
  byPriority: { priority: Priority; count: number }[];
  bySource: { source: Source; count: number }[];
  collections: { id: string; name: string; icon: string; records: number; valueSum: number | null; byStatus: { status: string; count: number }[] }[];
  pipeline: { avgLatencyMs: number | null; p95LatencyMs: number | null; aiShare: number; autoApplyRate: number };
};

export type AssistantAnswerDTO = {
  answer: string;
  /** Facts grounded in workspace data, each with its supporting message/record ids. */
  facts: { text: string; messageIds: string[]; recordIds: string[] }[];
  /** AI-generated suggestions, clearly separated from facts. */
  suggestions: string[];
  citations: { messageId: string; text: string; senderName: string; sentAt: string; conversationId: string }[];
  engine: "rules" | "ai";
};

export type CollectionPlanDTO = { name: string; description: string; icon: string; template: TemplateId; fields: Field[]; routing: CollectionRouting; matchFields: string[] };
