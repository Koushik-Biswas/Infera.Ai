<div align="center">

<img src="public/icons/icon-192.png" alt="Infera.Ai logo" width="96" height="96" />

# Infera.Ai

### The intelligent inbox — business conversations in, structured records out.

Infera reads the messages your business already receives on **WhatsApp, Telegram, email, Slack, SMS, Messenger, Instagram, LinkedIn** or any API source, and turns them into **clean, searchable, source-linked tables** — orders, leads, payments, complaints, follow-ups — automatically, with humans in the loop where it matters.

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=000)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle%20ORM-4169E1?logo=postgresql&logoColor=fff)](https://orm.drizzle.team/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=fff)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/tests-155%20(Vitest)-6E9F18?logo=vitest&logoColor=fff)](#-testing--code-quality)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Video](#-video-walkthrough-with-voice-over) ·
[Features](#-key-features) ·
[Quick start](#-installation--setup) ·
[API](#-api-documentation) ·
[Architecture](#-system-architecture) ·
[Deploy](#-deployment-instructions)

</div>

---

## 🎬 Video Walkthrough (with voice-over)

<!--
  HOW TO MAKE THE VIDEO PLAY INLINE ON GITHUB
  1. On github.com open this README and click the ✏️ (Edit) button.
  2. Drag the rendered narrated MP4 (video/out/Infera-Presentation-github.mp4, < 10 MB) into the editor
     on the empty line right below this comment. GitHub uploads it and inserts a
     https://github.com/user-attachments/assets/... link.
  3. Commit. GitHub shows that link as an inline video player with sound.
  (Videos are deliberately not stored in the repository — see .gitignore.)
-->

[![Watch the Infera.Ai product film — 4 min 26 s, narrated](docs/media/video-poster.jpg)](#-video-walkthrough-with-voice-over)

A **4 min 26 s narrated product film**, built entirely in code with [Remotion](https://www.remotion.dev/) (source in [`video/`](video/)). A neural voice-over walks through the story in four acts — **the gap → the solution → the engineering → why Infera**:

| # | Chapter | What the narration explains |
|---|---|---|
| 1 | **Open** | "Every day, business happens in chats" — real demo messages fly through 3D space. |
| 2 | **Headlines** | Verified news and reports on WhatsApp scale, business messaging and time lost to manual data entry. |
| 3 | **The gap** | Endless scrolling, copy-pasting into spreadsheets, exporting chats to AI tools — and media that never fits in a sheet. |
| 4 | **Reveal** | The Infera logo and product reveal. |
| 5 | **Interface** | A live *Orders* collection: a payment screenshot marks an order *Paid*, a voice note adds a row, one click opens the source message. |
| 6 | **Workflow** | Scan the QR code → describe a collection → review the plan → Accept → ask a question → get a cited answer. |
| 7 | **Engine** | Under the hood: Linked device → Understand → Agents → Extract → Collection, with transcription, OCR and typed-field extraction. |
| 8 | **Privacy** | End-to-end encryption flow and the four privacy guarantees. |
| 9 | **Advantage** | Old way vs. Infera, one-click export, Windows · Mac · iOS · Android. |
| 10 | **Call to action** | Channels available today and coming next; "your first table in 60 seconds". |

> Regenerate the film yourself: see [`video/README.md`](video/README.md) (`cd video && npm ci && npm run render:preview`). Captions are written to `video/out/infera-presentation.srt`.

---

## 📑 Table of Contents

1. [Project Description / Overview](#-project-description--overview)
2. [Problem Statement](#-problem-statement)
3. [Key Features](#-key-features)
4. [Screenshots & Demo](#-screenshots--demo)
5. [Technology Stack](#-technology-stack)
6. [System Architecture](#-system-architecture)
7. [Project Directory Structure](#-project-directory-structure)
8. [Prerequisites](#-prerequisites)
9. [Installation & Setup](#-installation--setup)
10. [Environment Variables & Configuration](#-environment-variables--configuration)
11. [Database Schema & Design](#-database-schema--design)
12. [API Documentation](#-api-documentation)
13. [Authentication & Security](#-authentication--security)
14. [Testing & Code Quality](#-testing--code-quality)
15. [Deployment Instructions](#-deployment-instructions)
16. [Known Issues & Limitations](#-known-issues--limitations)
17. [Contributing Guidelines](#-contributing-guidelines)
18. [License](#-license)
19. [Contact & Support](#-contact--support)

---

## 📖 Project Description / Overview

**Infera.Ai** is a full-stack, multi-tenant platform built on **Next.js 16 (App Router)** that connects to a business's messaging channels and converts unstructured conversations into **structured records** inside configurable *collections* (think: a self-filling spreadsheet).

It ships as three parts in one codebase:

| Part | Route | What it is |
|---|---|---|
| **Marketing site** | `/`, `/download`, `/security`, `/privacy`, `/terms`, `/support` | Landing page with live interactive demos, demo-request and channel-voting forms. |
| **Infera Console** | `/console/**` | The multi-user, multi-workspace SaaS app: inbox, collections, AI assistant, search, channel connections, members, API keys, webhooks and data settings. |
| **Offline PWA** | `/app` | An installable, privacy-first web app that imports WhatsApp chat exports and builds collections **entirely on the device** (IndexedDB) — no server required. |

Every value Infera writes is **traceable** to the message it came from, carries a **confidence score**, and is either **auto-applied, held for human review, or offered as a suggestion** — Infera never invents customer data.

---

## ❓ Problem Statement

Small and medium businesses — especially in markets like India — run sales, support and operations **inside chat apps**. Orders, payment confirmations, delivery addresses, complaints and leads arrive as WhatsApp texts, voice notes, screenshots and PDFs spread across dozens of chats.

That creates real, daily pain:

- **Scrolling** — finding "who still owes payment?" means scrolling through hundreds of messages.
- **Copy-paste** — staff manually re-type orders and leads into Excel or Google Sheets, introducing errors and delays.
- **Lost context** — once data is in a sheet, the link back to the original message (the evidence) is gone.
- **Unstructured media** — voice notes, payment screenshots and documents don't fit into a spreadsheet at all.
- **Generic AI tools hallucinate** — pasting chats into a chatbot produces confident answers with made-up numbers and no audit trail.

**Infera's answer:** connect the channels once; a deterministic-first extraction pipeline (with optional AI) continuously fills typed collections, **verifies every AI value against a verbatim quote**, asks a human when something is ambiguous or conflicting, and keeps a full audit trail — so the business gets a live, trustworthy database of its conversations.

---

## ✨ Key Features

### 📥 Omnichannel ingestion
- **13 channel types:** WhatsApp Cloud API (official), WhatsApp linked device *(experimental)*, Telegram bot, Telegram personal account (MTProto), email inbound-parse (Postmark / Mailgun / SendGrid), IMAP/SMTP mailboxes (Gmail OAuth or app password), Slack, Twilio SMS/MMS, Instagram DMs, Facebook Messenger, LinkedIn (via Unipile), a generic **REST ingest API**, and **WhatsApp chat-export import** (`.txt` / `.zip`).
- Signed webhooks (HMAC verification, constant-time compare), de-duplication by provider message id, media download, and **persistent live-sync connectors** with leases, failover and back-off.
- History backfill and per-chat control of which conversations agents may process.

### 🧠 Extraction pipeline (anti-hallucination by design)
- **Rules first:** deterministic classifier and extractors (amounts incl. *k / lakh*, phones → E.164, emails, URLs, relative dates, items, locations, statuses).
- **AI when needed:** optional Claude structured-output call with recent conversation context; PII can be redacted before any AI call.
- **Evidence verification:** every AI value must be backed by a verbatim quote from the message, and numbers/dates must be derivable from that quote — otherwise it is dropped to `null` and offered as a suggestion.
- **Confidence thresholds:** auto-apply ≥ threshold, review queue in-between, suggestions below.
- Conflicts with human edits are **never silently overwritten** — they become review items.

### 📊 Collections & records
- Templates for **Orders, Leads & deals, Payments, Product catalogue, Follow-ups, Complaints, Contacts, Files & links**, or describe a custom collection in plain language and accept the generated plan.
- Typed fields, match keys (no duplicate rows), inline editing (human edits are protected), soft delete, versioning and **record → source message provenance**.
- **Export** to CSV (formula-injection safe), Excel (`.xlsx`) and JSON; backfill a collection from past messages.

### 🤖 AI assistant & search
- Ask questions like *"Which payments are pending?"* — answers are split into **facts (with cited message ids)** and **suggestions**.
- Full-text search across messages, records and contacts — including **blind-index search over encrypted message text**.

### ⚙️ Automations, review & integrations
- Trigger → condition → action automations: notify, set field, create record, add tag, reminder, outbound webhook, auto-reply (external actions gated by workspace setting).
- Human **review queue** with approve-with-edits / reject.
- Signed **outbound webhooks** with retries, delivery logs and auto-disable; scoped **API keys**; realtime updates via **Server-Sent Events**.

### 👥 Teams & workspaces
- Multi-workspace accounts, roles (**owner · admin · member · viewer**), email invitations, workspace switching, single-user auto-login mode for private installs.

### 📱 Offline-first PWA
- Installable on Windows, macOS, iOS/iPadOS and Android; works offline; Android **share-target** for WhatsApp exports; backup/restore including media.

---

## 🖼️ Screenshots & Demo

| Landing page | Collections |
|---|---|
| ![Infera landing page hero](video/public/images/screenshots/hero.png) | ![Collections table built from chats](video/public/images/screenshots/collections.png) |
| **How it works** | **Encryption** |
| ![How Infera works: connect, describe, review, ask](video/public/images/screenshots/how-it-works.png) | ![End-to-end encryption section](video/public/images/screenshots/encryption.png) |

**Try it locally in 60 seconds** (no database or API keys needed):

```bash
npm install && npm run dev
```

Then open:
- <http://localhost:3000> — marketing site with the interactive collections demo
- <http://localhost:3000/console> — the console (auto-signs-in as the workspace owner in development)
- <http://localhost:3000/app> — the offline PWA (import a WhatsApp export: chat → ⋮ → More → **Export chat** → Include media)

---

## 🧰 Technology Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 16](https://nextjs.org/) (App Router, Route Handlers, Proxy/middleware, `instrumentation.ts`), React Compiler |
| **UI** | [React 19](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [Motion](https://motion.dev/), [lucide-react](https://lucide.dev/), `qrcode.react` |
| **Language** | TypeScript (strict) |
| **Database** | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/) + `drizzle-kit` migrations; **embedded [PGlite](https://pglite.dev/)** (Postgres in WASM) when no `DATABASE_URL` is set; `pg` (node-postgres) in production |
| **Validation** | [Zod 4](https://zod.dev/) |
| **AI (optional)** | [Anthropic Claude](https://docs.anthropic.com/) via `@anthropic-ai/sdk` — structured outputs, prompt caching (default model `claude-opus-5-5`, configurable) |
| **Channels** | `baileys` (WhatsApp linked device), `teleproto` (Telegram MTProto), `imapflow` + `mailparser` + `nodemailer` (email), provider REST/webhook APIs (Meta, Slack, Twilio, Unipile) |
| **Files** | `fflate` (zip import, xlsx export) |
| **Realtime** | Postgres `LISTEN/NOTIFY` → Server-Sent Events |
| **Testing** | [Vitest 5](https://vitest.dev/) with an in-memory Postgres per test file |
| **Product film** | [Remotion 4](https://www.remotion.dev/) + React + TypeScript, Kokoro neural TTS, FFmpeg (see [`video/`](video/)) |

---

## 🏗️ System Architecture

```mermaid
flowchart LR
  subgraph Sources["Message sources"]
    WA[WhatsApp Cloud / linked device]
    TG[Telegram bot / account]
    EM[Email: IMAP · Gmail · inbound parse]
    OT[Slack · SMS · Messenger · Instagram · LinkedIn]
    API[REST ingest API / WhatsApp export]
  end

  subgraph Server["Next.js 16 server (Node.js runtime)"]
    WH[Webhook routes<br/>signature verification]
    SYNC[Sync manager<br/>persistent connectors + leases]
    ING[ingestInboundMessage<br/>contacts · conversations · files]
    Q[(Job queue<br/>Postgres-backed)]
    PIPE[Pipeline<br/>classify → AI? → route → extract →<br/>verify evidence → decide → apply]
    REC[Record ops<br/>versioning · provenance · audit]
    AUTO[Automations · review ·<br/>outbound webhooks · notifications]
    RT[Realtime<br/>pg_notify → SSE]
    REST[REST API /api/v1<br/>session or API key]
  end

  DB[(PostgreSQL / PGlite<br/>AES-256-GCM sealed content)]
  AI[[Claude API<br/>optional]]
  UI[Console UI<br/>/console]
  PWA[Offline PWA<br/>/app · IndexedDB]

  Sources --> WH & SYNC
  WH --> ING
  SYNC --> ING
  ING --> Q --> PIPE
  PIPE <-.-> AI
  PIPE --> REC --> DB
  REC --> AUTO
  REC --> RT --> UI
  UI <--> REST <--> DB
  ING --> DB
```

**Request & processing flow**

1. **Ingest** — a webhook (verified before parsing) or a persistent connector normalises the message into an `InboundMessage`; one transaction upserts the contact and conversation, stores the message (deduplicated), encrypts text/media, creates an `events` row and enqueues `process_message`.
2. **Process** — the job worker runs the [pipeline](docs/ARCHITECTURE.md#3-pipeline-module-pipeline): validate → rules classifier → optional AI classification/extraction → route to matching collections → deterministic extraction → **evidence verification** → normalise → decide (create / update / review / no-op) → execute in one transaction.
3. **React** — record operations emit domain events that drive automations, outbound webhooks, notifications and realtime SSE updates to open consoles.
4. **Read** — the console and API-key clients read through tenant-scoped REST endpoints with keyset pagination.

Background work runs in an in-process **job worker + scheduler** (started from `instrumentation.ts` → `lib/server/boot.ts`). On serverless hosts the worker is turned off and `/api/cron` drains the queue on a schedule. Full module contracts live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 📂 Project Directory Structure

```
Infera.Ai/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # /login, /signup, /invite/[token], /onboarding
│   ├── api/
│   │   ├── auth/                 # signup, login, logout, me, password, switch-workspace, auto-login
│   │   ├── v1/                   # versioned REST API (collections, records, events, channels, …)
│   │   ├── webhooks/             # inbound provider webhooks (whatsapp, telegram, email, slack, sms, meta, unipile)
│   │   ├── oauth/google/         # Gmail OAuth callback
│   │   ├── invitations/ workspaces/ cron/ health/ ai/ demo/ channel-request/
│   ├── console/                  # Console UI: inbox, collections, assistant, search, channels, connect, settings
│   ├── app/                      # Offline PWA (+ Android share target)
│   ├── download/ security/ privacy/ terms/ support/ offline/
│   └── layout.tsx, page.tsx, globals.css, manifest, robots, sitemap
├── components/
│   ├── console/                  # console shell, UI kit, auth, inbox, collections, channels, connect, settings
│   ├── app/                      # PWA views
│   ├── sections/                 # landing-page sections
│   ├── mockups/ ui/
├── lib/
│   ├── server/                   # backend (Node.js only)
│   │   ├── db/                   # Drizzle schema + client (PGlite / node-postgres)
│   │   ├── api/                  # route wrappers: publicRoute / userRoute / workspaceRoute
│   │   ├── auth/                 # accounts, sessions, API keys, invitations, members, limits
│   │   ├── channels/             # ingest, outbound, adapters/* (one per provider)
│   │   ├── sync/                 # live-sync manager + persistent connectors
│   │   ├── pipeline/             # classify, extract, verify-evidence, decide, apply, backfill
│   │   ├── records/              # record ops, coercion/normalisation
│   │   ├── automations/          # matching, actions, webhooks delivery
│   │   ├── data/                 # DTOs, queries, export, sealed (encrypted) content
│   │   ├── ai/                   # Claude client, PII redaction, pipeline/assistant prompts
│   │   ├── jobs/ events/ realtime/
│   │   └── crypto.ts, env.ts, boot.ts, audit.ts, http.ts
│   ├── client/                   # browser API client, caching, realtime hooks
│   ├── app/                      # on-device engine for the PWA (WhatsApp parser, extractor, assistant, export)
│   └── shared/types.ts           # types shared by server and client
├── drizzle/                      # SQL migrations + snapshots
├── tests/                        # Vitest suites (15 files, 155 tests) + helpers
├── scripts/                      # migrate.mjs, gen-icons.mjs
├── public/                       # icons, favicon, service worker
├── docs/                         # ARCHITECTURE.md, CONNECTORS_SETUP.md, media/
├── video/                        # Remotion product film (separate package)
├── proxy.ts                      # optimistic auth redirect for /console
├── instrumentation.ts            # starts job worker, scheduler, sync manager
├── next.config.ts                # security headers, React Compiler, server externals
├── drizzle.config.ts  vitest.config.ts  tsconfig.json  package.json
└── .env.example                  # documented configuration template
```

---

## ✅ Prerequisites

| Requirement | Version / notes |
|---|---|
| **Node.js** | **≥ 20.9.0** (developed and tested on Node 24) |
| **npm** | ≥ 10 (ships with Node) |
| **Git** | any recent version |
| **PostgreSQL** | *Optional.* Without `DATABASE_URL` the app uses embedded PGlite stored in `./.data/pglite` — no install needed. Use a real Postgres server in production. |
| **Anthropic API key** | *Optional.* Enables Cloud AI; everything works rules-only without it. |
| **Provider credentials** | *Optional, per channel* — Meta, Telegram, Google, Slack, Twilio, Unipile (see [Environment Variables](#-environment-variables--configuration)). |
| **Public HTTPS URL** | Needed only to receive provider webhooks (use a tunnel such as ngrok/Cloudflare Tunnel during development). |
| *Video project only* | Python 3.10+ and Chrome/Edge (see [`video/README.md`](video/README.md)). |

---

## 🚀 Installation & Setup

```bash
# 1. Clone
git clone https://github.com/Koushik-Biswas/Infera.Ai.git
cd Infera.Ai

# 2. Install dependencies (uses the committed lockfile)
npm ci

# 3. Configure (optional for local development)
cp .env.example .env.local
#    then fill in what you need — see the next section

# 4. Start the dev server
npm run dev
```

Open <http://localhost:3000>. On first start the embedded database is created in `./.data/pglite` and all migrations run automatically.

| Script | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build |
| `npm start` | Start the production server (after `build`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Run the Vitest suite once / in watch mode |
| `npm run check` | Typecheck + tests + build (pre-merge gate) |
| `npm run db:generate` | Generate a new Drizzle migration after editing `lib/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` (or the embedded DB) |
| `node scripts/gen-icons.mjs` | Regenerate PWA icons |

> **Windows tip:** run commands from a path with an **upper-case drive letter** (`C:\…`). Some terminals (e.g. VS Code) open in `c:\…`, which makes Vitest load twice and every test file fail with `Cannot read properties of undefined (reading 'config')`.

**Using an external PostgreSQL database**

```bash
# .env.local
DATABASE_URL=postgres://user:password@localhost:5432/infera
npm run db:migrate   # or rely on auto-migration at startup (INFERA_AUTO_MIGRATE defaults to on)
```

---

## 🔧 Environment Variables & Configuration

Copy [`.env.example`](.env.example) to `.env.local` for development, or set the variables in your hosting provider. **Never commit real values** — `.env*` files are git-ignored (except `.env.example`).

### Core

| Variable | Required | Description |
|---|---|---|
| `ENCRYPTION_KEY` | **Yes (production)** | 32-byte key (base64 or 64 hex chars) used for AES-256-GCM encryption of secrets, message text and files, and for the search blind index. The server refuses to start in production without it. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `ENCRYPTION_KEY_PREVIOUS` | No | Old key, tried on decrypt during key rotation. |
| `DATABASE_URL` | Recommended (production) | PostgreSQL connection string. Unset → embedded PGlite. |
| `PGLITE_DIR` | No | Embedded DB location (default `./.data/pglite`; `memory://` for tests). |
| `DATABASE_POOL_MAX` | No | node-postgres pool size (default `10`). |
| `INFERA_AUTO_MIGRATE` | No | Set `0` to disable migrations at startup and run `npm run db:migrate` during deploy instead. |
| `APP_URL` / `PUBLIC_BASE_URL` | Yes (production) | Public origin used for links, OAuth redirects and webhook URLs (HTTPS for provider webhooks). |
| `ALLOWED_ORIGINS` | No | Extra comma-separated origins allowed to POST to `/api/*`. |
| `SIGNUPS_ENABLED` | No | Set `false` to disable public sign-up (invitations still work). |
| `INFERA_AUTO_LOGIN` / `INFERA_AUTO_LOGIN_EMAIL` | No | Single-user mode: opening the app signs in as the workspace owner. On by default in development, **off in production unless set to `1`** — only enable behind a VPN/auth proxy. |

### Background work

| Variable | Description |
|---|---|
| `INFERA_WORKER` | `off` disables the in-process job worker (serverless). |
| `INFERA_SYNC` | `off` disables persistent live-sync connectors. |
| `CRON_SECRET` | Bearer token for `GET/POST /api/cron` (required in production when you use cron). |
| `MAX_MEDIA_BYTES` | Max stored attachment size (default 10 MB). |
| `ALLOW_PRIVATE_WEBHOOKS` | `1` allows outbound webhooks to private/loopback addresses (SSRF guard is on by default in production). |

### AI

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Enables Cloud AI (classification, extraction, collection plans, assistant). Users still opt in per workspace. |
| `INFERA_AI_MODEL` | Override the model id (default `claude-opus-5-5`). |

### Marketing-site forms

| Variable | Description |
|---|---|
| `DEMO_WEBHOOK_URL` | Where demo requests are POSTed (Slack/Zapier/CRM). Required in production. |
| `CHANNEL_WEBHOOK_URL` | Where "which channel next?" votes are POSTed. Required in production. |
| `WEBHOOK_SIGNING_SECRET` | Signs those webhooks with `X-Infera-Signature: t=<unix>,v1=<hmac>`. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Shared rate limiting across multiple instances/serverless. |

### Channels (all optional)

| Variable(s) | Enables |
|---|---|
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | Telegram personal-account sync (QR / phone login) — see [`docs/CONNECTORS_SETUP.md`](docs/CONNECTORS_SETUP.md) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Sign in with Google" for Gmail (redirect URI `${APP_URL}/api/oauth/google/callback`) |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Shared WhatsApp Cloud API webhook at `/api/webhooks/whatsapp` |
| `META_GRAPH_VERSION` | Graph API version for Messenger/Instagram (default `v21.0`) |

Per-channel secrets (bot tokens, signing secrets, Twilio auth tokens, …) are entered in the console, **encrypted at rest** and never returned by the API.

---

## 🗄️ Database Schema & Design

PostgreSQL schema defined in [`lib/server/db/schema.ts`](lib/server/db/schema.ts) (Drizzle) with SQL migrations in [`drizzle/`](drizzle/). **Every tenant table carries `workspace_id`**, and every query is filtered by it.

```mermaid
erDiagram
  USERS ||--o{ MEMBERSHIPS : has
  WORKSPACES ||--o{ MEMBERSHIPS : has
  USERS ||--o{ SESSIONS : has
  WORKSPACES ||--o{ INVITATIONS : sends
  WORKSPACES ||--o{ API_KEYS : issues
  WORKSPACES ||--o{ CHANNELS : connects
  CHANNELS ||--o{ CONVERSATIONS : contains
  CONTACTS ||--o{ CONVERSATIONS : participates
  CONVERSATIONS ||--o{ MESSAGES : contains
  MESSAGES ||--o{ FILES : attaches
  MESSAGES ||--o| EVENTS : "processed as"
  WORKSPACES ||--o{ COLLECTIONS : owns
  COLLECTIONS ||--o{ RECORDS : contains
  RECORDS ||--o{ RECORD_SOURCES : "traced to"
  MESSAGES ||--o{ RECORD_SOURCES : evidences
  EVENTS ||--o{ REVIEW_ITEMS : raises
  WORKSPACES ||--o{ AUTOMATIONS : defines
  AUTOMATIONS ||--o{ AUTOMATION_RUNS : logs
  WORKSPACES ||--o{ WEBHOOK_ENDPOINTS : defines
  WEBHOOK_ENDPOINTS ||--o{ WEBHOOK_DELIVERIES : logs
  CHANNELS ||--o| CONNECTOR_SESSIONS : "live sync"
```

| Domain | Tables | Notes |
|---|---|---|
| **Identity & tenancy** | `users`, `workspaces`, `memberships`, `sessions`, `invitations`, `api_keys` | Passwords hashed with scrypt; session, invite and API-key tokens stored only as SHA-256 hashes. |
| **Messaging** | `channels`, `contacts`, `conversations`, `messages`, `files` | Unique `(channel_id, external_id)` deduplicates provider messages. Message text, previews and file bytes are **AES-256-GCM sealed**; `messages.search_tokens` is an HMAC blind index (GIN). |
| **Processing** | `events`, `jobs` | Per-message processing status, result JSON, timings; Postgres-backed job queue with priorities, dedupe keys and retries. |
| **Structured data** | `collections`, `records`, `record_sources`, `review_items` | Collections hold typed field specs, routing and match fields. Records store `values` + per-field metadata (source, confidence, evidence), versions, soft delete; unique match key per collection; FTS index on values. |
| **Automation** | `automations`, `automation_runs`, `webhook_endpoints`, `webhook_deliveries`, `notifications` | Idempotent runs (unique per automation + domain event); delivery attempts with HTTP status. |
| **Live sync** | `connector_sessions`, `connector_kv` | Connector state, QR/pairing data, cursors, leases; auth blobs and keys encrypted. |
| **Assistant & ops** | `assistant_threads`, `audit_log`, `usage_counters` | Audit entries for every mutation (never secrets); usage metering. |

**Migrations:** `0000_init` → `0001_live_sync` → `0002_encryption_agents` → `0003_telegram_login_prompt`. After changing the schema run `npm run db:generate` and commit the generated SQL.

---

## 📡 API Documentation

Base path: **`/api/v1`**. All responses are JSON.

**Authentication** — either the session cookie (console) or an API key:

```http
Authorization: Bearer ifk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

API keys are created by admins in **Console → Settings → API keys** with scopes `read`, `write`, `ingest`, `delete`. Admin-only routes accept **sessions only**.

**Conventions**
- Lists: `{ "items": [...], "nextCursor": "…" | null }` (keyset pagination via `?cursor=`).
- Errors: `{ "error": { "code": "not_found", "message": "…", "details"?: … } }` with standard HTTP status codes (400, 401, 403, 404, 409, 422, 429, 503).
- Resources from another workspace always return **404**.
- Responses include a `Server-Timing` header; mutating routes are rate-limited.

### Example — ingest a message from any source

```bash
curl -X POST "http://localhost:3000/api/v1/events?sync=1" \
  -H "Authorization: Bearer $INFERA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "conversation": { "id": "chat-42", "name": "Asha" },
    "sender": { "name": "Asha", "phone": "+919876543210" },
    "message": { "id": "msg-1001", "text": "Please send 2 kg basmati rice tomorrow, paid ₹480 via UPI" }
  }'
```

Returns `202 { event_id, message_id, conversation_id, status: "queued" | "duplicate" }`, or with `?sync=1` the full processing result (classification, record operations, review items, suggestions).

### Endpoint reference

<details>
<summary><b>Auth & workspaces</b></summary>

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/signup` | public, rate-limited | `{ name, email, password, workspaceName }` → user + session cookie |
| POST | `/api/auth/login` | public, rate-limited | `{ email, password }` → session cookie |
| POST | `/api/auth/logout` | user | End the session |
| GET | `/api/auth/me` | user | Current user, workspaces and role |
| POST | `/api/auth/password` | user | Change password (revokes other sessions) |
| POST | `/api/auth/switch-workspace` | user | `{ workspaceId }` |
| GET | `/api/auth/auto` | — | Single-user auto-login (only when enabled) |
| POST | `/api/workspaces` | user | Create a workspace (creator becomes owner) |
| GET · PATCH · DELETE | `/api/v1/workspace` | viewer · admin · owner | Read / update settings / delete (`{ confirm: slug }`) |
| GET | `/api/v1/members` | viewer | List members |
| PATCH · DELETE | `/api/v1/members/:userId` | admin | Change role / remove (self-leave allowed) |
| GET · POST | `/api/v1/invitations` | admin | List / invite `{ email, role }` |
| DELETE | `/api/v1/invitations/:id` | admin | Revoke invitation |
| GET | `/api/invitations/:token` | public | Invitation details |
| POST | `/api/invitations/:token/accept` | public / user | Accept (optionally sign up) |
| GET · POST | `/api/v1/api-keys` | admin | List / create (key shown once) |
| DELETE | `/api/v1/api-keys/:id` | admin | Revoke |
</details>

<details>
<summary><b>Channels, events & ingestion</b></summary>

| Method | Path | Auth / scope | Description |
|---|---|---|---|
| GET · POST | `/api/v1/channels` | viewer·read / admin | List / create `{ type, name, config?, secrets? }` |
| GET · PATCH · DELETE | `/api/v1/channels/:id` | viewer·read / admin | Read / rotate secrets / delete |
| POST | `/api/v1/channels/:id/test` | member·write | Ingest a synthetic test message |
| GET · POST | `/api/v1/channels/:id/connection` | viewer·read / admin | Live-sync status / `connect · disconnect · logout · resync · pair_code · password · phone_login · code` |
| POST | `/api/v1/channels/:id/history` | admin | Import history |
| GET | `/api/v1/channels/:id/google` | admin | Start Gmail OAuth |
| GET · POST | `/api/v1/channels/:id/linkedin` | admin | LinkedIn (Unipile) connect |
| GET | `/api/v1/integrations` | viewer | Which platform integrations are configured |
| POST | `/api/v1/events` | member·**ingest** | Ingest a message (see example) |
| GET | `/api/v1/events` | viewer·read | List events (`status`, `source`, `since`) |
| GET | `/api/v1/events/:id` | viewer·read | Event + processing result |
| POST | `/api/v1/events/:id/reprocess` | member·write | Re-run the pipeline (`?sync=1`) |
| POST | `/api/v1/playground` | member·write | Dry-run the pipeline on text (nothing written) |
| POST | `/api/v1/imports/whatsapp` | member·write | Multipart `.txt`/`.zip` WhatsApp export (≤ 50 MB) |
| GET · POST | `/api/webhooks/whatsapp[/:token]` | signature | WhatsApp Cloud API (verify + messages) |
| POST | `/api/webhooks/telegram/:token` | secret header | Telegram bot updates |
| POST | `/api/webhooks/email/:token` | inbound secret | Postmark / Mailgun / SendGrid / generic JSON |
| POST | `/api/webhooks/slack/:token` | Slack signature | Slack Events API |
| POST | `/api/webhooks/sms/:token` | Twilio signature | Twilio SMS/MMS |
| GET · POST | `/api/webhooks/meta/:token` | Meta signature | Messenger / Instagram |
| POST | `/api/webhooks/unipile/:token` | token | LinkedIn messages |
| GET | `/api/oauth/google/callback` | OAuth state + CSRF | Gmail OAuth callback |
</details>

<details>
<summary><b>Collections, records & review</b></summary>

| Method | Path | Auth / scope | Description |
|---|---|---|---|
| GET · POST | `/api/v1/collections` | viewer·read / member·write | List / create (from template or plan) |
| GET · PATCH · DELETE | `/api/v1/collections/:id` | viewer·read / member·write / admin | Read / edit fields & routing / archive (`?hard=1` owner) |
| GET · POST | `/api/v1/collections/:id/records` | viewer·read / member·write | List (`q`, `status`, `sort`, `cursor`) / create |
| GET | `/api/v1/collections/:id/export` | viewer·read | `?format=csv\|xlsx\|json` |
| POST | `/api/v1/collections/:id/backfill` | member·write | Process past messages `{ since?, until? }` |
| GET | `/api/v1/collection-templates` | viewer·read | Built-in templates |
| POST | `/api/v1/collection-plans` | member·write | `{ prompt }` → proposed collection plan |
| GET · PATCH · DELETE | `/api/v1/records/:id` | viewer·read / member·write / member·delete | Read / edit `{ values, expectedVersion? }` / soft delete |
| GET | `/api/v1/review` · `/api/v1/review/count` | viewer·read | Review queue / open count |
| GET | `/api/v1/review/:id` | viewer·read | Review item |
| POST | `/api/v1/review/:id/approve` · `/reject` | member·write | Approve (with optional edits) / reject |
</details>

<details>
<summary><b>Conversations, search, assistant & analytics</b></summary>

| Method | Path | Auth / scope | Description |
|---|---|---|---|
| GET | `/api/v1/conversations` | viewer·read | List (`q`, `channelId`, `archived`) |
| GET · PATCH | `/api/v1/conversations/:id` | viewer·read / member·write | Read / `{ archived?, read?, agentsEnabled? }` |
| GET | `/api/v1/conversations/:id/messages` | viewer·read | Messages, newest first |
| POST | `/api/v1/conversations/:id/reply` | member·write | Send a reply through the channel |
| GET | `/api/v1/files/:id` | viewer·read | Attachment bytes (safe inline types only) |
| GET | `/api/v1/search` | viewer·read | `q`, `type=all\|messages\|records\|contacts`, date & channel filters |
| POST | `/api/v1/assistant/ask` | member·write | `{ question, threadId? }` → facts with citations + suggestions |
| GET | `/api/v1/assistant/threads[/:id]` | member | Assistant history |
| GET | `/api/v1/analytics` | viewer·read | `?days=7\|30\|90` KPIs |
| GET | `/api/v1/stream` | viewer·read | Server-Sent Events: realtime domain events |
| GET · POST | `/api/v1/notifications` · `/read` | viewer | List / mark read |
</details>

<details>
<summary><b>Automations & outbound webhooks</b></summary>

| Method | Path | Auth / scope | Description |
|---|---|---|---|
| GET · POST | `/api/v1/automations` | viewer·read / admin | List / create |
| GET | `/api/v1/automations/templates` | viewer·read | Ready-made automations |
| GET · PATCH · DELETE | `/api/v1/automations/:id` | viewer·read / admin | Read / update / delete |
| GET | `/api/v1/automations/:id/runs` | viewer·read | Run history |
| POST | `/api/v1/automations/:id/test` | admin | Dry-run conditions and actions |
| GET · POST | `/api/v1/webhooks` | admin | List / create (signing secret shown once) |
| GET · PATCH · DELETE | `/api/v1/webhooks/:id` | admin | Read / update / delete |
| GET | `/api/v1/webhooks/:id/deliveries` | admin | Delivery log |
| POST | `/api/v1/webhooks/:id/test` | admin | Send a `ping` event |

Outbound webhook payload: `{ id, type, created_at, workspace_id, data }` with headers `X-Infera-Event`, `X-Infera-Delivery` and `X-Infera-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`.
</details>

<details>
<summary><b>Platform & public</b></summary>

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | public | `{ status, checks: { database, encryptionKey, ai, worker }, version }` (503 when the DB is down) |
| GET · POST | `/api/cron` | `Bearer CRON_SECRET` | Enqueue scheduled jobs and drain the queue (serverless) |
| GET · POST | `/api/ai` | public | Cloud AI status / requests for the offline PWA (only when `ANTHROPIC_API_KEY` is set) |
| POST | `/api/demo` | public, CSRF + rate limit + honeypot | Demo request → `DEMO_WEBHOOK_URL` |
| POST | `/api/channel-request` | public, CSRF + rate limit + honeypot | Channel vote → `CHANNEL_WEBHOOK_URL` |
</details>

Detailed request/response contracts: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §3–§8 and the shared DTO types in [`lib/shared/types.ts`](lib/shared/types.ts).

---

## 🔐 Authentication & Security

**Authentication**
- Email + password accounts; passwords hashed with **scrypt** (N = 2¹⁵, r = 8, p = 1, per-user salt, constant-time verify).
- Sessions are random tokens stored as **SHA-256 hashes**, sent as an `HttpOnly`, `SameSite=Lax` cookie (`__Host-infera_session` + `Secure` on HTTPS), valid 30 days; changing the password revokes other sessions.
- **API keys** (`ifk_live_…`) are hashed at rest, scoped (`read`/`write`/`ingest`/`delete`), expirable and revocable; admin-level routes never accept API keys.
- Login and sign-up are rate-limited per IP and per email. Public sign-up can be disabled (`SIGNUPS_ENABLED=false`).
- `proxy.ts` gives instant redirects for signed-out visitors, but it is **not** the security boundary — every API route verifies the session/key itself.

**Authorization**
- Role hierarchy **owner > admin > member > viewer**, enforced by the `workspaceRoute({ role, scope })` wrapper on every route.
- Strict **tenant isolation**: every query filters by `workspace_id`; foreign ids return 404 (no existence leaks).

**Data protection**
- **AES-256-GCM encryption at rest** for channel secrets, connector sessions, message text, conversation previews, file bytes and assistant threads (key held by the app server, never in the database; rotation via `ENCRYPTION_KEY_PREVIOUS`).
- Search over encrypted text uses an **HMAC blind index** instead of plaintext.
- Optional **PII redaction** before any AI call; AI values must pass evidence verification.
- Structured JSON logs never contain message text, names, phone numbers, emails or tokens; audit log never contains secrets.

**Web & integration hardening**
- Webhook signatures verified on the raw body with constant-time comparison (Meta `X-Hub-Signature-256`, Slack `v0` + 5-minute replay window, Twilio `X-Twilio-Signature`, Telegram secret header, email inbound secret).
- OAuth with **PKCE (S256)**, hashed single-use `state`, CSRF cookie bound to the user session.
- Same-origin (CSRF) checks, JSON-only bodies, body-size caps and per-route rate limits (Upstash Redis for multi-instance).
- **SSRF protection** for outbound webhooks (private, loopback and link-local ranges blocked in production).
- Security headers on every response: HSTS (preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, strict `Referrer-Policy`, `Permissions-Policy`, COOP, CSP `frame-ancestors 'none'`; `/api` and `/console` are `noindex`.
- CSV exports neutralise formula injection; file downloads use safe content types with `nosniff`.

> Found a vulnerability? Please report it privately (see [Contact & Support](#-contact--support)) rather than opening a public issue.

---

## 🧪 Testing & Code Quality

```bash
npm run typecheck   # TypeScript strict, no emit
npm test            # Vitest — 15 suites, 155 tests
npm run check       # typecheck + tests + production build
```

- Each test file gets its **own in-memory PostgreSQL (PGlite)** — no Docker or external services needed; tests run without an AI key to guarantee the rules-only path works end-to-end.
- Coverage spans auth & tenancy, auto-login, channel adapters and webhook signatures, WhatsApp / Telegram / Meta / email connectors, the extraction pipeline (rules and AI with evidence verification), review flow, automations & outbound webhooks, realtime sync and the data API.
- Shared helpers in [`tests/helpers.ts`](tests/helpers.ts): `createTestWorkspace()`, `addMember()`, `call(handler, …)`, `drainJobs()`.
- Increase parallelism on machines with more RAM: `VITEST_MAX_WORKERS=4 npm test`.

**Code-quality conventions** (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §2 and §9)
- TypeScript strict mode, Zod validation on every request body, typed DTOs between server and client.
- All record writes go through `lib/server/records/ops.ts` (normalisation, versioning, provenance, audit).
- No N+1 queries, `LIMIT` on every list, indexed filters; React Compiler handles memoisation.
- Never log PII; every mutation is audited.

---

## ☁️ Deployment Instructions

### Option A — Long-running Node.js server (recommended)

Supports **all** features, including persistent live-sync connectors (WhatsApp linked device, Telegram account, IMAP).

```bash
git clone https://github.com/Koushik-Biswas/Infera.Ai.git && cd Infera.Ai
npm ci
npm run build

# required production environment
export NODE_ENV=production
export ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"   # store it safely — losing it makes encrypted data unreadable
export DATABASE_URL="postgres://user:pass@db-host:5432/infera"
export APP_URL="https://your-domain.com"
export DEMO_WEBHOOK_URL="https://…" CHANNEL_WEBHOOK_URL="https://…"

npm run db:migrate      # or keep INFERA_AUTO_MIGRATE on
npm start               # listens on port 3000 (PORT=… to change)
```

- Run it under a process manager (**systemd**, **PM2**, Docker) and put a reverse proxy (Nginx, Caddy, Cloudflare) with **HTTPS** in front.
- Point provider webhooks to `https://your-domain.com/api/webhooks/...` (the console shows each channel's exact URL).
- Health check: `GET /api/health` should return `"status": "ok"`.

### Option B — Serverless (e.g. Vercel)

1. Import the repository, framework preset **Next.js**.
2. Set environment variables: `ENCRYPTION_KEY`, `DATABASE_URL` (managed Postgres — the embedded DB is not persistent on serverless), `APP_URL`, `INFERA_WORKER=off`, `INFERA_SYNC=off`, `CRON_SECRET`, plus `UPSTASH_REDIS_REST_URL`/`TOKEN` for shared rate limits.
3. Schedule a call to `GET /api/cron` with `Authorization: Bearer $CRON_SECRET` (e.g. every minute) to process queued jobs.
4. Persistent connectors are unavailable on serverless; webhook-based channels (WhatsApp Cloud, Telegram bot, Slack, SMS, Meta, email inbound) work normally.

### Pre-launch checklist
- [ ] `npm run check` passes.
- [ ] `ENCRYPTION_KEY` set and backed up; `DATABASE_URL` points to a backed-up database.
- [ ] Set real store/installer URLs, domain and support email in `lib/site.ts`.
- [ ] Have counsel review the starter texts in `app/privacy` and `app/terms`.
- [ ] Leave `INFERA_AUTO_LOGIN` unset in public deployments.
- [ ] After deploying, `GET /api/health` returns `ok`.

---

## ⚠️ Known Issues & Limitations

- **WhatsApp linked-device connector is experimental and unofficial.** It requires explicit risk acknowledgement; WhatsApp may restrict accounts that use unofficial clients. Prefer the official WhatsApp Cloud API for production.
- **Persistent connectors need a long-running server** — they are disabled on serverless deployments.
- **Windows + lower-case drive letter:** Vitest fails to load every suite when started from `c:\…` (see the tip in [Installation](#-installation--setup)).
- **One timing-sensitive test** (`tests/telegram-connect.test.ts` — "QR login → wrong then right two-step password") can time out on slow machines; the other 154 tests pass.
- **Planned, not yet implemented:** parts of the one-click connect contract in `docs/ARCHITECTURE.md` §12 (Outlook/Microsoft, Meta "Continue with Facebook", WhatsApp Embedded Signup routes), the OpenAPI document, contacts and audit-log endpoints, and console pages for review, automations and playground (the APIs exist).
- **Embedded PGlite** is great for development and single-user installs; use PostgreSQL for multi-user production workloads.
- `.env.example` does not yet list every variable (e.g. `ENCRYPTION_KEY`, `DATABASE_URL`, `APP_URL`, `CRON_SECRET`) — use the tables above.
- `video/public/audio/music/score.wav` is ~73 MB (above GitHub's 50 MB recommendation); consider Git LFS or a compressed format.
- The privacy policy and terms are starter texts, not legal advice.

---

## 🤝 Contributing Guidelines

Contributions are welcome!

1. **Fork** the repository and create a branch: `git checkout -b feat/short-description`.
2. **Read** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — it defines module ownership, route conventions, tenancy rules and the 18 behaviour rules (e.g. never hallucinate, never silently overwrite, always keep source traceability).
3. **Follow the conventions:**
   - Use the route wrappers (`publicRoute` / `userRoute` / `workspaceRoute`) and Zod for request bodies.
   - Filter every tenant query by `workspace_id`; write records only via `records/ops.ts`.
   - Never log message text or personal data; audit every mutation.
   - Schema changes → `npm run db:generate` and commit the migration.
   - No new dependencies without a strong reason.
4. **Add tests** for new behaviour (including a cross-workspace 404 test for new resources).
5. Run **`npm run check`** — typecheck, tests and build must pass.
6. Use clear commit messages (e.g. [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`).
7. Open a **pull request** describing the change, motivation and testing done; link related issues.

Bug reports and feature requests: [GitHub Issues](https://github.com/Koushik-Biswas/Infera.Ai/issues). Please include steps to reproduce, expected vs. actual behaviour and your environment (OS, Node version).

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

Copyright © 2026 **Koushik Biswas**.

---

## 📬 Contact & Support

**Koushik Biswas** — creator & maintainer

- GitHub: [github.com/Koushik-Biswas](https://github.com/Koushik-Biswas)
- Project: [github.com/Koushik-Biswas/Infera.Ai](https://github.com/Koushik-Biswas/Infera.Ai)
- Issues & feature requests: [Open an issue](https://github.com/Koushik-Biswas/Infera.Ai/issues/new)

If Infera helps you, please consider giving the repository a ⭐ — it really helps!

<div align="center">
<sub>Built with Next.js, PostgreSQL and a lot of care for data you can trust.</sub>
</div>
