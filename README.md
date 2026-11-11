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

## Web apps (v0.3.0)
- **Colon AI**: welcome screen, streaming chat with Markdown, code, tables, maths and sources, Study / Developer / Research modes, model selector, uploads, voice input, settings, and Colon Browser inside the chat (embedded or split screen).
- **Colon Browser**: tabs, bookmarks, history, downloads, settings, and AI / Manual / Shared control with an observable AI Browse panel. On the web it is an honest reader preview; the full engine is the Android app (docs/adr/0002).
- Light and dark themes, mobile-first from small Android screens.
- Screens that need endpoints the API does not serve yet run on an in-browser data adapter today and switch to the API without code changes: [docs/frontend-data-adapters.md](docs/frontend-data-adapters.md).

## Getting started
- Deployment: [docs/deployment.md](docs/deployment.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Roadmap: [ROADMAP.md](ROADMAP.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Frontend data adapters and expected endpoints: [docs/frontend-data-adapters.md](docs/frontend-data-adapters.md)
- Checks: `node scripts/check.js` and `npm test`

---
© 2026 Nifelux. All rights reserved.
