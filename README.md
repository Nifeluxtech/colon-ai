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
│   └── brand/           Shared brand assets (animated logo intro)
├── database/
│   └── migrations/      MySQL migrations
├── docs/                Architecture, deployment, decisions (adr/)
├── scripts/             Repo tooling
├── .github/             CI, templates, code owners
├── .cpanel.yml          cPanel deployment
├── ROADMAP.md           12-phase plan
└── CHANGELOG.md
```

## Getting started
- Deployment: [docs/deployment.md](docs/deployment.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Roadmap: [ROADMAP.md](ROADMAP.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

---
© 2026 Nifelux. All rights reserved.
