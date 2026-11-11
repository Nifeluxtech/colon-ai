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
  lib/      shared utilities (logger)
```

## Endpoints (Phase 2)
| Method | Path | Who |
|---|---|---|
| GET | `/health`, `/auth/config`, `/auth/me` | anyone |
| POST | `/auth/register`, `/auth/login`, `/auth/google`, `/auth/logout`, `/auth/forgot`, `/auth/reset`, `/auth/verify-email` | anyone (rate limited) |
| POST | `/auth/resend-verification` | signed in |
| PATCH | `/account/profile` | signed in |
| POST | `/account/password`, `/account/2fa/setup`, `/account/2fa/enable`, `/account/2fa/disable`, `/account/delete`, `/account/sessions/revoke-others` | signed in |
| GET/DELETE | `/account/sessions`, `/account/sessions/:id` | signed in |
| GET | `/admin/stats`, `/admin/users` | moderator+ with 2FA |
| PATCH/POST | `/admin/users/:id/role`, `/admin/users/:id/signout`, `/admin/audit` | admin+ with 2FA |
| POST | `/admin/users/:id/unlock` | moderator+ with 2FA |

State-changing requests need the `X-Colon-Client` header and an allowed `Origin`.
