# @nifelux/colon-api

The shared Node.js backend for Colon AI, Colon Browser and the Admin Dashboard: REST + WebSocket.

- Runtime: Node.js 24 (cPanel "Setup Node.js App", Passenger)
- Startup file: `app.js`
- Config: environment variables only (see `/.env.example`)

```
src/
  config/   environment config
  db/       MySQL pool and health check
  http/     HTTP server and routes
  ws/       WebSocket gateway
  lib/      shared utilities (logger, crypto, mail, audit)
  ai/       model router v1: routing.js (built-in routing table), dynamic.js (live routing from the database,
            falls back to routing.js), client.js (OpenAI-compatible streaming), index.js (fallback), prompts.js
            (modes + African layer), limits.js (daily limits, live), calls.js (AI call log), sse.js
  chat/     chat storage, context building, streamed replies, uploads and text extraction
test/       node --test unit tests (mocked fetch, no database) + e2e-smoke.js and a mock provider
```

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
Overview, users (suspend, sessions, limits), moderation, providers and models (encrypted keys), live routing, usage limits, evaluation, African AI registry, voice, system settings and security, plus `POST /shared/:token/report`. Full table, permissions and the live-config rules: `docs/phase-4.md`.

State-changing requests need the `X-Colon-Client` header and an allowed `Origin`.
