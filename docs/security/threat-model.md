# Threat model

Scope: the Colon AI web apps (chat, browser, admin), the Colon API (`services/api`), its MariaDB database and the
cPanel host it runs on. Reviewed for v0.5.4 (2026-11-12). Update it with every change to auth, uploads, outbound
fetches, secrets or the admin surface. Operational steps: `docs/runbooks/`.

## Assets

| Asset | Where | Why it matters |
|---|---|---|
| User accounts and sessions | `users`, `sessions` (token stored as SHA-256), cookie `colon_sid` | account takeover |
| Chat history, notes, uploaded files | `chat_*` tables, `UPLOAD_DIR` outside every web root | private conversations, documents |
| Staff powers | roles `moderator`, `admin`, `super_admin`; admin.apparatus.name.ng | change routing, keys, users, settings |
| Provider and search API keys | cPanel env vars; `ai_providers.api_key_enc`, `app_settings.search_keys` (AES-256-GCM) | cost, quota abuse, provider bans |
| `APP_SECRET` | cPanel env only | decrypts 2FA seeds and stored keys |
| Database credentials | cPanel env only (`DB_USER`, `DB_PASSWORD`) | full data access |
| Audit log | `audit_log` | accountability for staff and security events |
| Service availability | 1 GB RAM, 20 entry processes, free-tier model quotas | the whole product |

## Actors

- **Anonymous visitors and guests**: can chat as guests (nothing saved) within guest limits, view shared chats.
- **Signed-in users**: their own data only.
- **Staff**: moderator < admin < super admin; every staff action is checked by the API (not just hidden in the UI)
  and audited. Only super admins see or set keys.
- **Attackers**: credential stuffers, quota abusers and scrapers; CSRF from other sites; people planting
  instructions in web pages for Research mode (prompt injection); people trying to make the server fetch internal
  addresses (SSRF); malicious uploads.
- **Third parties we send data to**: AI providers (prompts and extracted file text), search providers (queries),
  fetched websites (our server's IP and User-Agent), Brevo (email addresses), Google (sign-in).
- **Host**: AfeesHost (shared cPanel, CloudLinux). We trust it with everything at rest.

## Trust boundaries

1. **Browser ↔ API** (HTTPS): everything from the client is untrusted. CORS allows only `ALLOWED_ORIGINS`.
2. **API ↔ AI providers**: model output is untrusted text; the frontend renders it through the sanitising Markdown
   renderer (no raw HTML, no scripts).
3. **API ↔ the open web** (Research mode reader, `/browser/fetch` reader preview): page content is untrusted data and
   untrusted *instructions*.
4. **API ↔ database / file system**: trusted, same host account.
5. **Staff ↔ admin API**: elevated; role checks, 2FA and audit on every route.
6. **Repository ↔ public**: the GitHub repository is **public**.

## Controls

### Secrets and the public repository
- No secret is ever committed. `.env` and `.env.*` are gitignored (only `*.env.example` with empty values is
  tracked); `.htaccess` is server-only. CI and `scripts/check.js` keep `config/api.env.example` in sync with the
  config schema so nobody invents an undocumented variable.
- Secrets are cPanel environment variables. Production refuses to start without `DB_USER`/`DB_NAME` or with
  malformed numbers/URLs (fail closed, clear message), see `config/README.md`.
- **Keys at rest**: provider keys, search keys and 2FA seeds are AES-256-GCM (random 96-bit IV, auth tag, versioned
  `v1.` box) with a key derived from `APP_SECRET` (SHA-256). Admin screens show only `••••1234`. A stored key that
  can't be decrypted is ignored (falls back to the env key), never shown. Rotation: `docs/runbooks/key-rotation.md`.

### Authentication and sessions
- Passwords: **scrypt** (N=16384, r=8, p=1, 64-byte key, 16-byte salt), timing-safe compare; an unknown email and a wrong
  password get the same error. (Timing still differs slightly: an unknown email skips the hash. Minor, open.)
- **Lockout**: 5 failed passwords lock the account for 15 minutes (reset by a password reset or an admin unlock);
  plus per-account and per-IP rate limits on sign-in.
- **Sessions**: random 256-bit tokens, only the SHA-256 stored; cookie `HttpOnly`, `SameSite=Lax`, `Secure` in
  production, shared across subdomains via `COOKIE_DOMAIN`; `SESSION_DAYS` expiry; users can revoke devices; suspension
  revokes every session at once.
- **CSRF**: state-changing requests need an allowed `Origin` (when sent) **and** the custom `X-Colon-Client` header,
  which forces a CORS preflight other sites can't pass; guest chat in production requires an allowed `Origin`.
- **Staff 2FA**: TOTP (±1 step); admin tools refuse staff without 2FA, and staff can't turn it off.
- Google sign-in checks the ID token with Google (`tokeninfo`): audience must be `GOOGLE_CLIENT_ID`, email verified.

### Abuse and availability
- Rate limits in MariaDB (`rate_limits`, shared by all workers) per IP and per user on sign-in, recovery, chat send,
  sharing, export, uploads and guest chat.
- **Daily reply limits**: signed-in users (`CHAT_DAILY_LIMIT`), guests per browser (`CHAT_GUEST_DAILY_LIMIT`) and
  all guests per IP (`CHAT_GUEST_IP_DAILY_LIMIT`, higher because of carrier NAT); guest identities are HMAC-style
  hashes salted with `APP_SECRET`. Per-user overrides in Admin › Usage and limits.
- Timeouts and caps on every model call (`AI_*`), hedging capped by `AI_HEDGE`; maintenance mode for incidents.

### Outbound fetches (SSRF)
- Research reader and `/browser/fetch`: http/https only; DNS resolved and loopback, private (RFC 1918), CGNAT,
  link-local (incl. cloud metadata 169.254.169.254), multicast, reserved and IPv6 equivalents refused; re-checked on
  every redirect (capped); size and time caps; HTML only for the reader; scripts, styles, iframes, forms and event
  handlers stripped in the preview. Unit-tested guards.
- Accepted residual risk: a tiny DNS-rebinding window between our lookup and the socket's own lookup (no
  socket pinning on shared hosting); documented in `docs/phases/phase-5-research.md`.

### Prompt injection via web pages
- Fetched page text is passed as numbered, delimited sources with an explicit rule that it is untrusted information,
  never instructions; the model has no tools in chat, so injected text can at worst distort an answer, not act.
- Answers must cite `[n]`, and users see the sources list to check claims.
- Residual risk: a page can still mislead the answer or push links. The AI browser (later phases) must keep
  approval for paying, submitting forms or sending messages (`SECURITY.md`).

### Uploads
- 20 MB per file, per-user quota (`UPLOAD_QUOTA_MB`); the real file signature is sniffed server-side (not the
  client's MIME type); text extracted once at upload; files stored outside every web root and served only to their
  owner through the API with `nosniff`, a sandboxing `Content-Security-Policy` (`default-src 'none'; sandbox`),
  `Cache-Control: private` and `attachment` disposition for anything that is not an image, PDF or audio.

### Response hardening and logging
- Every API response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Cross-Origin-Resource-Policy: same-site`, HSTS, `Cache-Control: no-store`.
- 5xx errors return a generic message; details go to the log with the request id (`X-Request-Id` / `req_id`).
- **Audit**: sign-ins, 2FA changes, role changes, suspensions, unlocks, key and settings changes and moderation are
  written to `audit_log` and visible in Admin › Security.

## Open risks

| Risk | Status / mitigation |
|---|---|
| **No content-safety filter** on model input or output yet (harmful content, self-harm, illegal requests) | Relies on providers' own filters; user reports and the moderation queue. Planned: safety layer (ROADMAP Phase 5). |
| Prompt injection from web pages misleading Research answers | Untrusted-source framing, citations; no tool use in chat. |
| `APP_SECRET` rotation forces staff 2FA re-enrolment and re-entering stored keys | No re-encryption script yet (`docs/runbooks/key-rotation.md`). |
| Shared hosting: other tenants, host compromise, 1 GB RAM / 20 entry processes easy to exhaust | Rate and guest limits, timeouts; JetBackup + nightly dumps. |
| DNS-rebinding window in outbound fetches | Accepted; documented. |
| Free-tier provider keys abused if leaked | Keys only in env/encrypted DB; rotate per runbook; provider dashboards for usage. |
| Data sent to third-party AI and search providers | Inherent to hosted free models; guests' chats are not stored by us. Keep the privacy text in the apps accurate. |
| No CSP on the static apps yet (set via server `.htaccess`, not in the repo) | Markdown renderer sanitises; inline theme script would need a hash. |
