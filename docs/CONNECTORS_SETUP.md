# Connector setup (for admins)

Some channels need credentials that belong to the **server**, not to each user. You set them once in the
environment; people in your workspaces then connect with a click or a QR scan and never see these values.

| Channel | Server variables | What users do |
|---|---|---|
| Telegram account | `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | Scan a QR code (or use their phone number) |

If a channel's variables are missing, the console shows "isn't set up on this server yet" for admins and
"not available yet — ask your workspace admin" for everyone else. Nothing asks users for the values.

Persistent connections (Telegram accounts) need a long-running server: `npm run dev`, `npm start`, Docker or a VM.
They are off when `INFERA_SYNC=off` or `INFERA_WORKER=off` (typical for serverless).

---

## Telegram account

Infera links a personal or business Telegram account through Telegram's official API (MTProto), like
Telegram Desktop does. Every Telegram client app needs an **api_id / api_hash** pair. Infera uses one pair for the
whole server.

### 1. Create the Telegram app (once)

1. Open <https://my.telegram.org/apps> and sign in with a Telegram phone number. Telegram sends the login code to
   the Telegram app, not by SMS. Use an account your organisation controls; it owns the app registration.
2. Fill in **Create new application**:
   - **App title**: e.g. `Infera`
   - **Short name**: e.g. `infera` (5–32 letters/digits)
   - **URL**: optional, e.g. your public site
   - **Platform**: `Desktop` (or `Other`)
   - **Description**: optional
3. Click **Create application**. The page shows **App api_id** (a number) and **App api_hash** (32 hex characters).

Treat the api_hash like a password. Don't commit it, paste it in chats or put it in client-side code. Each Telegram
account can register only one app, so if you already have one, reuse it.

### 2. Add the credentials to the server

Development (`.env.local` in the project root, next to `package.json`):

```bash
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
```

Production: set the same two variables in your hosting provider / Docker environment / systemd unit.

### 3. Restart the server

Environment variables are read at start-up:

- Development: stop `npm run dev` (Ctrl+C) and start it again.
- Production: restart or redeploy the app.

### 4. Check it works

1. Open **/console/connect** and choose **Telegram**. The "Telegram isn't set up on this server yet" message should be gone;
   instead you see **Show QR code**.
2. Click **Show QR code**. On your phone: Telegram → **Settings → Devices → Link Desktop Device**, then scan.
   The code refreshes about every 30 seconds — scan whichever one is on screen.
3. If the account has two-step verification, enter the cloud password when asked.
4. You see **Connected ✓** and recent chats start importing.

No phone camera handy? Use **Use phone number instead**. Telegram sends a login code to the Telegram app (or by SMS),
then asks for the two-step password if the account has one.

`GET /api/v1/integrations` returns `"telegram": true` once the server has valid values.

### Troubleshooting

| Message in the console | Cause | Fix |
|---|---|---|
| Telegram isn't set up on this server yet | `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` missing, or not a number / 32 hex characters | Add both values, restart the server |
| Telegram rejected this server's API credentials (API_ID_INVALID) | The pair is wrong, mistyped or was revoked | Copy both values again from my.telegram.org/apps, restart |
| Telegram asked us to wait N minutes | Telegram rate limit (`FLOOD_WAIT`) after many login attempts | Wait; Infera retries automatically when the time is up |
| Wrong password. Try again. | Wrong two-step verification password | Re-enter it (the hint is shown under the field) |
| That code isn't right / That code expired | Wrong or expired login code (phone login) | Enter the newest code from the "Telegram" chat |
| This Telegram session was ended | The device was removed in Telegram → Settings → Devices | Click **Link again with a QR code** |
| Live sync is off on this server | `INFERA_SYNC=off` or `INFERA_WORKER=off` | Run on a long-running server |

### Security notes

- The api_id/api_hash identify the **app**, not a user; they cannot read anyone's messages on their own.
- Each linked account's session is stored encrypted at rest (AES-256-GCM with `ENCRYPTION_KEY`) in
  `connector_sessions.auth_enc`; passwords, login codes and phone numbers typed during login are encrypted while
  they wait for the connector and are never logged.
- Older versions let people paste their own api_id/api_hash per channel. Those channels keep working with the
  server's values; the old per-channel values are ignored and never shown in the console or API.
- Linking a personal account as a third-party client is allowed by Telegram's API terms, but don't use it for spam
  or bulk messaging — Telegram may limit or ban accounts that do.
