# Colon Admin
Admin control centre. Deployed to admin.apparatus.name.ng. Staff only, with two-factor.

Phase 4 (v0.5.0): overview, users, moderation, models and providers, routing, usage and limits, evaluation,
African AI registry, voice, browser (placeholder), system settings, web search and security.

| Path | Purpose |
|---|---|
| `public/index.html`, `public/assets/css/admin.css` | The page and the few additions to the shared design system |
| `src/main.js` | Boot only |
| `src/core/` | `state.js` (`window.ColonAdmin`), `auth.js` (role check and staff 2FA gate), `router.js` (sections and routes) |
| `src/components/` | `page.js`, `form.js`, `provider-sheet.js` |
| `src/pages/` | one file per section: `overview.js`, `users.js`, `moderation.js`, `ai-providers.js`, `routing.js`, `limits.js`, `evaluation.js`, `registry.js`, `voice.js`, `browser.js`, `settings.js`, `web-search.js`, `security.js` |

The API enforces every permission (the UI only hides what a role can't use). Permissions and the API:
[docs/phases/phase-4.md](../../docs/phases/phase-4.md).
