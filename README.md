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
├── apps/                    static web apps (ES modules, no build step): public/ = index.html + assets,
│   │                        src/ = main.js, core/, pages/, components/ (chat also actions/)
│   ├── chat/                Colon AI web app        → chat.apparatus.name.ng
│   ├── browser/             Colon Browser web app   → browser.apparatus.name.ng
│   └── admin/               Admin Dashboard         → admin.apparatus.name.ng
├── services/
│   └── api/                 Node.js API + WebSocket → api.apparatus.name.ng
│       ├── src/             config/ (schema, validated at boot), http/ (middleware, thin routes), ws/,
│       │                    modules/ (account, admin, ai, auth, bench, chat, extract, health, search), shared/, db/
│       ├── tests/           unit/, integration/, security/, e2e/, helpers/, fixtures/
│       ├── bench/           benchmark sets and results
│       └── scripts/         bench, research check, route dump
├── packages/
│   ├── ui/                  Colon design system: js/ (window.Colon, markdown, browser module), css/, fonts/, test/
│   └── brand/               logo marks and the animated intro
├── database/migrations/     MySQL/MariaDB migrations (forward-only, applied at API start)
├── config/                  api.env.example, e2e.env.example, README.md (every environment variable)
├── docs/                    architecture, deployment, data adapters, decisions/, phases/, runbooks/, security/
├── scripts/                 check.js (repo rules), deploy/build-docroot.sh, dev/ (headless check, static server,
│                            link and import-cycle checks)
├── .github/                 CI, templates, code owners
├── .cpanel.yml              cPanel "Deploy HEAD Commit" (builds versioned /v<version>/ docroots)
├── ROADMAP.md               12-phase plan
└── CHANGELOG.md
```

## What's live (v0.5.4)
- **Colon AI**: chat with Colon Saga **without an account** (guest chats aren't saved), or log in to sync history, Saved, settings and files across devices. Streaming replies with stop, regenerate, edit and copy; Markdown, code, tables and maths; General / Study / Developer / Research modes; uploads (images, PDF, documents, text) with text extraction; feedback on every answer; share links; voice input; and Colon Browser inside the chat (embedded or split screen).
- **Colon Saga backend**: model router over free hosted models (Gemma 4 26B on Google AI Studio first, then MiniMax M3.1 Flash, Gemma 4 31B, Qwen, DeepSeek and GLM across NVIDIA, Groq and OpenRouter; N-ATLaS optional for African languages), chosen by benchmark score, with hedged racing and automatic fallback, Naijá / Yorùbá / Hausa / Igbo routing, the African layer in every prompt, and per-user daily limits. Add provider keys in cPanel: [docs/deployment.md](docs/deployment.md#phase-3-v040-ai-providers-limits-and-uploads).
- **Research mode**: web search with cited sources ([1], [2] chips and a Sources list): [docs/phases/phase-5-research.md](docs/phases/phase-5-research.md).
- **Admin Dashboard**: models and providers, live routing, users, moderation, limits, evaluation and security: [docs/phases/phase-4.md](docs/phases/phase-4.md).
- **Colon Browser**: tabs, bookmarks, history, downloads, settings, and AI / Manual / Shared control with an observable AI Browse panel. On the web it is an honest reader preview; the full engine is the Android app ([docs/decisions/0002](docs/decisions/0002-webview-browser-engine.md)).
- **Accounts**: ChatGPT-style sign in (Continue with Google, or email then password), verification, reset, 2FA, devices. The Admin Dashboard requires sign-in and 2FA.
- Light and dark themes, mobile-first from small Android screens. If the API can't be reached, Colon AI falls back to an on-device Preview: [docs/frontend-data-adapters.md](docs/frontend-data-adapters.md).

## Getting started
- Deployment: [docs/deployment.md](docs/deployment.md) and runbooks: [deploy](docs/runbooks/deploy.md), [rollback](docs/runbooks/rollback.md), [key rotation](docs/runbooks/key-rotation.md), [backup and restore](docs/runbooks/backup-restore.md)
- Configuration (every environment variable): [config/README.md](config/README.md)
- Security: [docs/security/threat-model.md](docs/security/threat-model.md), [SECURITY.md](SECURITY.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Roadmap: [ROADMAP.md](ROADMAP.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Frontend data adapters and expected endpoints: [docs/frontend-data-adapters.md](docs/frontend-data-adapters.md)
- Checks: `node scripts/check.js` and `npm test`; links: `node scripts/dev/linkcheck.js`; frontend smoke test: `node scripts/dev/headless-check.js`

---
© 2026 Nifelux. All rights reserved.
