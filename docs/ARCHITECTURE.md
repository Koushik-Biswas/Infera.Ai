# Infera backend — architecture & contracts

Infera turns business conversations (WhatsApp, Telegram, email, Slack, SMS, any API source) into
structured, searchable records — automatically, traceably, with humans in the loop where it matters.

This document is the **contract** between modules. If you implement a module, follow the file
ownership, function signatures and API shapes here exactly; other modules are written against them.

---

## 0. Stack & ground rules

- Next.js 16 App Router (route handlers in `app/api/**/route.ts`), React 19, TypeScript strict, Tailwind v4.
- PostgreSQL via Drizzle ORM. `DATABASE_URL` → node-postgres; unset → embedded **PGlite** (real Postgres in WASM).
  `const db = await getDb()` from `lib/server/db`. Schema: `lib/server/db/schema.ts` (do NOT edit without telling the integrator; a migration must be generated).
- Tests: Vitest, `tests/**/*.test.ts`, each file gets a fresh in-memory Postgres. Helpers in `tests/helpers.ts`
  (`createTestWorkspace()`, `addMember()`, `call(handler, {...})`). Run `npx vitest run tests/<file>`.
- Typecheck: `npx tsc --noEmit`. Never leave type errors in files you own.
- No new npm dependencies without a strong reason (allowed already: drizzle-orm, pg, @electric-sql/pglite, zod 4, @anthropic-ai/sdk, fflate, lucide-react, motion, qrcode.react).
- zod is **v4** (`import { z } from "zod"`). Use `z.object`, `z.enum`, `z.string().min()`, etc.
- Next 16 route handler params are async: `({ params }: { params: Promise<{ id: string }> })`. The wrappers below handle this — use `c.params.id`.

### The 18 behaviour rules (from the product spec) and where they are enforced

| # | Rule | Enforced in |
|---|------|-------------|
| 1-3 | Never hallucinate business info / customer details / amounts or dates | pipeline evidence check (`pipeline/verify-evidence.ts`): every AI value must be supported by a verbatim quote found in the message; numbers/dates must be derivable from the quote; otherwise dropped to null + warning |
| 4 | Never silently overwrite conflicting info | `records/ops.ts` machine-mode guards → `conflicts` → review item |
| 5 | Never delete without authorisation | only `softDeleteRecord`, only from admin-role routes or API keys with `delete` scope; pipeline never deletes |
| 6 | Never access another workspace | every query filters `workspace_id = c.auth.workspaceId`; cross-tenant ids return 404 |
| 7 | Never expose confidential data | secrets AES-GCM encrypted, never returned by APIs; logs carry no PII; PII redaction before AI calls |
| 8 | No unauthorised external actions | automations' `webhook`/`reply` actions require workspace `allowExternalActions` + admin-created automation |
| 9 | Never claim success without confirmation | records read back (`verified`), webhook deliveries record HTTP status, results only "processed" after commit |
| 10 | Source traceability | `record_sources`, `field_meta.messageId/evidence`, `source_references` in results, audit `meta.sources` |
| 11 | Facts vs AI suggestions | `FieldMeta.source` (`extracted` vs `ai_suggested`), result `suggestions[]`, assistant `facts` vs `suggestions` |
| 12 | null for unknown | `normalizeValue` → null; AI schema allows null |
| 13 | Confidence scores | every entity + field meta has `confidence` 0..1 |
| 14 | Ask when critical info ambiguous | `required` fields missing/low confidence → review item `missing_required` / `low_confidence` |
| 15 | Deterministic validation | `records/coerce.ts` |
| 16 | Respect automation rules | `automations/*` |
| 17 | Contextual consistency | pipeline uses recent conversation messages + the contact's existing open record as context |
| 18 | Minimise processing | rules classifier first; AI only when needed (`aiMode: assist`); `skipped` for chit-chat/spam; dedupe of webhooks |

---

## 1. Module ownership (files you may create/edit)

Foundation (integrator-owned, read-only for modules unless stated): `lib/shared/types.ts`, `lib/server/db/**`,
`lib/server/api/handler.ts`, `lib/server/auth/session.ts`, `lib/server/records/**`, `lib/server/jobs/{queue,registry,scheduler}.ts`,
`lib/server/events/bus.ts`, `lib/server/audit.ts`, `lib/server/crypto.ts`, `lib/server/ids.ts`, `lib/server/env.ts`,
`lib/server/usage.ts`, `lib/server/templates.ts`, `lib/server/ai/{client,redact}.ts`, `lib/client/api.ts`, `tests/helpers.ts`,
`instrumentation.ts`, `next.config.ts`.

| Module | Owns |
|---|---|
| **auth** | `lib/server/auth/*` (except session.ts), `lib/server/workspaces.ts`, `app/api/auth/**`, `app/api/workspaces/**`, `app/api/invitations/**`, `app/api/v1/workspace/**`, `app/api/v1/members/**`, `app/api/v1/invitations/**`, `app/api/v1/api-keys/**`, `tests/auth*.test.ts` |
| **pipeline** | `lib/server/pipeline/**` (replace the stubs `job.ts`, `backfill.ts`, `apply.ts`), `lib/server/ai/pipeline.ts`, `app/api/v1/events/[id]/**`, `app/api/v1/playground/**`, `app/api/v1/collections/[id]/backfill/route.ts`, `tests/pipeline*.test.ts` |
| **channels** | `lib/server/channels/**` (replace stubs `ingest.ts`, `jobs.ts`; keep `types.ts` shape), `app/api/webhooks/**`, `app/api/v1/channels/**`, `app/api/v1/events/route.ts` (GET list + POST ingest), `app/api/v1/imports/**`, `app/api/v1/conversations/[id]/reply/route.ts`, `tests/channels*.test.ts` |
| **automations** | `lib/server/automations/**` (replace stubs `jobs.ts`, `match.ts`), `lib/server/notify.ts`, `app/api/v1/automations/**`, `app/api/v1/review/**`, `app/api/v1/webhooks/**`, `app/api/v1/notifications/**`, `app/api/cron/route.ts`, `tests/automations*.test.ts`, `tests/review*.test.ts` |
| **data** | `lib/server/data/**` (DTO mappers, queries), `lib/server/ai/assistant.ts`, `app/api/v1/collections/route.ts`, `app/api/v1/collections/[id]/route.ts`, `app/api/v1/collections/[id]/records/**`, `app/api/v1/collections/[id]/export/**`, `app/api/v1/collection-templates/**`, `app/api/v1/collection-plans/**`, `app/api/v1/records/**`, `app/api/v1/conversations/route.ts`, `app/api/v1/conversations/[id]/route.ts`, `app/api/v1/conversations/[id]/messages/**`, `app/api/v1/messages/**`, `app/api/v1/contacts/**`, `app/api/v1/files/**`, `app/api/v1/search/**`, `app/api/v1/analytics/**`, `app/api/v1/audit/**`, `app/api/v1/assistant/**`, `app/api/v1/export/**`, `app/api/v1/openapi.json/route.ts`, `tests/data*.test.ts` |
| **console-shell** | `components/console/**`, `app/console/layout.tsx`, `app/console/page.tsx`, `app/console/settings/**`, `app/(auth)/**` (login, signup, invite, onboarding), additions to `lib/client/*` (new files only) |
| **deploy** | `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.github/**`, `vercel.json`, `README.md`, `.env.example`, `.gitignore`, `docs/DEPLOYMENT.md`, `docs/API.md`, `app/api/health/route.ts` |

Do not edit files owned by another module. If you need something from another module that doesn't exist yet,
code against the contract in this document (the integrator wires things together).

---

## 2. Conventions

### Route handlers
Use the wrappers from `lib/server/api/handler.ts`:

```ts
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { workspaceRoute, created, notFound, conflict } from "@/lib/server/api/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute<{ id: string }>({ role: "viewer", scope: "read" }, async (c) => {
  const row = await c.db.query.collections.findFirst({ where: (t, { and, eq }) => and(eq(t.id, c.params.id), eq(t.workspaceId, c.auth.workspaceId)) });
  if (!row) throw notFound("Collection");
  return toCollectionDTO(row);       // plain object → 200
});
```

- `publicRoute(opts, fn)` — no auth (webhooks verify signatures themselves; login/signup).
- `userRoute(opts, fn)` — signed-in user; `c.user`, `c.sessionId`, `c.workspaceId` (may be null).
- `workspaceRoute({ role, scope }, fn)` — `c.auth: AuthContext` (`workspaceId`, `role`, `actor`, `userId`, `apiKeyId`, `scopes`).
  `scope` omitted → API keys are rejected. Routes needing `admin`/`owner` are never usable with API keys.
- Return a plain object (200), `created(obj)` (201), `null` (204), or a `Response`.
- Throw `ApiError` helpers: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `unavailable`.
- Body: `const body = await c.body(zodSchema)` (JSON only, size-capped, 422 on invalid).
- Error JSON shape: `{ error: { code, message, details? } }`.
- Lists: `{ items: T[], nextCursor: string | null }` with keyset pagination (`encodeCursor`, `decodeCursor`, `pageLimit`).
- Always add `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`.

### Roles & scopes
| Action | Min role | API scope |
|---|---|---|
| Read data (records, messages, analytics, audit) | viewer | read |
| Create/edit records, resolve reviews, create collections, assistant, reprocess, reply | member | write |
| Ingest events | — | ingest (API key) |
| Delete records | admin | delete |
| Channels, automations, outbound webhooks, API keys, members, invites, workspace settings, data export | admin | (none — session only) |
| Delete workspace, change owner | owner | (none) |

### Tenancy (rule 6)
Every query on a tenant table includes `eq(table.workspaceId, c.auth.workspaceId)`. Ids from the URL or body that
belong to another workspace → **404**, never 403 (don't leak existence). Tests must cover this for every resource.

### Writing records
Only via `lib/server/records/ops.ts`: `createRecord`, `updateRecord` (`mode: "human" | "machine"`), `softDeleteRecord`, `restoreRecord`.
They normalise values, guard human edits, version, add `record_sources`, audit, emit domain events, and verify.

### Ids, time, logging
- Ids: `newId("rec")` etc. (`lib/server/ids.ts`). Never let the AI produce ids.
- Timestamps are `Date` in Drizzle, ISO strings in DTOs (JSON serialisation does it).
- Logs: `log(level, event, fields)` from `lib/server/http.ts`. **Never log message text, names, phones, emails, tokens.**

### Audit
`writeAudit(db, { workspaceId, actor, action, targetType, targetId, before, after, meta })` for every mutation that isn't
already audited by `records/ops.ts` (e.g. `collection.create`, `channel.create`, `member.role_change`, `api_key.create`,
`automation.update`, `review.approve`, `workspace.settings_update`). Never include secrets.

### Domain events
`emitDomainEvent(tx, { type, workspaceId, actor, data })` — inside the same transaction as the change.
Types: `message.received`, `message.processed`, `record.created`, `record.updated`, `record.status_changed`,
`record.deleted`, `review.created`, `review.resolved`. Record ops emit the record.* ones automatically.

### Jobs
`enqueue(db, { type, payload, workspaceId, priority, runAt, dedupeKey })`. Handlers are wired in `lib/server/jobs/registry.ts`.
Types: `process_message` {eventId}, `backfill_collection` {workspaceId, collectionId, since?, until?}, `domain_event` (DomainEvent),
`deliver_webhook` {deliveryId}, `send_reply` {workspaceId, conversationId, text, actor}, `reminder` {workspaceId, title, body, link, userIds|null},
`retention_sweep` {}, `schedule_tick` {at}. In tests run them with `drainJobs()` from `lib/server/jobs/queue`.
After enqueueing interactive work from a route, call `kickSoon()` (`lib/server/jobs/kick.ts`) so it runs right after the response (no-op in tests).

### AI
`runStructured({ schema, system, user, effort, workspaceId, purpose })` from `lib/server/ai/client.ts` (zod structured output,
prompt-cached system prompt, refusal fallbacks, usage metering). `aiConfigured()` false → rules-only behaviour must still work
end-to-end (tests run without an API key). Respect workspace `settings.aiMode` and `settings.redactPII` (`redactPII`/`restorePII`
in `lib/server/ai/redact.ts`). Include `DATA_RULE` in every system prompt.

---

## 3. Pipeline (module **pipeline**)

Entry: `handleProcessMessage({ eventId })` (job, `pipeline/job.ts`). Also exports (signatures fixed by the stubs already in place):
`processEvent(eventId, { force? })` and `dryRunProcess(db, workspaceId, input)` in `pipeline/run.ts`, `applyProposedOperation(db, {...})` in
`pipeline/apply.ts` (review approvals), `handleBackfillCollection(...)` in `pipeline/backfill.ts`.

Steps (record each in `processing_metadata.steps` with timing):

1. **Load** event + message + conversation + contact + channel (same workspace). If event already `processed` and not a forced reprocess → return stored result. Mark event `processing`, `attempts+1`, message status `processing`.
2. **Validate** message: empty text and no attachments → `skipped`. Deleted/system kinds → `skipped`.
3. **Classify (rules first)** — `pipeline/classify.ts`: deterministic keyword/regex classifier → `{category, intent, priority, confidence}`.
   Reuse the vocab in `lib/app/extract.ts` (PAID, PENDING_PAY, COMPLAINT, REQUEST... — copy patterns you need; they are module-private there).
   Priority: `urgent` for urgent/asap/emergency/legal threats/refund+angry; `high` for purchase intent with budget, complaints, payment issues; `low` for greetings/acks.
   Spam/greeting/ack with confidence ≥ 0.85 → `skipped` early (rule 18) unless a collection's keywords match.
4. **AI classification** (only if `aiMode === "full"`, or `aiMode === "assist"` and rules confidence < 0.75, and AI configured):
   `lib/server/ai/pipeline.ts` — ONE structured call returning classification + per-collection entities, with the last ~15 messages of the
   conversation as context (rule 17) and the target collections' field specs. Redact PII first if enabled.
5. **Route** — `pipeline/route.ts`: collections (non-archived, `autopilot` true) whose `routing.categories` include the category,
   or whose `routing.keywords` appear in the text, filtered by `routing.channelIds`. Zero → no record op (`NO_OP`), still `processed`.
6. **Extract** — `pipeline/extract.ts`: deterministic extractors per field type (amount via `bestAmount`, phone via `findPhones`,
   email, url, dates via `findDueDate` relative to `sentAt`, item via `findItem`, location via `findLocation`, status via status vocab,
   person name: sender name/contact for name-like fields, "my name is X"). Each entity: `{field, value, confidence, evidence, method}`.
   Metadata-derived values (sender phone, sender name, message date) use `method: "metadata"`, evidence null, confidence 0.9-1.
   Merge AI entities: AI wins only where rules found nothing or AI confidence is higher **and** evidence verifies.
7. **Verify evidence (anti-hallucination)** — `pipeline/verify-evidence.ts`: for each AI entity, `evidence` must be a (case/space-insensitive)
   substring of the message text (or the provided context messages); numeric values' digits must appear in the evidence (allowing k/lakh
   multipliers and thousands separators); dates must be derivable via `normalizeValue(date, evidence, sentAt)`. Fail → drop value to
   null, add warning `evidence_not_found` / `value_not_in_evidence`, and add a `Suggestion` (type `field_value`) instead.
8. **Normalise** via `normalizeValue` (records/coerce.ts). Invalid → null + warning.
9. **Decide** per collection — `pipeline/decide.ts`:
   - Compute match key (`computeMatchKey(collection.matchFields, values, {contactId, conversationId})`).
   - Find existing live record by match key; else if no key could be computed, the most recently updated **open** record
     (status not terminal: not Delivered/Cancelled/Won/Lost/Paid/Refunded/Resolved/Done) for the same contact (or conversation) in this
     collection updated in the last 30 days.
   - A soft-deleted record with the same match key → `NO_OP` + warning `record_deleted_by_user` (don't resurrect what a person deleted).
   - Values with confidence ≥ `settings.autoApplyThreshold` are applied; between `reviewThreshold` and `autoApplyThreshold` → the
     operation is held for review (`PENDING_REVIEW`) with kind `low_confidence`; below `reviewThreshold` → dropped into `suggestions`.
   - Create requires every `required` field to have a value ≥ autoApply threshold; otherwise `PENDING_REVIEW` kind `missing_required`
     (rule 14) — unless the message clearly doesn't belong (no field extracted at all → NO_OP).
   - Update with `conflicts` returned by `updateRecord` → create review item kind `conflict` with the conflicting values (applied
     non-conflicting changes stay applied).
10. **Execute** inside ONE transaction per message: `createRecord`/`updateRecord` (machine mode, `fieldMeta` per value with
    source `extracted` (rules/metadata) or `extracted` with method `ai` when verified; `sources` with messageId/eventId/evidence),
    `DuplicateRecordError` → retry as update. Review items inserted (`review_items`) + `review.created` domain event.
    Then `message.processed` domain event (data: messageId, eventId, category, priority, intent).
11. **Verify & respond** — use `verified` from record ops. Build the `ProcessingResult` (`lib/shared/types.ts`) — `record_operation` is the first
    of `record_operations` (or null). `automation`: `matchAutomations(db, event)` for each emitted domain event → status `"queued"`.
    Persist on `events.result`, set `events.status` (`processed` | `needs_review` | `skipped` | `failed`), `durationMs`, `model`, `processedAt`;
    message `status` + `classification` + `eventId`. Bump usage (`events_processed`, `records_created`, `records_updated`).
    On exception: event `failed` with error message (no PII), message `failed`, rethrow so the job retries (AI errors with `retryable`).

`applyProposedOperation(db, { workspaceId, proposed, actor, overrides, reviewItemId })`: re-validate collection/record still exist in workspace;
apply via record ops — machine values with `allowOverrideEdited: true` (a human approved them), overrides as `mode: "human"`; return a
`RecordOperation` with `status: "completed"`, verified flag.

`handleBackfillCollection`: enqueue `process_message` jobs (priority 200) for the workspace's messages in the window (default last 30 days)
that are in the collection's channels — re-using each message's event (status reset to queued). Cap 5000 messages; log the cap.

Routes (pipeline):
- `GET /api/v1/events/:id` (viewer, read) → `EventDTO` (with `result`).
- `POST /api/v1/events/:id/reprocess` (member, write) → enqueues reprocess, `202 { eventId, status: "queued" }`; `?sync=1` processes inline and returns `EventDTO`.
- `POST /api/v1/playground` (member, write) body `{ text, senderName?, senderPhone?, source?, collectionIds? }` → dry-run `ProcessingResult` (status `processed`/`needs_review`, operations with `status: "pending"`, nothing written).
- `POST /api/v1/collections/:id/backfill` (member, write) body `{ since?: ISO, until?: ISO }` → `202 { queued: number }`.

---

## 4. Channels (module **channels**)

Normalised input `InboundMessage` (`lib/server/channels/types.ts`) → `ingestInboundMessage(db, input): Promise<IngestResult>`:
one transaction: upsert contact (match by phone, then email, then `handles[channelType]`), upsert conversation (channelId+externalId),
insert message with `onConflictDoNothing` on (channelId, externalId) → duplicate → return `{duplicate: true}` with the existing ids,
store attachments with bytes in `files` (≤ `maxMediaBytes()`), create `events` row (`queued`, source = `sourceOf[channel.type]`),
set `messages.eventId`, update conversation preview/lastMessageAt/unread, channel `lastEventAt`, enqueue `process_message` (priority from input,
default 50; skip if `skipProcessing`), emit `message.received`, bump usage `messages_ingested`.
Outbound messages (`direction: "outbound"`, e.g. sent by the business) are stored but not processed unless they change state (keep simple: store + process with `fromMe` context... process outbound too — the pipeline uses them as context; classification of outbound is allowed, e.g. "Payment received, thanks!" marks Paid).

Adapters (`lib/server/channels/adapters/*.ts`), each exporting `parse*()` (pure, unit-tested) + signature verification:
- **whatsapp_cloud** — Meta WhatsApp Business Cloud API. `GET` verification (`hub.mode=subscribe`, `hub.verify_token`, return `hub.challenge`).
  `POST` with `X-Hub-Signature-256: sha256=<hmac of raw body with app secret>` (constant-time compare). Payload `entry[].changes[].value`
  with `metadata.phone_number_id` (→ channel.externalId), `contacts[]` (wa_id, profile.name), `messages[]` (id, from, timestamp, type: text/image/
  document/audio/video/location/contacts/interactive/button/reaction), `statuses[]` (ignore). Shared app: `/api/webhooks/whatsapp` using env
  `WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN`, routes by phone_number_id. Per-channel app: `/api/webhooks/whatsapp/[token]` with the
  channel's own `appSecret`/`verifyToken` secrets. Media: download via Graph API (`GET https://graph.facebook.com/v21.0/{media-id}` with
  `accessToken` → url → GET bytes) lazily in a best-effort step; failures don't fail ingestion. Outbound reply: `POST /{phone_number_id}/messages`.
- **telegram** — `/api/webhooks/telegram/[token]`, header `X-Telegram-Bot-Api-Secret-Token` must equal the channel's `webhookSecret`.
  Update `message`/`edited_message`/`channel_post`: chat.id → conversation, from → sender, text/caption, photo/document/voice. Reply: `sendMessage`.
  On channel create with `botToken`, optionally call `setWebhook` (only if the admin ticks "register webhook"; external action).
- **email** — `/api/webhooks/email/[token]` inbound-parse JSON (Postmark `From/To/Subject/TextBody/MessageID/Attachments`, Mailgun/SendGrid
  multipart form `from/to/subject/text/body-plain/Message-Id`, or generic `{from, to, subject, text, messageId, date}`), auth via
  `?key=` query secret or `X-Infera-Token` header compared constant-time to the channel's `inboundSecret`. Conversation = normalised subject
  thread (strip Re:/Fwd:) + sender address. Text = subject + "\n\n" + body without quoted replies/signatures (best effort).
- **slack** — `/api/webhooks/slack/[token]`, verify `X-Slack-Signature` = `v0=` + HMAC-SHA256(signingSecret, `v0:{ts}:{rawBody}`), reject
  if timestamp > 5 min old. `url_verification` → echo challenge. `event_callback` with `message` events (ignore bot messages/subtypes except
  file_share). Conversation = channel id. Reply: `chat.postMessage` with `botToken`.
- **sms_twilio** — `/api/webhooks/sms/[token]`, form-encoded, verify `X-Twilio-Signature` = base64 HMAC-SHA1(authToken, fullUrl + sorted
  params concatenated key+value). Fields `MessageSid, From, To, Body, NumMedia, MediaUrl0..`. Respond with empty TwiML `<Response/>`.
- **api** — `POST /api/v1/events` with API key scope `ingest` (or session member):
  `{ channel_id?, source?, conversation: { id, name?, is_group? }, sender: { id?, name?, phone?, email? }, message: { id, text, sent_at?, direction?, attachments?: [{name, mime, url?}] } }`
  → `202 { event_id, message_id, conversation_id, status: "queued" | "duplicate" }`. `?sync=1` waits for processing (≤ 25 s) and returns the
  `ProcessingResult`. If `channel_id` is omitted, use (create on demand) the workspace's default `api` channel named "API".
  `GET /api/v1/events` (viewer, read) lists events: filters `status`, `source`, `since`, cursor.
- **whatsapp_export** — `POST /api/v1/imports/whatsapp` (member, write) multipart `file` (.txt or .zip ≤ 50 MB) + `process` ("true"/"false")
  + optional `me` (your name in the export). Parse with `parseExportText`/zip handling from `lib/app/whatsapp.ts` (works in Node; `File`/`Blob`
  exist). Creates/uses a `whatsapp_export` channel; external ids = stable hash of (chat name, timestamp, sender, text). Returns
  `{ conversationId, imported, duplicates, queued }`. Processing priority 200.

Channel management (admin): `GET/POST /api/v1/channels`, `GET/PATCH/DELETE /api/v1/channels/:id`, `POST /api/v1/channels/:id/test`
(member) body `{ text, senderName? }` → ingests a synthetic inbound message on that channel and returns `{ eventId, messageId }`.
Create body: `{ type, name, externalId?, config?, secrets?: Record<string,string> }`. Secrets are encrypted (`encryptJson`) and never
returned; DTO has `secretsSet: string[]` and `webhookUrl` (`${appUrl()}/api/webhooks/<type>/<webhookToken>`; whatsapp shared mode
`${appUrl()}/api/webhooks/whatsapp`). PATCH can rotate secrets (merge). DELETE removes the channel (cascades its conversations/messages) —
admin only, audited. Secret names per type: whatsapp_cloud `accessToken, appSecret, verifyToken`; telegram `botToken, webhookSecret`;
email `inboundSecret`; slack `botToken, signingSecret`; sms_twilio `authToken, accountSid`.

Outbound: `sendOutbound(db, { workspaceId, conversationId, text, actor }): Promise<{ messageId: string; delivered: boolean; error?: string }>`
(`lib/server/channels/outbound.ts`) — uses the channel's provider API; stores an outbound message (status processed, not re-processed);
audited `message.send`. `POST /api/v1/conversations/:id/reply` (member, write) body `{ text }`. `handleSendReply` job calls `sendOutbound`.
Unsupported channel types (export/email without SMTP/api) → `{ delivered: false, error: "Replies are not supported on this channel" }`.

Webhook routes must: read the raw body (needed for signatures) via `await req.text()` / `arrayBuffer()` (NOT the JSON wrapper), cap size
(1 MB; 25 MB email), verify before parsing, respond 200 quickly (process via job), return 401/403 on bad signatures, 404 for unknown tokens,
rate-limit per channel, never log payload text.

---

## 5. Automations, review, webhooks, notifications (module **automations**)

- `handleDomainEventJob(event)`: (a) unless `event.actor.type === "automation"`, run every enabled automation whose trigger matches
  (`matchAutomations`), evaluating conditions against `event.data.values` + message context (`category`, `priority`, `intent`, `source`,
  `channel`). Record `automation_runs` (unique per automation+domainEventId → idempotent on retries). Actions:
  `notify` → notifications rows (`lib/server/notify.ts`), `set_field` → `updateRecord(mode machine, actor automation, confidence 1)`,
  `create_record` → `createRecord(origin automation)`, `add_tag` → contact tags, `reminder` → `enqueue("reminder", runAt now+afterMinutes)`,
  `webhook` `{endpointId}` → only if `settings.allowExternalActions` and the endpoint exists in the workspace and is enabled: creates a
  `webhook_deliveries` row for that endpoint (signed with the endpoint's secret) + `deliver_webhook` job,
  `reply` → only if `allowExternalActions`, enqueue `send_reply`. Skipped actions are recorded with reason.
  Bump usage `automations_run`. If `event.data.eventId` is set, patch `events.result.automation` entry for that automation with the final status.
  (b) fan out to `webhook_endpoints` subscribed to `event.type` → `webhook_deliveries` + `deliver_webhook` jobs.
- `handleDeliverWebhook({ deliveryId })`: POST JSON `{ id, type, created_at, workspace_id, data }` with headers
  `X-Infera-Event`, `X-Infera-Delivery`, `X-Infera-Signature: t=<unix>,v1=<hex hmac sha256 of "t.body">`; 10 s timeout; 2xx → delivered;
  else throw (job retry w/ backoff, max 6 attempts) and update attempts/responseStatus/error; endpoint `failureCount`, auto-disable after 20 consecutive failures.
  Block private/loopback/link-local destinations in production (SSRF): resolve DNS and reject 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7 unless `ALLOW_PRIVATE_WEBHOOKS=1`.
- `handleReminder`, `handleRetentionSweep` (delete messages/files older than `retentionDays` per workspace, in batches; records kept; audit `retention.sweep`),
  `handleScheduleTick` (fire `schedule.daily` automations whose hour matches in the workspace timezone; dedupe per day).
- `matchAutomations(db, event)` — pure matching, no side effects.
- `notify(db, { workspaceId, userIds: string[] | "all" | "admins", type, title, body, link })`.

Routes: `GET/POST /api/v1/automations` (list: viewer/read; create: admin), `GET/PATCH/DELETE /api/v1/automations/:id` (admin for writes),
`GET /api/v1/automations/:id/runs`, `POST /api/v1/automations/:id/test` (admin) body `{ recordId? }` → dry-run which conditions/actions
would fire. Validate actions with zod; `webhook` URL must be https in production. Templates endpoint `GET /api/v1/automations/templates`
returning a few ready-made automations (notify on high-priority lead, remind to follow up on pending payment after 24h, notify on new complaint).
- Review: `GET /api/v1/review?status=open|approved|rejected&cursor` (viewer/read) → `Page<ReviewItemDTO>`; `GET /api/v1/review/:id`;
  `POST /api/v1/review/:id/approve` (member/write) body `{ values?: Record<string, CellValue>, note? }` → `{ item: ReviewItemDTO, operation: RecordOperation }`
  via `applyProposedOperation`; `POST /api/v1/review/:id/reject` body `{ note? }`. Both: only `open` items (409 otherwise), audited, emit `review.resolved`,
  and update the originating event's `result.requires_human_review`/status when all its review items are resolved.
  `GET /api/v1/review/count` → `{ open: number }`.
- Outbound webhooks: `GET/POST /api/v1/webhooks`, `PATCH/DELETE /api/v1/webhooks/:id`, `GET /api/v1/webhooks/:id/deliveries`,
  `POST /api/v1/webhooks/:id/test` (sends a `ping` event). Secret generated server-side, returned once on create.
- Notifications: `GET /api/v1/notifications?unread=1` (for current user: rows with userId = me or null), `POST /api/v1/notifications/read` body `{ ids?: string[], all?: boolean }`.
- Cron: `GET|POST /api/cron` with `Authorization: Bearer ${CRON_SECRET}` (401 otherwise; 503 if CRON_SECRET unset in production) →
  `enqueueScheduledJobs()` then `drainJobs({ budgetMs: 25_000 })` → `{ ran }`.

---

## 6. Data API (module **data**)

DTO mappers in `lib/server/data/dto.ts` (`toCollectionDTO(row, recordCount)`, `toRecordDTO(row, sourceMessageIds)`, `toMessageDTO`, `toConversationDTO(row, channelType)`, `toContactDTO`, `toEventDTO`, `toAuditDTO`). Other modules may import these once they exist.

- Collections: `GET /api/v1/collections` (viewer/read) → `{ items: CollectionDTO[] }` (with recordCount, excludes archived unless `?archived=1`);
  `POST` (member/write) body `{ template?: TemplateId, name?, description?, icon?, fields?, routing?, matchFields?, autopilot? }` (template → `templatePlan()` defaults, overridable);
  `GET/PATCH /api/v1/collections/:id`; `DELETE` (admin) → archive (`archivedAt`), `?hard=1` (owner) → delete. Field key changes validated (unique keys, `^[a-zA-Z][a-zA-Z0-9_]{0,39}$`).
- `GET /api/v1/collection-templates` → `CollectionPlanDTO[]`. `POST /api/v1/collection-plans` (member) body `{ prompt }` → `CollectionPlanDTO`
  (AI via `lib/server/ai/assistant.ts` when configured, else rules: `planFromPrompt` from `lib/app/assistant.ts` adapted + templates).
- Records: `GET /api/v1/collections/:id/records?q=&status=&sort=updatedAt|-updatedAt|<fieldKey>|-<fieldKey>&cursor=&limit=&deleted=1`
  → `Page<RecordDTO>`; `POST` (member/write) body `{ values }` → `createRecord(origin "manual"|"api")`; `GET /api/v1/records/:id`;
  `PATCH /api/v1/records/:id` body `{ values, expectedVersion? }` (mode human); `DELETE` (admin or API `delete` scope) → soft delete;
  `POST /api/v1/records/:id/restore` (admin); `GET /api/v1/records/:id/history` → `{ audit: AuditEntryDTO[], sources: RecordSourceDTO[] }`.
- Export: `GET /api/v1/collections/:id/export?format=csv|xlsx|json` (viewer/read) — reuse `toCSV`/`toXLSX` logic from `lib/app/export.ts`
  (those helpers need `Blob`; port the pure parts into `lib/server/data/export.ts`). CSV must neutralise formula injection (prefix `'` for cells starting with = + - @).
- Conversations: `GET /api/v1/conversations?q=&channelId=&archived=&cursor=` → `Page<ConversationDTO>`; `GET/PATCH /api/v1/conversations/:id`
  (PATCH `{ archived?, read?: true }` → unread 0); `GET /api/v1/conversations/:id/messages?cursor=&limit=` (newest first) → `Page<MessageDTO>`.
- Messages: `GET /api/v1/messages/:id` → `MessageDTO & { event: EventDTO | null }`.
- Files: `GET /api/v1/files/:id` (viewer/read) → bytes with `Content-Type` (only safe inline types, else `attachment` disposition), `X-Content-Type-Options: nosniff`.
- Contacts: `GET /api/v1/contacts?q=&cursor=`, `GET/PATCH /api/v1/contacts/:id` (`displayName, tags, notes`) + `recordCount`, `conversationIds`.
- Search: `GET /api/v1/search?q=&type=all|messages|records|contacts&from=&to=&channelId=&limit=` → `{ items: SearchHitDTO[] }` using
  Postgres FTS (`to_tsvector('simple', ...) @@ websearch_to_tsquery('simple', q)` + `ts_rank`) with `ILIKE` fallback for short/partial queries.
- Analytics: `GET /api/v1/analytics?days=7|30|90` → `AnalyticsDTO` (SQL aggregates; collections' `valueSum` = sum of the first currency field).
- Audit: `GET /api/v1/audit?targetType=&targetId=&action=&cursor=` (admin) → `Page<AuditEntryDTO>`.
- Assistant: `POST /api/v1/assistant/ask` (member/write) body `{ question, threadId? }` → `AssistantAnswerDTO`. Retrieval: FTS over messages
  + records (top ~40) + aggregate helpers for common questions (pending payments, today's summary, counts). With AI: one structured call that must
  cite message ids **from the provided context only** (validate; drop unknown ids); answer split into `facts` (each with ids) and `suggestions`.
  Without AI: rules answer (search hits summary). Threads: `GET /api/v1/assistant/threads`, `GET /api/v1/assistant/threads/:id`.
- Full data export (rights requests): `GET /api/v1/export` (admin) → JSON download of the workspace's data (no secrets, no password hashes).
- `GET /api/v1/openapi.json` (public) → OpenAPI 3.1 document describing the API-key-usable endpoints (events ingest, events get, collections,
  records, conversations, messages, search, review, analytics) with bearer auth.

---

## 7. Console UI (module **console-shell**, then page modules)

Route map (all client components using `lib/client/api.ts`; design tokens from `app/globals.css`; reuse `components/app/ui.tsx`
(`Modal`, `Menu`, `MenuItem`, `Toggle`, `Chip`, `Empty`, `Avatar`, `Status`, `CollectionIcon`, `inputCls`, `money`, `shortDate`) and
`components/ui/button-class.ts` (`buttonClass(variant, size)`); icons from `lucide-react`):

- `/login`, `/signup`, `/invite/[token]`, `/onboarding` (create first workspace) — route group `app/(auth)/`.
- `/console` — Overview dashboard (analytics KPIs, charts, open reviews, recent events).
- `/console/inbox` (+ `/console/inbox/[conversationId]`) — conversations, messages with classification chips, per-message "processing result" drawer (JSON + human view), reprocess, reply.
- `/console/collections` (+ `/[id]`) — collections, create from template / AI plan, table with inline edit, provenance popover (source message, confidence, evidence, extracted vs AI vs manual), filters, export, backfill.
- `/console/review` — review queue with approve (with edits) / reject.
- `/console/search`, `/console/assistant`.
- `/console/automations` (+ `/[id]`), `/console/channels` (+ connect wizard, webhook URL, test message), `/console/playground`, `/console/audit`.
- `/console/settings` (workspace, AI & thresholds, privacy/retention), `/console/settings/members`, `/console/settings/api-keys`,
  `/console/settings/webhooks`, `/console/settings/data` (export, delete workspace).

The shell provides: `components/console/shell.tsx` (sidebar with the sections above + workspace switcher + notifications bell + user menu +
mobile nav), `components/console/kit.tsx` (PageHeader, Card, StatCard, Badge, CategoryBadge, PriorityBadge, ConfidenceMeter, SourceBadge,
DataTable, Drawer, JsonView, ConfirmDialog, Field/Input/Select/Textarea, EmptyState, ErrorState, Skeleton, Pagination/LoadMore, Tabs, CopyButton,
TimeAgo), and `components/console/session.tsx` (`useSession()` → MeDTO + `role`, `can(role)`; redirects to /login or /onboarding).

---

## 8. API reference (summary)

| Method & path | Auth | Module |
|---|---|---|
| POST /api/auth/signup `{name,email,password,workspaceName}` → MeDTO + cookie | public, rate-limited | auth |
| POST /api/auth/login `{email,password}` → MeDTO + cookie | public, rate-limited (5/min/IP + per email) | auth |
| POST /api/auth/logout | user | auth |
| GET /api/auth/me → MeDTO | user | auth |
| POST /api/auth/switch-workspace `{workspaceId}` → MeDTO | user (must be member) | auth |
| POST /api/auth/password `{currentPassword,newPassword}` (revokes other sessions) | user | auth |
| POST /api/workspaces `{name}` → WorkspaceDTO (creator = owner, default collections from `DEFAULT_TEMPLATES`, switches session) | user | auth |
| GET/PATCH /api/v1/workspace (PATCH admin: `{name?, settings?: Partial<WorkspaceSettings>}`) | viewer / admin | auth |
| DELETE /api/v1/workspace `{confirm: slug}` | owner | auth |
| GET /api/v1/members; PATCH /api/v1/members/:userId `{role}`; DELETE /api/v1/members/:userId | viewer / admin (owner for owner/admin changes; last owner protected; self-leave allowed) | auth |
| GET/POST /api/v1/invitations `{email, role}` → InvitationDTO (+ url once); DELETE /api/v1/invitations/:id | admin | auth |
| GET /api/invitations/:token → `{workspaceName, email, role, expired}`; POST /api/invitations/:token/accept (signed-in user, or `{name,password}` to sign up with the invited email) | public / user | auth |
| GET/POST /api/v1/api-keys `{name, scopes, expiresInDays?}` → ApiKeyDTO (+ key once, `ifk_live_` + 32 random); DELETE /api/v1/api-keys/:id (revoke) | admin | auth |
| channels / events / imports / webhooks / reply | see §4 | channels |
| events/:id, reprocess, playground, backfill | see §3 | pipeline |
| automations, review, outbound webhooks, notifications, cron | see §5 | automations |
| collections, records, conversations, messages, files, contacts, search, analytics, audit, assistant, export, openapi | see §6 | data |
| GET /api/health → `{status, checks: {database, encryptionKey, ai, worker}, version}` (503 when database is down) | public | deploy |

---

## 9. Performance requirements (instant navigation, < 100 ms click feedback)

These are mandatory for every console page and API route.

**Routing**
- Console routes stay **static**: pages and layouts under `app/console/**` are client components that fetch through `lib/client/api.ts`.
  Never call `cookies()`/`headers()` or fetch server data in console pages/layouts — that would make routes dynamic and slow down prefetching.
  (Auth: `proxy.ts` redirects signed-out visitors before the app loads; `SessionProvider` reads `/api/auth/me` with `persist: true`.)
- Internal navigation uses `next/link` (never `<a href>` or `window.location` for in-app routes). Sidebar/nav links prefetch the route
  (default viewport prefetch) **and** warm the page's main API data on intent: `onMouseEnter`/`onFocus`/`onTouchStart` → `prefetchApi(path)`.
- Instant click feedback: links show a pending indicator via `useLinkStatus()` (from `next/link`); every console route segment has a
  `loading.tsx` skeleton that matches the page layout (no layout shift when data arrives).
- `next.config.ts` sets `experimental.staleTimes` (dynamic 30 s, static 300 s) and the React Compiler — do not add manual
  `useMemo`/`useCallback` everywhere; keep components pure so the compiler can memoise them.

**Data (`lib/client/api.ts`)**
- `useApi(path, { keepPreviousData: true })` for paginated / filtered / searched lists — never flash a skeleton when changing page or filter.
- `useApi("/api/auth/me", { persist: true })` and other small, hot reads (review count, collections list) persist to sessionStorage for an instant first paint.
- Rows/cards that open a detail view call `prefetchApi(detailPath)` on hover/focus; detail views seed from list data with `peekCached()` when possible.
- Mutations are optimistic where safe: `setCached(path, updater)` immediately, then `api(...)`, then `invalidate(prefix)`; roll back on error with a toast.
- Search inputs use `useDebounced(value, 250)`; filter state changes are wrapped in `startTransition`.
- Run independent requests in parallel (several `useApi` hooks render concurrently) — no request waterfalls.
- `clearApiCache()` on logout and workspace switch.

**Rendering**
- Lists render at most ~100 rows at a time: paginate with `LoadMore` (cursor) or window long lists (render only rows in view).
- Heavy widgets (JSON viewer, charts, QR codes, rich editors) load with `next/dynamic` + a skeleton, so they don't weigh down route bundles.
- Buttons acknowledge clicks immediately (pending state within the same frame), and disable while pending to prevent double submits.
- Animations in the console: CSS transitions ≤ 150 ms only; no `motion` library in console routes.

**API routes**
- One query per list endpoint (plus at most one batched follow-up, e.g. `inArray` for related ids). Never N+1.
- Select only the columns the DTO needs for lists; always `LIMIT`; use indexed columns in `WHERE`/`ORDER BY`.
- The route wrapper adds `Server-Timing: app;dur=…` — keep typical list endpoints under 50 ms on the embedded DB.

---

## 10. Live sync & realtime (implemented foundation)

**Channel types** (`CHANNEL_TYPES`): webhook-based `whatsapp_cloud` (official; + Business-app coexistence history/echoes),
`telegram` (bot), `email` (inbound parse), `slack`, `sms_twilio`, `instagram`, `messenger` (Meta webhooks), `linkedin`
(Unipile webhooks), `api`, `whatsapp_export`; **persistent** (`PERSISTENT_CHANNEL_TYPES`): `whatsapp_web` (EXPERIMENTAL
linked device via QR — unofficial, requires `channel.config.riskAcknowledged === true`), `telegram_user` (personal account,
MTProto), `email_imap` (IMAP IDLE + SMTP). `sourceOf` maps them to sources incl. `instagram`, `messenger`, `linkedin`.

**Sync manager** (`lib/server/sync/manager.ts`, started by `lib/server/boot.ts` when `INFERA_SYNC !== "off"` and the worker
is on): runs one connector per persistent channel under a DB lease (45 s, renewed every 10 s; failover to another instance on
expiry), executes console commands, restarts failures with backoff 30 s → 10 min. Connectors implement
`ConnectorFactory` from `lib/server/sync/types.ts` (read it: `ctx.update`, `ctx.ingest/ingestMany`, `ctx.getAuth/setAuth`
(encrypted), `ctx.kv` (encrypted KV, e.g. Signal keys), `ctx.getCursor/setCursor`, `ctx.signal`, `ctx.fail`, `ctx.log`).
Implementations live in `lib/server/sync/connectors/{whatsapp-web,telegram-user,email-imap}.ts` (lazy-loaded via
`registry.ts`). State: `connector_sessions` (state, qr, pairingCode, account, progress, cursor, authEnc, lease, command).

**Connection API**: `GET /api/v1/channels/:id/connection` → `ConnectionDTO`; `POST` (admin) `{ action: connect | disconnect |
logout | resync | pair_code, phone? }` → `ConnectionDTO` (503 `sync_unavailable` on serverless; 409 `risk_ack_required` for
whatsapp_web without acknowledgement). Webhook channels report `realtime: "webhook"`; they may still use
`updateConnectorSession(db, channel, { state: "syncing", progress })` from `lib/server/sync/session.ts` to show history-sync progress
(e.g. WhatsApp coexistence `history` webhooks, Meta/Unipile backfills).

**Realtime**: every domain event (and `channel.status` from `updateConnectorSession`/`sendConnectionCommand`) is published with
`pg_notify('infera_rt')` inside the writing transaction (delivered on commit, ids only). `GET /api/v1/stream` is a workspace-scoped
SSE stream (`event: <type>`, `data: RealtimeEvent`). Browser: mount `useRealtime()` (lib/client/realtime.ts) once in the console
shell — it invalidates the right `useApi` caches automatically (coalesced every 300 ms); use `useRealtimeEvent(handler, types)` for
toasts/highlights and `useRealtimeStatus()` for a live dot. Job enqueue sends `pg_notify('infera_jobs')`, so workers start
processing a new message immediately (the 2 s poll is only a fallback).

---

## 11. Encryption at rest & agents per chat (implemented)

**Sealed content** (`lib/server/data/sealed.ts`): `messages.text`, `conversations.last_message_preview`, `files.data` and
assistant thread text are AES-256-GCM encrypted with a key derived from `ENCRYPTION_KEY` (held by the app server, never in the
database; `ENCRYPTION_KEY_PREVIOUS` is tried on decrypt for rotation). Strings are stored as `enc:v1.…`; read them with
`openText()` / `openBytes()` — routes must map rows through `lib/server/data/dto.ts`, never return raw rows. Structured results
(`records.values`, processing results, evidence snippets) stay readable so tables can be filtered and sorted. Rows written before
this existed are sealed in the background at boot (`sealLegacyContent`).

**Search over sealed text**: `messages.search_tokens` is a blind index — HMAC-SHA256 (key derived from `ENCRYPTION_KEY`) of every
word and every word prefix ≥ 3 chars; a query matches when the row contains the hash of each query word (`@>`, GIN index). Rotating
`ENCRYPTION_KEY` requires rebuilding the index (set `search_tokens = null` and let `sealLegacyContent` re-index).

**Agents on selected chats**: `conversations.agents_enabled` (default true; false for new chats when the channel's
`config.chatSelection === "selected"`). Messages in chats with agents off are stored and searchable but never classified or
extracted, and backfills skip them. Toggle per chat in the Inbox (`PATCH /api/v1/conversations/:id { agentsEnabled }`).

**Data API & console** (§6, §7): conversations/messages/files, collections (+ `collection-plans`: prompt → plan with an optional
`since` from phrases like "last month", accepted with `POST /api/v1/collections { …plan, backfillSince }`), records, export,
search, assistant (`ask`, threads) and analytics; pages `/console/inbox`, `/console/collections(/[id])`, `/console/search`,
`/console/assistant`. Tests: `tests/data-api.test.ts`.

---

## 12. One-click connect (contract)

Goal: connecting any channel is **one click or one QR scan**. Users never type api_id/api_hash, IMAP/SMTP hosts,
webhook URLs, Unipile DSNs/keys, Page IDs or Meta tokens. Platform credentials live in env; a missing variable hides
that option in the console ("Not configured by admin"). All secrets are encrypted (`encryptJson` / `sealText`,
`lib/server/crypto.ts`, `lib/server/data/sealed.ts`); never log tokens, codes, phone numbers or message text.

### 12.1 Platform env (`lib/server/connect/platform.ts`)

| Variable | Enables |
|---|---|
| `PUBLIC_BASE_URL` | Public https origin. `appUrl()` prefers it over `APP_URL`. Webhook-based connects (Telegram bot, Meta, Unipile, Gmail push, Graph notifications) need https. |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | Telegram account (QR / phone). Per-channel api_id/api_hash are no longer accepted. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Gmail (`email_gmail`). Optional push: `GOOGLE_PUBSUB_TOPIC` (projects/x/topics/y) + `GOOGLE_PUBSUB_VERIFICATION_TOKEN`. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` (`MICROSOFT_TENANT`, default `common`) | Outlook / Microsoft 365 (`email_outlook`). |
| `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID` (`META_WHATSAPP_CONFIG_ID` optional, falls back to `META_CONFIG_ID`; `META_VERIFY_TOKEN` optional, default derived from the app secret; `META_GRAPH_VERSION`) | Messenger / Instagram ("Continue with Facebook") and WhatsApp Embedded Signup. `META_APP_SECRET` is also the fallback for `WHATSAPP_APP_SECRET`. |
| `UNIPILE_DSN`, `UNIPILE_API_KEY` | LinkedIn via Unipile hosted auth. |

`platformIntegrations(): IntegrationsDTO` (shape in `lib/shared/types.ts`) is served by `GET /api/v1/integrations` (viewer).
It keeps the legacy keys `google`, `telegram`, `liveSync`.

### 12.2 Shared types (`lib/shared/types.ts`)

- New channel types `email_gmail`, `email_outlook` (persistent, `sourceOf` → `email`).
- `ConnectorState` gains `needs_reauth` (credentials expired/revoked; the sync manager does not restart it — like `logged_out`).
- `ConnectionCommand` gains `phone_login` (Telegram phone fallback; arg = sealed E.164 digits), `code` (arg = sealed login code), `sync` (light "pull new messages now", used by push webhooks).
- `ConnectionDTO.prompt: ConnectionPrompt | null` — what the login flow is waiting for:
  `{ kind: "password"; hint: string | null; error: string | null }` | `{ kind: "code"; phoneMasked: string | null; via: "app" | "sms" | "call" | "email" | null; error: string | null }`.
  Stored in `connector_sessions.prompt` (jsonb). Connectors set it with `ctx.update({ prompt })`; cleared on success.

### 12.3 OAuth flows (`lib/server/connect/oauth-flow.ts`, table `oauth_flows`)

Every redirect-based login (Google, Microsoft, Meta, Unipile) and the WhatsApp Embedded Signup go through one flow row:
`id, workspace_id, user_id, session_id, provider, state_hash (unique), csrf_hash, code_verifier_enc, channel_id (reconnect target, nullable), payload_enc, status (pending|authorized|completed|failed), expires_at (10 min), created_at`.

- `startOAuthFlow(db, { workspaceId, userId, sessionId, provider, channelId? })` → `{ flowId, state, codeVerifier, codeChallenge, setCookie }`.
  `state` = 32 random bytes (base64url); only its sha256 is stored. PKCE S256. `setCookie` is the CSRF cookie
  (`__Host-infera_oauth` on https / `infera_oauth` otherwise; value `<flowId>.<nonce>`; HttpOnly; SameSite=Lax; Path=/; Max-Age=600) — the start route must attach it to its response.
- `consumeOAuthFlow(db, req, { provider, state })` — for provider callbacks: looks up by state hash; rejects unknown/expired/used flows,
  provider mismatch, a CSRF cookie that doesn't match, a request whose session isn't the flow's session/user, or a user who is no
  longer admin of the workspace. Atomically flips `pending → authorized` (single use). Returns the decrypted flow
  (`codeVerifier`, `channelId`, `workspaceId`, `userId`). Throws `OAuthFlowError(code)` with codes `invalid_state | expired | csrf | session | forbidden`.
- `getFlowForSession(db, flowId, { workspaceId, userId, sessionId, provider })` / `setFlowPayload(db, flowId, payload)` / `completeFlow(db, flowId)` —
  for multi-step flows (Meta account picker, WhatsApp Embedded Signup, Unipile return).
- Expired rows are deleted by the existing `retention_sweep` job.
- Callback routes always end in a 303 to `/console/connect?…` (`connected=<channelId>` | `error=<code>` | `meta_flow=<flowId>`), never JSON, never echo provider errors verbatim.

### 12.4 Channel helpers (`lib/server/connect/channels.ts`, `lib/server/connect/reauth.ts`)

- `upsertConnectedChannel(db, actor, { workspaceId, type, name, externalId?, config, secrets, reconnectChannelId?, match? })` →
  `{ channel, created }`. Reuses the reconnect target (same workspace + type) or an existing channel whose `config[match.key] === match.value`;
  otherwise inserts (respecting `MAX_CHANNELS_PER_WORKSPACE` and the global `(type, external_id)` uniqueness → 409). Merges config/secrets,
  sets `status: "active"`, clears `lastError`, audits `channel.create` / `channel.reconnect` (no secrets).
- `markNeedsReauth(db, channel, reason)` — sets the connector session to `needs_reauth` (+ `lastError`), sets `channels.lastError`,
  audits `channel.needs_reauth`, and (only on the transition into `needs_reauth`) notifies admins:
  type `channel.needs_reauth`, link `/console/connect?reconnect=<channelId>`. Persistent connectors use `ctx.needsReauth(reason)` which does the same and stops the runtime.
- `channel_health` job (daily via the scheduler) calls per-type checkers registered in `lib/server/connect/health.ts`
  (`HealthResult = { ok: true } | { ok: false; reauth: boolean; error: string }`) and calls `markNeedsReauth` when `reauth`.

### 12.5 Connect API (all admin, session only, rate-limited; tenant-scoped)

| Route | Body → result |
|---|---|
| `POST /api/v1/connect/telegram-bot` | `{ token, name? }` → `getMe` (must be a bot) → channel `telegram` (externalId = bot id, secrets botToken + generated webhookSecret) → `setWebhook` with `secret_token`. Failure → channel not kept. → `201 ChannelDTO` |
| `POST /api/v1/connect/telegram` | `{ channelId?, historyDays?, ignoreGroups?, chatSelection? }` → channel `telegram_user` (env credentials) + `connect` command → `201 ChannelDTO`. QR/phone/code/password then go through `/channels/:id/connection`. |
| `POST /api/v1/channels/:id/connection` | adds actions `phone_login {phone}`, `code {code}` (sealed in the command arg) next to `password` |
| `GET /api/v1/channels/:id/connection/stream` | SSE (admin): `event: connection` + `ConnectionDTO` on open and on every `channel.status` for that channel (QR refreshes ~every 30 s), heartbeat 15 s, ends after ~290 s |
| `POST /api/v1/connect/google` · `POST /api/v1/connect/microsoft` | `{ channelId?, historyDays? }` → `{ url }` + CSRF cookie. Callbacks `GET /api/oauth/google/callback`, `GET /api/oauth/microsoft/callback` create/reconnect `email_gmail` / `email_outlook` (refresh token in the encrypted auth blob) and start the connector. |
| `POST /api/v1/connect/imap` | `{ address, password, historyDays? }` → autodetect IMAP/SMTP from the domain (known providers, RFC 6186 SRV, MX, Thunderbird autoconfig, `imap.<domain>` probe), verify the login, create `email_imap`. Gmail/Outlook domains with OAuth configured → `409 use_oauth { provider }`. |
| `POST /api/webhooks/gmail?token=…` | Pub/Sub push (token = `GOOGLE_PUBSUB_VERIFICATION_TOKEN`, constant-time) → `sync` command for the matching `email_gmail` channels → 204 |
| `POST /api/webhooks/microsoft` | Graph change notifications: echoes `validationToken`; verifies per-subscription `clientState` → `sync` command → 202 |
| `POST /api/v1/connect/meta` | `{ channelId? }` → `{ url }` (Facebook Login for Business with `config_id`) + CSRF cookie. Callback `GET /api/oauth/meta/callback` → long-lived user token → Pages + linked Instagram accounts stored encrypted in the flow → 303 `/console/connect?meta_flow=<flowId>` |
| `GET /api/v1/connect/meta/accounts?flow=` | → `{ items: [{ pageId, pageName, pictureUrl, instagram: { id, username } \| null, connected: { messenger: boolean, instagram: boolean } }] }` (no tokens) |
| `POST /api/v1/connect/meta/accounts` | `{ flow, pageId, platform: "messenger" \| "instagram", historyDays? }` → channel with the page token (encrypted), shared app (`META_APP_SECRET`), `POST /{page}/subscribed_apps`, app subscription ensured, history import → `201 ChannelDTO` |
| `POST /api/webhooks/meta` (+ `GET` verify) | Shared-app Messenger/Instagram webhook (signature `META_APP_SECRET`), routed by Page / IG account id to every matching channel. The per-channel `/api/webhooks/meta/[token]` stays for older channels. |
| `POST /api/v1/connect/whatsapp/start` | `{ channelId? }` → `{ flowId, appId, configId, graphVersion }` (browser runs the FB JS SDK Embedded Signup) |
| `POST /api/v1/connect/whatsapp/complete` | `{ flowId, code, phoneNumberId, wabaId }` → exchange code → business token → verify access to the number → `POST /{phone_number_id}/register` (generated 6-digit PIN, stored encrypted) → `POST /{waba_id}/subscribed_apps` → channel `whatsapp_cloud` (shared app) → `201 ChannelDTO` |
| `POST /api/v1/connect/linkedin` | `{ channelId? }` → `{ url }` (Unipile hosted auth, `create` or `reconnect`), `notify_url` = `/api/webhooks/unipile/auth?state=<state>`, success → `/api/oauth/unipile/return?flow=<flowId>`, failure → `/console/connect?error=linkedin_failed` |
| `POST /api/webhooks/unipile/auth?state=` | Unipile account notification (`CREATION_SUCCESS` / `RECONNECTED`): verify state → map `account_id` to the channel, register the messaging webhook, import history |

### 12.6 Console (`/console/connect`)

One card per channel (WhatsApp Business, WhatsApp QR (experimental), Telegram account, Telegram bot, Gmail, Outlook, Other email,
Messenger, Instagram, LinkedIn), each with a single primary button, a QR/OAuth modal, progress states, a "send a test message"
verification step (waits for the channel's first new message), status badges (connected / syncing / needs_reauth / error)
and Reconnect. Unconfigured options are shown disabled with "Not configured by admin". `?reconnect=<channelId>` opens that card's flow.
The Channels page links here instead of asking for credentials.
