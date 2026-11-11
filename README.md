# Colon AI

By Nifelux Technologies. An African-focused AI platform.

- **Colon AI**: an AI assistant powered by Colon Saga, with General, Study, Developer and Research modes.
- **Colon Browser**: a standalone browser that Colon Saga can also operate (AI, Manual and Shared control).
- **Admin Dashboard**: models, routing, users, usage, voice, browser sessions and security.

One shared Node.js backend, hosted on cPanel and deployed from this repo.

See [ROADMAP.md](ROADMAP.md) for the full phased plan.

## Structure (planned)
```
apps/chat      Colon AI web app
apps/browser   Colon Browser web app
apps/admin     Admin Dashboard
backend        Node.js API + WebSocket server
packages/shared Shared UI and utilities
docs           Architecture and decisions
```
