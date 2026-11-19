# Production Blueprint v1.0 (17 Nov 2026) vs Colon AI 0.11.8 — gap roadmap

## Already in place (keep, don't rebuild)
- Node 24 API as a modular monolith (no framework), MySQL with ordered auto-run migrations (0001–0011) and `schema_migrations`.
- Auth: email/password, sessions, TOTP, recovery, Google sign-in, suspensions; roles user / moderator / admin / super_admin.
- Model routing: provider adapters, `ai_providers` / `ai_models` registry with priority + enabled, fallback chain, Study / Developer / Research modes, admin routing page.
- Safety: injection checks, redaction, output policy, safety events; Saga approvals before submit / pay / delete / send.
- Browser automation runs on the user's phone (WebView), not on cPanel — already matches the blueprint's "no browsers on shared hosting".
- Uploads outside the web root (`UPLOAD_DIR`), per-user paths; rate limits; audit log; backup runbook.
- Admin: overview, users, limits, routing, AI, evaluation, moderation, safety, audit.

## Progress
- A1–A3 done in v0.12.0 (17 Nov 2026), shadow mode. A5 (Korapay) and A8 (plan page) done in v0.13.0. A4, A6 and A7
  (plans editable in admin, per-call tokens and cost in `ai_calls`, Admin › Plans / Credits / Payments / Costs, daily
  spend alert) done in v0.14.0 (17 Nov 2026). Step A is complete except switching `BILLING_MODE` to `enforce`.
  Next: B (memory and projects).
- B9 and B10 done in v0.15.0 (18 Nov 2026): `colon_memories` with per-user consent (off by default, opt-in),
  Settings › Memory (view, add, edit, delete, on/off), "remember that …" in chat, retrieval by keyword overlap +
  recency within `MEMORY_TOKEN_BUDGET`; projects with instructions, chats, files and memories, limited by the plan's
  `projects` entitlement (enforced only when `BILLING_MODE=enforce`). No vector DB, no model-suggested memories.
  Next: C (jobs and cron).
- C11–C13 done in v0.16.0 (19 Nov 2026): `colon_jobs` (lease token, attempts, exponential backoff, dead-letter,
  idempotency key) and `colon_cron_runs`; the cPanel cron dispatcher is a CLI (`services/api/scripts/cron.js`, every
  `JOBS_CRON_INTERVAL_MIN` = 5 min, direct DB, no HTTP because of ALTCHA) with a secret-header HTTP trigger as a
  secondary; Saga schedules are `saga.schedule` jobs (run by the worker holding the phone, re-queued on each run);
  replies cut off by a restart are reconciled (`chat.reconcile`: credits refunded or settled); Admin › Jobs (counts,
  stale leases, dead letters, retry / cancel with reason, cron last-run warning at 3 × the interval). Research mode
  still streams inside its request (no timer to move); a resumable background research job is D16.
  Next: D (tools and media).
- D14–D17 done in v0.17.0 (19 Nov 2026): a server-side tool registry (`modules/tools`: schema, risk, plan access and
  entitlement, credits, timeout, consent, guests; one router `invoke()` that reserves, settles or refunds credits)
  wrapping web search, Research mode, the page reader, file extraction and the chat's browser tools, with a
  read-only Admin › Tools; image generation through Google AI Studio (`IMAGE_MODEL`, off while empty) metered with
  the plans' `image_credits` plus `BILLING_CREDITS_IMAGE`; deep research as a resumable, metered background job
  (`colon_research_runs`, `research.step` jobs on the cron, one bounded step per job, consent first,
  `BILLING_CREDITS_DEEP_RESEARCH` reserved and refunded on failure or cancel, `research.sweep`); Developer mode gets a
  Monaco editor for code blocks (jsDelivr, textarea fallback). **No code execution**: running code only via an
  external sandbox (Judge0 or similar) stays for later. Next: E (security, privacy, ops).
- v0.17.1 (19 Nov 2026): image editing on top of D15: `POST /conversations/:id/images` takes `attachment_ids` (up to 3
  of the user's own PNG/JPEG/WebP images in that chat, 7 MB each) sent to `IMAGE_MODEL` as inline image parts; the
  chat model's `generate_image` gets `edit`; `/image` with an image attached and Edit on image replies in the app.
  Same metering as a new image. No migration.

## Gaps, in build order
### A. Business engine (blueprint phase 2) — biggest gap, needed for launch. Payments: Korapay.
1. Migration 0012: plans, subscriptions, entitlements, credit wallets, credit ledger (immutable), usage events (user, feature, model, tokens, cost, credits, request_id UNIQUE). Money in kobo.
2. Credit service: reserve → call → reconcile/refund, one transaction, idempotency key per request.
3. Entitlement checks server-side before every model/tool call (replaces the flat `daily_limit` / `chat_usage`).
4. Five plans seeded (Free, Startup, Pro, Pro Plus, Max) with the blueprint's draft quotas, editable in admin.
5. Korapay (user decision 17 Nov 2026, not Paystack): checkout, signed + idempotent webhook, grant only after verified payment.
6. Add user_id, tokens and cost to `ai_calls` (or write usage events) so cost per user/model/plan is visible.
7. Admin: Plans, Credits (grant/revoke with reason), Costs (daily spend, global caps, alerts).
8. User UI: plan page, balance, usage history, upgrade.

### B. Memory and projects (blueprint 9)
9. `colon_memories` (user / project / task), consent, view-edit-delete UI; retrieval by relevance + recency within a token budget. No vector DB yet.
10. Projects (limits per plan): scoped chats, files and memory.

### C. Jobs and cron (blueprint 11)
11. `colon_jobs` with lease token, attempts, backoff, dead-letter; cPanel cron dispatcher (5 min) claiming small batches.
12. Move Saga schedules and long research off in-process timers onto the job table, so they survive API restarts.
13. Admin Jobs page (retry, cancel, stale count, cron last-run).

### D. Tools and media (blueprint 10)
14. Server-side tool registry: schema, risk level, plan access, credit cost, timeout, consent flag (wrap existing search, browse, extract).
15. Image generation adapter (metered image credits).
16. Deep research as a metered job.
17. Developer mode: Monaco editor; code execution only via an external sandbox (Judge0 or similar), later.

### E. Security, privacy, ops (blueprint 15, 18 — overlaps Phase 11)
18. Google sign-in: confirm Custom Tab + state/PKCE + one-time handoff code; App Links (`assetlinks.json`).
19. Ownership tests for every resource (cross-user access), webhook replay, cron overlap, double-charge tests.
20. Retention/deletion rules, NDPR privacy policy, no training on private data without opt-in.
21. Monitoring: error rate, p95 latency, provider failures, spend per day, cron last-run; status page; restore drill.

### F. Later (blueprint 6–7, matches Phase 12)
22. External browser runtime (Browser Use / Playwright) for web and desktop, MCP gateway, connectors.
23. Eval set, consented data, LoRA/QLoRA on external GPU.

## Conflicts to settle
- Blueprint says the API runs on cPanel; check where the API server actually runs today (cron and Passenger steps depend on it).
  Settled (0.16.0): the API runs on AfeesHost cPanel under Passenger (Setup Node.js App, Node 24), so the dispatcher
  is a cPanel cron job running a CLI with the app's env from a private env file.
- Hosting checks still open: cron minimum interval (0.16.0 assumes 5 minutes; `JOBS_CRON_INTERVAL_MIN` follows the
  real one), MySQL connection ceiling (the cron opens its own pool of at most 5), outbound HTTPS policy (cPGuard
  blocks some fetches; ALTCHA blocks some non-browser clients on subdomains, hence no curl-based cron).
