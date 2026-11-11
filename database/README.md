# Database (MySQL)

Migrations live in `migrations/`, numbered and applied in order (`0001_…`, `0002_…`).
The API applies new migrations automatically when it starts (see `services/api/src/db/index.js`), so a deploy plus a restart is enough. `0003_chat` adds the Colon AI chat tables (Phase 3). `0004_admin` adds the Admin Dashboard tables (Phase 4: settings, providers, models, AI call log, user limits, suspensions, moderation, evaluation runs, African AI registry).
