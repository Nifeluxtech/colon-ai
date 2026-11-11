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

Chat (Phase 3): the app streams replies over SSE from services/api. The model router (src/ai) picks a
provider chain from src/ai/routing.js by mode and reply language (Naijá/Yorùbá/Hausa/Igbo first go to
DeepSeek → N-ATLaS → Gemma 4 → Qwen) and falls back automatically before the first token. Signed-out
visitors use /chat/guest, which streams without saving anything.
```

Hosting facts and constraints: see `phase-1.md` notes in ROADMAP.md (1 GB RAM, workers recycle, no server Chromium).
