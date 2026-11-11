<div align="center">

# COLON AI

**By Nifelux** · An African-focused AI platform

</div>

| Product | What it is |
|---|---|
| **Colon AI** | AI assistant powered by **Colon Saga**, with General, Study, Developer and Research modes |
| **Colon Browser** | A browser you drive yourself, or Saga drives for you (AI · Manual · Shared) |
| **Admin Dashboard** | Models, routing, users, usage, voice, browser sessions and security |

## Repository structure

```
colon-ai/
├── apps/
│   ├── chat/            Colon AI web app        → chat.apparatus.name.ng
│   ├── browser/         Colon Browser web app   → browser.apparatus.name.ng
│   └── admin/           Admin Dashboard         → admin.apparatus.name.ng
├── services/
│   └── api/             Node.js API + WebSocket → api.apparatus.name.ng
├── packages/
│   ├── brand/           Shared brand assets (animated logo intro)
│   └── ui/              Colon design system + shared browser module (deployed to /ui/)
├── database/
│   └── migrations/      MySQL migrations
├── docs/                Architecture, deployment, decisions (adr/)
├── scripts/             Repo tooling
├── .github/             CI, templates, code owners
├── .cpanel.yml          cPanel deployment
├── ROADMAP.md           12-phase plan
└── CHANGELOG.md
```

## What's live (v0.4.0)
- **Colon AI**: chat with Colon Saga **without an account** (guest chats aren't saved), or log in to sync history, Saved, settings and files across devices. Streaming replies with stop, regenerate, edit and copy; Markdown, code, tables and maths; General / Study / Developer / Research modes; uploads (images, PDF, documents, text) with text extraction; feedback on every answer; share links; voice input; and Colon Browser inside the chat (embedded or split screen).
- **Colon Saga backend**: model router v1 over free hosted models (Qwen on Groq, DeepSeek and Gemma 4 on OpenRouter, Gemma 4 on Google AI Studio, optional N-ATLaS) with automatic fallback, Naijá / Yorùbá / Hausa / Igbo routing, the African layer in every prompt, and per-user daily limits. Add provider keys in cPanel: [docs/deployment.md](docs/deployment.md#phase-3-v040-ai-providers-limits-and-uploads).
- **Colon Browser**: tabs, bookmarks, history, downloads, settings, and AI / Manual / Shared control with an observable AI Browse panel. On the web it is an honest reader preview; the full engine is the Android app (docs/adr/0002).
- **Accounts**: ChatGPT-style sign in (Continue with Google, or email then password), verification, reset, 2FA, devices. The Admin Dashboard requires sign-in and 2FA.
- Light and dark themes, mobile-first from small Android screens. If the API can't be reached, Colon AI falls back to an on-device Preview: [docs/frontend-data-adapters.md](docs/frontend-data-adapters.md).

## Getting started
- Deployment: [docs/deployment.md](docs/deployment.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Roadmap: [ROADMAP.md](ROADMAP.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Frontend data adapters and expected endpoints: [docs/frontend-data-adapters.md](docs/frontend-data-adapters.md)
- Checks: `node scripts/check.js` and `npm test`

---
© 2026 Nifelux. All rights reserved.
