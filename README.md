# Infera.Ai — app and website

The intelligent inbox: turns WhatsApp chats into clean, structured, searchable tables.

Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Motion and lucide-react.

## Run

```bash
npm install
npm run dev      # http://localhost:3000  (app at /app)
npm run build && npm start   # production — needed to test install/offline (service worker is production-only)
```

## The app (`/app`)

An installable web app (PWA) that works on Windows, Mac, iPhone/iPad and Android. All data — chats, media, collections — is stored on the device in IndexedDB; nothing is uploaded unless the user turns on Cloud AI.

| Tab | What it does |
| --- | --- |
| **Infera AI** | Ask anything about your chats ("Which payments are pending?", "Find the product PDF", "Summarise today"). Describe a collection ("create a collection titled @LeadsAndDeals", "track property enquiries with budget, BHK and locality") and it proposes a plan you can **Accept**, **Reject** or revise in plain words. Answers cite the source messages. |
| **Chats** | Import WhatsApp exports (`.zip` with media or `.txt`; Android and iPhone formats). Filters for unread, groups, documents, images, links and contacts. Photos, PDFs, voice notes and videos open inside the app. Any message can be added to a collection. |
| **Collections** | Templates for Orders, Leads and deals, Payments, Product catalogue, Follow-ups, Complaints, Contacts, Files and Links, or a custom collection from a prompt. Table and Gallery views, search, status filters, sorting, inline editing (hand edits are never overwritten), and **Autopilot**: re-importing a chat updates every collection. Export to Excel (.xlsx), CSV, Google Sheets or Notion. |
| **Search** | Full-text search across messages, files and collection rows, filtered by type, chat and date. |
| **Settings** | Name, currency, theme, Cloud AI, install, backup/restore (media included), delete all data. |

**Importing chats:** in WhatsApp, open a chat → ⋮ → More → **Export chat** → Include media. On Android with Infera installed, pick **Infera** in the share sheet (manifest `share_target`); otherwise save the file and drop it into Infera. Re-importing the same chat adds only new messages.

**Install ("Get the app"):** `/download` installs the PWA — a native install prompt in Chrome/Edge, or step-by-step instructions (Safari *Add to Home Screen* / *Add to Dock*) with a QR code for other devices. To publish store builds later, set the URLs in `site.downloads` (`lib/site.ts`) and the buttons link there instead; [PWABuilder](https://www.pwabuilder.com/) can package this PWA as an MSIX (Microsoft Store), APK/AAB (Google Play) or iOS app once it is deployed on HTTPS.

**AI:** the on-device engine (`lib/app/extract.ts`, `lib/app/assistant.ts`) needs no API key and works offline. Setting `ANTHROPIC_API_KEY` on the server enables **Cloud AI** (`POST /api/ai`, Claude Opus 5.5 with structured outputs) for smarter answers, plans and custom collections; users opt in under Settings. Only the messages needed for a request are sent.

Regenerate the app icons with `node scripts/gen-icons.mjs`.

## What's on the site

| Route | Contents |
| --- | --- |
| `/` | Hero, pain points, How it works, Collections, Encryption, What's next, FAQ, CTA |
| `/app` | The Infera app (see above) |
| `/download` | Install Infera on Windows, Mac, iOS and Android, with OS detection and a QR code |
| `GET/POST /api/ai` | Cloud AI status and requests (only active when `ANTHROPIC_API_KEY` is set) |
| `/security`, `/privacy`, `/terms`, `/support` | Security, legal and support pages |
| `POST /api/demo` | Demo-request form endpoint, with validation |
| `POST /api/channel-request` | Channel-voting endpoint |

- **Theme:** light, dark or system. The choice is saved in `localStorage`, and an inline script applies it before the first paint so the page never flashes the wrong theme.
- **Demo modal:** opens from any "Get a demo" button, or from the `/#demo` deep link.
- **Collections demo:** a working table with search, status filters and column sorting. Click a row to see the message it came from. New messages update the table automatically, and **Export** downloads a CSV.

## Backend

No database: the two form endpoints validate input and forward it to a webhook.

| Route | Purpose |
| --- | --- |
| `POST /api/demo` | Demo request → `DEMO_WEBHOOK_URL` |
| `POST /api/channel-request` | Channel vote → `CHANNEL_WEBHOOK_URL` |
| `GET /api/health` | Health check for load balancers and uptime monitors. Returns `ok`, or `degraded` while a webhook is missing |

Every form endpoint runs these checks (see `lib/server/`):

- **Request checks:**
  - same-origin check (CSRF protection)
  - JSON content type only
  - 16 KB body limit
  - a hidden honeypot field that catches simple bots
- **Rate limits** per IP:
  - demo form: 5 requests per 10 minutes
  - channel votes: 10 requests per 10 minutes
- **Validation:** shared with the browser forms (`lib/validation.ts`). Phone numbers are normalized to E.164 format.
- **Webhook delivery:**
  - 8 s timeout, with one retry on network errors, 429 and 5xx
  - every attempt carries the same `id`, so the receiver can drop duplicates
  - includes a `text` summary that a Slack incoming webhook can post directly; user input is escaped first
  - optional HMAC signature
- **Error handling:**
  - logs are structured JSON and never include names, emails or phone numbers
  - in production, a missing webhook returns **503** rather than silently dropping the lead

## Configure before launch

- **Environment variables.** Copy `.env.example`; every variable is documented there.
  - **Required in production:** `DEMO_WEBHOOK_URL` and `CHANNEL_WEBHOOK_URL`.
  - **Recommended:** `WEBHOOK_SIGNING_SECRET`. If you run more than one instance or deploy serverless, also set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` so all instances share one rate limit.
- **`lib/site.ts`:**
  - Set the real store and installer URLs in `downloads`. While a URL is empty, its button shows a notice instead of a dead link.
  - Set the domain and support email.
  - `site.url` is trusted for form POSTs. To serve both `infera.ai` and `www.infera.ai`, redirect one to the other or add it to `ALLOWED_ORIGINS`.
- **Legal pages.** `app/privacy` and `app/terms` are starter texts. Have counsel review them before publishing.
- **Before deploying,** run `npm run typecheck && npm run build`. After deploying, check that `GET /api/health` returns `"status":"ok"`.

## Privacy in the demo UI

Phone numbers in the demo data show only the country code and the first 4 digits; the rest is blurred (`components/ui/masked-phone.tsx`). The full numbers are not in the source data, the HTML or the JS bundles. CSV exports contain the masked form.
