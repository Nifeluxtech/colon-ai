# Production Blueprint v1.0 (17 Nov 2026) vs Colon AI 0.11.8 — gap roadmap

## Already in place (keep, don't rebuild)
- Node 24 API as a modular monolith (no framework), MySQL with ordered auto-run migrations (0001–0011) and `schema_migrations`.
- Auth: email/password, sessions, TOTP, recovery, Google sign-in, suspensions; roles user / moderator / admin / super_admin.
- Model routing: provider adapters, `ai_providers` / `ai_models` registry with priority + enabled, fallback chain, Study / Developer / Research modes, admin routing page.
- Safety: injection checks, redaction, output policy, safety events; Saga approvals before submit / pay / delete / send.
- Browser automation runs on the user's phone (WebView), not on cPanel — already matches the blueprint's "no browsers on shared hosting".
- Uploads outside the web root (`UPLOAD_DIR`), per-user paths; rate limits; audit log; backup runbook.
- Admin: overview, users, limits, routing, AI, evaluation, moderation, safety, audit.

## Gaps, in build order
### A. Business engine (blueprint phase 2) — biggest gap, needed for launch
1. Migration 0012: plans, subscriptions, entitlements, credit wallets, credit ledger (immutable), usage events (user, feature, model, tokens, cost, credits, request_id UNIQUE). Money in kobo.
2. Credit service: reserve → call → reconcile/refund, one transaction, idempotency key per request.
3. Entitlement checks server-side before every model/tool call (replaces the flat `daily_limit` / `chat_usage`).
4. Five plans seeded (Free, Startup, Pro, Pro Plus, Max) with the blueprint's draft quotas, editable in admin.
5. Paystack: checkout, signed + idempotent webhook, grant only after verified payment.
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
- Hosting checks still open: cron minimum interval, MySQL connection ceiling, outbound HTTPS policy (cPGuard blocks some fetches).
