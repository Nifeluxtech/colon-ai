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
