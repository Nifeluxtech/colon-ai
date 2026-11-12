# Phase 4 — Admin Dashboard (v0.5.0)

**Release standard:** every platform setting can be changed from the dashboard, and each role sees only what it is allowed to.

Admin app: `apps/admin/public` (`index.html`, `js/admin-app.js`, `css/admin.css`) at https://admin.apparatus.name.ng.
API: `services/api/src/http/routes/admin.js` (overview, users, moderation, security), `admin-ai.js` (providers, models,
routing, limits, evaluation) and `admin-platform.js` (African AI registry, voice, system settings).

## Who sees what

Every staff endpoint needs a signed-in account with **2FA on** (`requireRole`). The API enforces this; the menu only hides what a role can't open.

| Section | Moderator | Admin | Super Admin |
|---|---|---|---|
| Overview (requests, errors, provider health, latency) | – | ✓ | ✓ |
| Users: search, view, sessions, sign-in events | view only | ✓ | ✓ |
| Users: suspend, unsuspend, revoke sessions, unlock, daily limit | – | ✓ (members and moderators) | ✓ (anyone but themselves) |
| Users: set role | – | user ↔ moderator | any role |
| Moderation queue | ✓ | ✓ | ✓ |
| Providers and models (add, edit, enable/disable) | – | ✓ | ✓ |
| Provider API keys (set, remove, see last 4) | – | – | ✓ |
| Routing, usage and limits, evaluation, African AI registry, voice, browser | – | ✓ | ✓ |
| System settings (brand, flags, maintenance, banner) | – | – | ✓ |
| Security (staff 2FA, sign-ins, audit trail) | – | ✓ | ✓ |

Every change writes an `admin.*` row to `audit_log` (who, what, target, IP). `services/api/test/admin.test.js` checks the minimum role and the 2FA requirement of every admin route.

## Live settings without a redeploy

LiteSpeed/Passenger runs several API workers, so nothing is kept only in memory:

- Settings live in MySQL (`app_settings`: `routing`, `limits`, `system`, `voice`; `ai_providers`; `ai_models`; `user_limits`).
- Each worker caches them for **30 seconds** (`src/lib/settings.js`, `src/ai/dynamic.js`). A change reaches every worker within half a minute. The worker that saved it sees it at once.
- If the database can't be read, a worker keeps its last good value; with none, it uses the built-in defaults.

### Routing and fallback (chat never breaks)

`src/ai/dynamic.js` builds the routing config on top of `src/ai/routing.js`:

1. **Providers:** built-in providers come from `routing.js` (keys from the environment). A database row overrides name, base URL, API type and on/off. A stored key (decrypted with `APP_SECRET`) wins over the environment key; with no stored key, the environment key is used. A key that can't be decrypted (for example after changing `APP_SECRET`) falls back to the environment key.
2. **Models:** while `ai_models` is empty, the built-in table is used. The first model change copies it to the database (`POST /admin/models/seed`), after which the database is the source. Rows are grouped by slot (`qwen`, `deepseek`, …) and tried by `priority`.
3. **Routes:** per mode, the saved slot order is used when it names at least one slot that exists; otherwise that mode keeps its default.
4. **Safety net:** if the result has no usable model at all (every model off, no keys), the whole config falls back to `routing.js`. `/health` shows `ai.routing: "database"` or `"default …"`.

### Limits

Member, guest and guest-per-IP daily limits override `CHAT_DAILY_LIMIT`, `CHAT_GUEST_DAILY_LIMIT` and `CHAT_GUEST_IP_DAILY_LIMIT` (which stay the defaults). Optional per-mode caps add a second counter per person and mode (`u:<id>:<mode>`); staff are exempt. A per-user override replaces the member limit for that account (0 blocks chat).

### Maintenance, flags and the banner

- **Maintenance on:** new chat activity (`POST/PATCH/DELETE` on `/chat/guest`, `/conversations…`, `/messages/:id/feedback`, `/uploads…`) answers `503 {"error":"maintenance","message":…}` with `Retry-After: 300`. Staff are exempt; reading history and sign-in keep working. The chat app shows the message as the reply error and as a banner.
- **Feature flags:** `registration` (email and Google sign-up), `guestChat` (signed-out chat and guest file reading), `uploads`, `sharing`. Off answers `403 {"error":"feature_off"}`. Staff are never blocked.
- **Announcement:** `GET /auth/config` returns it; Colon AI shows it above the welcome screen (dismissable for the session).
- **Brand name:** returned by `/auth/config` as `brand_name`; the apps' logos use it.

## Suspension

`POST /admin/users/:id/suspend` stores a row in `user_suspensions` and deletes every session. Sign-in (password and Google) answers `403 {"error":"suspended"}` and logs `auth.login_blocked_suspended`. Session loading also refuses a suspended account as a backstop.

## Moderation

The queue (`moderation_reports`) is filled from two places: `chat_feedback` rows rated "down" (copied in when the queue opens) and `POST /shared/:token/report` (anyone viewing a shared chat; one report per link and reporter). Staff see the rated reply and the question before it, unless the user turned off "Share feedback", and the whole shared chat for link reports. Resolve can also turn the share link off.

## Endpoints

| Method | Path | Role |
|---|---|---|
| GET | `/admin/overview`, `/admin/stats` | admin |
| GET | `/admin/users?q=&filter=staff\|suspended`, `/admin/users/:id` | moderator |
| PATCH | `/admin/users/:id/role` | admin (admin roles: super_admin) |
| POST | `/admin/users/:id/suspend`, `…/unsuspend`, `…/signout`, `…/unlock` | admin |
| DELETE | `/admin/users/:id/sessions/:sid` | admin |
| PATCH | `/admin/users/:id/limit` `{daily_limit\|null}` | admin |
| GET | `/admin/moderation?status=&kind=`, `/admin/moderation/:id` | moderator |
| POST | `/admin/moderation/:id/resolve` `{note, unshare}`, `…/dismiss`, `…/reopen` | moderator |
| GET/POST | `/admin/providers` | admin |
| PATCH/DELETE | `/admin/providers/:id` | admin (DELETE of a row with a stored key: super_admin) |
| POST | `/admin/providers/:id/key` `{api_key}` (empty removes) | super_admin |
| GET/POST | `/admin/models`, POST `/admin/models/seed` | admin |
| PATCH/DELETE | `/admin/models/:id` | admin |
| GET/PATCH/DELETE | `/admin/routing` `{routes:{mode:[slots]}, hedge}` | admin |
| GET/PATCH | `/admin/limits` `{user, guest, guestIp, modes:{mode:n\|null}}` | admin |
| GET | `/admin/evaluation`; POST/DELETE `/admin/evaluation/runs[/:id]` | admin |
| GET/POST | `/admin/registry`; PATCH/DELETE `/admin/registry/:id` | admin |
| GET/PATCH | `/admin/voice` | admin |
| GET/PATCH | `/admin/system` | super_admin |
| GET | `/admin/security`, `/admin/audit?scope=logins\|admin&before=` | admin |
| POST | `/shared/:token/report` `{reason, comment}` | anyone (rate limited) |

## Database

Migration `0004_admin` (applied automatically when the API starts, under the `colon_migrate` lock): `app_settings`, `ai_providers`, `ai_models`, `ai_calls`, `user_limits`, `user_suspensions`, `moderation_reports`, `eval_runs`, `african_registry`. New tables only, no `ALTER`, so it is safe to re-run. `ai_calls` keeps 30 days (trimmed when the overview loads).

## Configuration

No new environment variables. `APP_SECRET` (already required for 2FA) also encrypts stored provider keys: **don't change it** without re-entering stored keys (until then those providers fall back to their environment keys).

## Tests

- `npm test`: adds `services/api/test/admin.test.js` (no database).
- `services/api/test/e2e-admin.js`: the whole dashboard API against MySQL and the mock provider (roles, keys, live routing and fallback, limits, suspension, moderation, overview, registry, voice, maintenance, flags, audit). Run like `e2e-smoke.js`, plus `DB_*` so it can create staff accounts.
