# Architecture

```
            ┌──────────────┐  ┌────────────────┐  ┌──────────────┐
            │  apps/chat   │  │  apps/browser  │  │  apps/admin  │   static web apps (cPanel subdomains)
            └──────┬───────┘  └───────┬────────┘  └──────┬───────┘
                   └─────── HTTPS + WebSocket ──────────┘
                                  │
                        ┌─────────▼─────────┐
                        │   services/api    │   Node 24 · api.apparatus.name.ng
                        └───┬───────────┬───┘
                            │           │
                     ┌──────▼──┐   ┌────▼──────────────┐
                     │  MySQL  │   │ AI providers (free│
                     └─────────┘   │ hosted APIs)      │
                                   └───────────────────┘
   Android app (Phase 7): WebView = Colon Browser engine, bridged to the API over WebSocket.
```

Hosting facts and constraints: see `phase-1.md` notes in ROADMAP.md (1 GB RAM, workers recycle, no server Chromium).
