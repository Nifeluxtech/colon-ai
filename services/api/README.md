# @nifelux/colon-api

The shared Node.js backend for Colon AI, Colon Browser and the Admin Dashboard: REST + WebSocket.

- Runtime: Node.js 24 (cPanel "Setup Node.js App", Passenger)
- Startup file: `app.js`
- Config: environment variables only, validated at boot against `src/config/defaults.js`; documented in `config/README.md` and `config/api.env.example`

```
app.js          Passenger startup file
src/
  config/       defaults.js (THE schema of environment variables), env.js (read + validate), index.js
  http/         server.js (request id, CORS, CSRF, session, maintenance, errors), router.js, middleware/,
                routes/{health,auth,account,admin,chat}/ (wiring only: path -> guards, rate limits, handler)
  ws/           WebSocket gateway
  modules/      account, admin, ai, auth, bench, chat, extract, health, search; each with an index.js facade
                (the only file other layers import) and handlers/ where it serves routes
    ai/         routing.js (built-in table), dynamic.js (live routing from the database), hedge.js (racing),
                client.js (streaming), providers/ (one file per provider), prompts.js, limits.js, calls.js, sse.js
    search/     search.js, providers/ (one file per search provider), reader.js, net.js (SSRF guard), prompt.js
    extract/    text extraction by file type: sniff, image, docx, pdf, text
  shared/       logger, request-context, crypto, audit, settings, mailer, validate, ratelimit, security-headers,
                multipart
  db/           MariaDB pool, health check and migration runner
tests/          unit/, integration/, security/ (npm test); e2e/ (needs MariaDB; env: config/e2e.env.example);
                helpers/ (mock provider, HTTP client); fixtures/
scripts/        bench.js, research-check.js, dump-routes.js (route table, to diff two checkouts)
```

Layer rules (enforced by `node scripts/check.js`): `docs/architecture.md`.

Tests: `npm test` (here) or `npm test` at the repo root.

## Endpoints (Phase 2)
| Method | Path | Who |
|---|---|---|
| GET | `/health`, `/auth/config`, `/auth/me` | anyone |
| POST | `/auth/register`, `/auth/login`, `/auth/google`, `/auth/logout`, `/auth/forgot`, `/auth/reset`, `/auth/verify-email` | anyone (rate limited) |
| POST | `/auth/resend-verification` | signed in |
| PATCH | `/account/profile` | signed in |
| POST | `/account/password`, `/account/2fa/setup`, `/account/2fa/enable`, `/account/2fa/disable`, `/account/delete`, `/account/sessions/revoke-others` | signed in |
| GET/DELETE | `/account/sessions`, `/account/sessions/:id` | signed in |
| GET | `/admin/users` | moderator+ with 2FA |
| GET/PATCH/POST | `/admin/stats`, `/admin/users/:id/role`, `/admin/users/:id/signout`, `/admin/users/:id/unlock`, `/admin/audit` | admin+ with 2FA |

## Endpoints (Phase 3: Colon AI chat)
| Method | Path | Who |
|---|---|---|
| GET | `/models`, `/chat/usage`, `/shared/:token` | anyone |
| POST | `/chat/guest` (SSE, saves nothing), `/chat/guest/extract` | anyone (rate limited, daily guest limit, allowed `Origin` required in production) |
| GET/POST/DELETE | `/conversations`, `/conversations/export` | signed in |
| GET/PATCH/DELETE | `/conversations/:id` | signed in (owner) |
| POST | `/conversations/:id/messages`, `…/messages/:mid/regenerate`, `…/messages/:mid/edit` (SSE), `…/messages/:mid/stop`, `/conversations/:id/notes` | signed in (owner) |
| POST/DELETE | `/conversations/:id/share` | signed in (owner) |
| POST | `/messages/:id/feedback` | signed in (owner) |
| POST/GET/DELETE | `/uploads`, `/uploads/:id/file`, `/uploads/:id` | signed in (owner) |
| GET/PATCH | `/chat/settings`, GET `/chat/stats` | signed in |

Full request/response shapes and the SSE event format: `docs/frontend-data-adapters.md`.

## Endpoints (Phase 4: Admin Dashboard)
Overview, users (suspend, sessions, limits), moderation, providers and models (encrypted keys), live routing, usage limits, evaluation, African AI registry, voice, system settings and security, plus `POST /shared/:token/report`. Full table, permissions and the live-config rules: `docs/phases/phase-4.md`.

State-changing requests need the `X-Colon-Client` header and an allowed `Origin`.
