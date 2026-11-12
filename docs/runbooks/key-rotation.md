# Runbook: key rotation

Secrets live only in cPanel › Setup Node.js App › Environment variables and, for provider and web-search keys, in
the database encrypted with `APP_SECRET`. None are in this repository (it is public). Rotate after any suspected
leak, when a staff member with access leaves, and when a provider asks.

## AI provider keys (Google AI Studio, NVIDIA, Groq, OpenRouter, N-ATLaS)

1. Create the new key at the provider.
2. Super Admin › **Admin › Models** › the provider › API key: paste the new key and save (stored AES-256-GCM
   encrypted, shown masked `••••1234`, audited). A stored key wins over the environment key.
   Or set the environment variable (`GEMINI_API_KEY`, `NVIDIA_API_KEY`, ...) in cPanel and Restart.
3. Send a chat message; check `/health` › `ai.providers`.
4. Revoke the old key at the provider.

Web-search keys (Brave, Tavily, SearXNG token): same, in **Admin › System settings › Web search**, or the environment.
Brevo (`BREVO_API_KEY`), `GOOGLE_CLIENT_ID` and `DB_PASSWORD` are environment-only: change the value (for the
database, first in cPanel › MySQL Databases), Restart, verify `/health`, then revoke the old one.

## APP_SECRET

`APP_SECRET` derives the AES-256-GCM key (SHA-256 of the secret) for:

- **2FA secrets** (`users.totp_secret`, `users.totp_pending`). Every staff account has 2FA, and admin tools refuse
  staff without it.
- **Stored provider keys** (`ai_providers.api_key_enc`) and **web-search keys** (`app_settings` row `search_keys`).

It also salts the guest-limit and share-report hashes (changing it resets today's guest counters; harmless).

Changing it makes everything above unreadable. There is no re-encryption tool in the repository yet, so a rotation
is done in this order (plan 15 minutes, staff available):

1. Take a database dump (`backup-restore.md`, "On demand").
2. Write down which providers have keys stored in Admin (Admin › Models and Admin › System settings › Web search show the last 4).
3. Generate the new secret (48+ random characters): `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`.
4. cPanel › Setup Node.js App › set `APP_SECRET` to the new value › **Restart**.
5. Reset 2FA so staff can enrol again (otherwise their sign-in fails decrypting the old secret), over SSH:
   ```sh
   mysql <db> -e "UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0 WHERE totp_secret IS NOT NULL OR totp_pending IS NOT NULL"
   ```
   Each staff member signs in with their password and turns two-factor on again (Admin › Your account, or Security in the chat app's account screens) before using admin.
   Tell them in advance; the Owner goes first.
6. Re-enter stored provider and web-search keys in Admin (unreadable stored keys fall back to the environment keys
   meanwhile and log `provider_key_unreadable`). Rotating those keys at the same time is a good idea.
7. Verify `/health` (`two_factor: true`, providers listed), one chat, one Research query.

Open item: a `rotate-app-secret` script that decrypts with the old secret and re-encrypts with the new one would
avoid steps 5 and 6.
