# Colon AI & Colon Browser — Full Roadmap

By Nifelux. Colon AI (formerly NIRA AI) is an African-focused AI platform. It has three apps on one shared backend: **Colon AI** (chat, with Colon Saga), **Colon Browser**, and the **Admin Dashboard**.

Each phase ships only when it meets its release standard: tested, secured, deployed and documented. After Phase 11, the product is complete and ready to launch. Phase 12 holds paid upgrades for when usage justifies them.

## Hosting facts (cPanel inspection, 11 Nov 2026)
- AfeesHost cPanel 138 on CloudLinux. Node.js up to 24.22.2 and Python App are available.
- Limits: 1 GB RAM, 20 entry processes, 100 processes, 5 GB disk, 5 MySQL databases, 5 subdomains.
- Tools available: SSH, Git Version Control, cron and JetBackup. There is no browser Terminal.
- What that means: cPanel runs the backend, the three web apps and MySQL. AI models are used through free hosted APIs (no GPU at this stage).
- **Browser engine (free, owned by us):** Colon Browser runs on the Android System WebView, which is Chromium, on the user's own phone. That's no server cost and no GPU. The web version gets a lighter proxy/reader mode. Server-side Chromium is an upgrade for later.

## Domains (proposed)
- colon.<domain> or the root domain: Colon AI chat
- browser.<domain>: Colon Browser
- admin.<domain>: Admin Dashboard
- api.<domain>: Node.js backend (REST + WebSocket)

---

## Phase 1 — Foundation, hosting & delivery pipeline
- GitHub monorepo `colon-ai` with `apps/chat`, `apps/browser`, `apps/admin`, `backend`, `packages/shared`, `docs`.
- A cPanel Node.js app on Node 24 LTS, plus the subdomains, SSL, MySQL database and users.
- Deployment: GitHub, then cPanel Git Version Control (`.cpanel.yml`), so it can be done from a phone with no PC.
- Environment config and secrets live on the server, never in the repo.
- Health endpoint, structured logs, error pages, and nightly DB backup through cron and JetBackup.
- Live checks: WebSockets through the proxy, persistent process behaviour, outbound HTTPS to AI APIs, and a test of whether headless Chromium can run on cPanel at all (expected to fail on 1 GB RAM and the 100-process cap, but tested, not assumed).
- Brand kit: colours, type and logo. The animated logo intro is a water drop that lands, the ripple becomes a flame, and the flame writes COLON.
**Release standard:** a push to `main` deploys to staging and production, the health check is green, and the WebSocket and AI API tests pass.

## Phase 2 — Accounts & security core
- Register and login with email and password, plus Google sign-in.
- Email verification and password reset through transactional email.
- Secure sessions (httpOnly cookies and refresh tokens), with device and session list and log out everywhere.
- Roles: User, Moderator, Administrator, Super Admin. The owner account becomes Super Admin.
- 2FA (TOTP), required for all admin roles.
- Rate limiting, brute-force lockout, CSRF and CORS rules, input validation and audit log.
- Profile, language preference (English, Pidgin, Yorùbá, Hausa, Igbo), privacy policy, terms, and account deletion.
**Release standard:** the security tests pass, no secrets reach the frontend, and every admin action is audited.

## Phase 3 — Colon AI chat (core product)
- Premium dark, mobile-first chat UI, also installable as a PWA.
- Header: model selector showing **Colon Saga** as the default, with room for future models.
- Input area: mode selector for **General, Study, Developer, Research**. Modes are configurations (instructions, tools, limits) of one assistant.
- Streaming replies, stop and regenerate, edit message, and copy.
- Markdown, tables, code blocks with copy, and maths rendering.
- Conversation history with search, rename, pin, delete and share link.
- File and image upload (PDF, docs, images) for reading and Q&A.
- Model router v1: free hosted providers, automatic fallback when one fails or hits its quota, and per-user daily limits.
- The African layer: Nigerian context, local examples, and replies in the user's chosen language, including Pidgin.
- Feedback buttons (good/bad + reason) on every answer, which feed evaluation later.
**Release standard:** register, then chat in every mode, and history survives reloads and devices. Fallback is tested by killing the primary provider.

## Phase 4 — Admin Dashboard
- Overview: users, requests, errors, provider health and costs.
- Models: add, edit, enable and disable models and providers, with API keys encrypted server-side.
- Routing: assign a model per mode (Saga, Study, Developer, Research) and set fallbacks. Changes take effect without redeploying.
- Usage and limits: quotas per plan, per user and per mode.
- Users: search, suspend, set roles, and view sessions.
- Moderation: reported conversations and abuse queue.
- Evaluation: benchmark runs and model comparison.
- African AI: language models and datasets registry.
- Voice: STT/TTS engine configuration.
- Browser: live sessions, failures, and kill session.
- System settings: branding, feature flags, maintenance mode, announcements.
- Security: audit trail, login events and admin 2FA status.
**Release standard:** every platform setting can be changed from the dashboard, and each role sees only what it is allowed to.

## Phase 5 — Intelligence & evaluation (Colon Saga)
- The Colon benchmark: Nigerian everyday questions, WAEC, JAMB and university study, coding, reasoning, and tool use, plus Pidgin, Yorùbá, Hausa and Igbo sets. **Done in v0.5.2, rerun complete in v0.5.11**
  (`docs/phases/phase-5-benchmark.md`, `npm run bench`, results in `services/api/bench/results/`).
- Test the free candidates (Qwen, Gemma 4, GLM, DeepSeek and newer ones) on accuracy, speed, language quality and cost. The winner becomes Saga's default. **Done**
  (bench 2026-11-12): Gemma 4 26B 98 (default, ~1 s first token), Gemini 3.5 Flash Lite 96.8 (reference only),
  MiniMax M3.1 Flash 88.9, Gemma 4 31B 88.5, Mistral Large 4 88.2, Nemotron 73.9; DeepSeek V4.1 Flash and GLM-5.3
  Flash on NVIDIA's free tier timed out (incomplete, kept as last fallbacks). Model/routing changes need a <30-day
  imported benchmark (`409 needs_benchmark`).
- Specialist routing, where a model clearly beats Saga on a task, such as code or a particular language. **Done in v0.5.10**
  (`docs/phases/phase-5-specialist-routing.md`): a rule-based classifier (language + code / reasoning / exam /
  research / everyday) picks a category; the category's specialist is derived from the last imported benchmark
  (complete models only, ≥5 points better plus a latency penalty, first token ≤15 s) and only reorders the head of
  the chain; weak models (and MiniMax for Yorùbá/Hausa/Igbo) go last. Admin › Routing shows the table and an on/off
  switch (`AI_SPECIALIST_ROUTING`); Admin › Evaluation imports a benchmark file.
- Integrate Nigerian language models (for example N-ATLaS) where their licences allow. **Done in v0.5.11, off by default**:
  the `natlas` provider (OpenAI-compatible, default host Langa `https://langa.julimer.com/v1`, model `n-atlas`,
  output capped by `NATLAS_MAX_TOKENS`, 2048) sits third in the African-language chain and turns on when
  `NATLAS_API_KEY` is set. Not enabled in production: Langa's free plan (12,500 tokens/month) covers only ~10-15
  replies, and a small bench (2 items each in Hausa, Igbo, Yorùbá) scored 3/6 against Gemma 4 26B's 4/6. Licence:
  non-commercial, ≤1,000 active users per 30 days, credit Awarri and the Federal Ministry.

**Phase 5 complete (v0.5.11, 2026-11-13).** Open follow-ups: native-speaker review of the safety language lists; Exa
search adapter and a search cache; rerun DeepSeek/GLM when NVIDIA's free tier answers in time.
- Web search with cited sources for Research mode. **Done in v0.5.3** (`docs/phases/phase-5-research.md`).
- Study mode: step-by-step explanations, quizzes, flashcards, past-question practice and a timed CBT practice test (10 questions, 5 minutes). **Done in v0.5.7**
  (prompt only): quizzes one question at a time with A–D options, feedback and a score; flashcards as a table;
  WAEC/JAMB-style practice, and real past questions only when the student supplies them.
- Developer mode: code explain, fix, generate, and a project-files context. **Done in v0.5.9**
  (`docs/phases/phase-5-developer.md`): a full Developer prompt (explain, fix with root cause + minimal diff + how
  to test, complete runnable generation, review; secure by default; never invents APIs), Explain / Fix a bug /
  Generate / Review quick actions, and code files or a `.zip` project read safely into a budgeted, prioritised
  project context that follow-up messages keep.
- Safety layer: harmful-content filtering and prompt-injection guards. **Done in v0.5.5**
  (`docs/decisions/0003-safety-layer.md`): rule-based input moderation in English, Pidgin, Yorùbá, Hausa and Igbo
  (child safety, self-harm with Nigerian helplines, weapons, drugs, hate, explicit content for guests, Yahoo-yahoo
  and BVN/OTP scams, personal data), optional moderation endpoint, untrusted-content fencing for web pages and
  files, output check on streamed replies, Admin › Safety with audit. Open: native-speaker review of the language
  lists; multi-turn and image text not classified.
**Release standard:** Saga's default is chosen by benchmark score, not popularity, and every model change is re-benchmarked first.

## Phase 6 — Voice
- Voice input built in-house: recording UI, noise handling, language picker, and transcription through the best free Nigerian-capable STT (NaijaVox, Eko STT, Whisper-class).
- Spoken replies (TTS) with Nigerian-accented voices where available.
- Hands-free voice conversation mode.
**Release standard:** accuracy is tested on Nigerian English, Pidgin, Yorùbá, Hausa and Igbo samples, and it works on low-end Android phones.

## Phase 7 — Android app (the home of the browser engine)
- Android app built in the cloud with GitHub Actions, so no Android Studio or PC is needed. It loads Colon AI and gives access to native features.
- A native browser module built on Android System WebView (Chromium): one WebView per tab, managed by the app.
- A secure bridge from the app to the backend over WebSocket. The phone reports page state, and the backend and Saga send commands.
- Native extras: microphone and file permissions, downloads through Android DownloadManager, share-to-Colon, push notifications, and the splash with the logo animation.
- Signed APK for direct install and testing, with an in-app update prompt.
**Release standard:** installs and runs on low, mid and high-end Android phones, the bridge stays connected on mobile data, and the crash-free rate is above 99%.

**Progress (v0.7.1, 13 Nov 2026):**
- [x] App built in the cloud with GitHub Actions (tests, lint, release APK artifact, GitHub Release publishing)
- [x] Release signing key created from a phone into repository secrets (`android-keystore.yml`), with backup
- [x] Colon AI shell: file picker, microphone, downloads, back button, offline screen, theme-synced system bars
- [x] Native browser on System WebView: one WebView per tab, tab memory policy, history, bookmarks, downloads
- [x] `window.ColonNative` JavaScript bridge (origin-restricted) and web integration (`Colon.native`)
- [x] Backend bridge client: WebSocket with reconnect, heartbeats, network awareness
- [x] Share-to-Colon, splash with logo animation, adaptive icons, notification channels and permission
- [x] Signed APK with in-app update prompt (`version.json`)
- [ ] Push notifications (FCM: Firebase project, token registration endpoint, messaging service)
- [ ] Backend bridge server on `/ws` (sessions, page state, commands) and Saga commands (Phase 9) — sessions since
  v0.8.1 and Saga's commands since v0.9.0 are built; storing `page_state` is still open
- [ ] Release signing key actually set up in the repository and first published release
- [ ] Real-device testing on low, mid and high-end phones, including the bridge on mobile data
- [ ] Crash reporting and crash-free rate measurement (target above 99%)
- [ ] Native SpeechRecognizer dictation, Google sign-in via Custom Tab, App Links (`assetlinks.json`)

## Phase 8 — Colon Browser (standalone)
- **Android (full engine):** address and search bar, back, forward, refresh, home, tabs, history, bookmarks, downloads, file upload, full-screen, incognito tab, and clear data.
- Each user's cookies and logins stay on their own phone, never on our server.
- Google and some banks block sign-in inside WebViews. Those sign-ins open in a Chrome Custom Tab and then return.
- **Web version (light mode):** a server-side reader/proxy mode for reading and research pages on cPanel, with a clear "open in the app for full browsing" prompt.
- Session manager in the backend: active tabs, URLs, history and control owner per user and device.
**Release standard:** the major sites (Google, YouTube, news, social, banks' public pages) work in the app, and tabs and history survive app restarts.

**Progress (v0.8.0, 13 Nov 2026), client side:**
- [x] Colon Browser is its own app (`ng.nifelux.colonbrowser`, own name, icon and splash) from the same Android
  project as Colon AI (product flavors, shared code); CI builds, tests, signs and publishes both APKs
- [x] Colon AI browses in a native WebView panel beside the chat (embedded, split, full screen) with "Open in Colon
  Browser"; no standalone browser screen in Colon AI
- [x] Full engine: address/search bar, back, forward, refresh, home, tabs, history, bookmarks, downloads (with an
  in-app list), file upload, full-screen video, private tabs, clear browsing data screen, desktop site
- [x] Tabs and history survive app restarts (private tabs never do); cookies and logins stay on the phone
- [x] Google and bank sign-in open in a Chrome Custom Tab and return
- [x] Web light mode: reader UI with "Open in the app for full browsing", server-reader adapter with fallback and a
  labelled Preview mock
- [x] Each app checks its own update (`version.json` `browser` entry, backward compatible)
- [x] Server-side reader/proxy on cPanel (`GET /browser/fetch`, contract in `docs/phase8-backend-contract.md`)
  (v0.8.1, server side)
- [x] Backend session manager: tabs, URLs, history and control owner per user and device (same contract; REST for
  the web, `session_sync` / `session_request` on the WebSocket bridge) (v0.8.1, server side)
- [ ] Release standard on real phones: major sites (Google, YouTube, news, social, banks' public pages) work, and
  tabs and history survive restarts

## Phase 9 — Saga browser automation
- Saga controls the phone's WebView through the bridge, using a controlled tool set: openUrl, getPageContent, getLinks, click, fill, scroll, screenshot, back, forward, refresh, tabs. Actions run as injected JavaScript and native calls.
- Action, then observation, then decision loop with step limits and timeouts.
- Saga explains each step and cites the pages it used.
- Web pages are treated as untrusted content and can't instruct Saga.
- Required approval, tapped on the phone, before payments, purchases, form submissions, sending messages or sharing personal data.
- Every action is logged and replayable for the user and admins.
**Release standard:** a test suite of multi-step tasks passes, injection attacks fail, and approvals can't be bypassed.

**Progress (v0.9.0, 13 Nov 2026):**
- [x] Saga controls the phone's WebView through the bridge with the controlled tool set (openUrl, getPageContent,
  getLinks, click, fill, scroll, screenshot, back, forward, refresh, tabs); page actions are injected JavaScript
  shipped in the app (`assets/saga/tools.js`), screenshots and navigation are native (`SagaTools`, `BrowserSaga`)
- [x] Decision -> action -> observation loop in the API (`modules/saga`) with step limit, task, model and phone
  timeouts; structured-JSON actions that work with the free models in the router; tasks routed to the worker that
  holds the phone's socket (queued in MySQL)
- [x] Saga explains each step (shown in the chat and kept in the log) and its answer cites the pages it read
- [x] Web pages are untrusted: neutralised and fenced like Research mode's sources, flags logged as safety events
- [x] Approval tapped on the phone before payments, purchases, form submissions, sending messages and personal
  data, from the server's check and the phone's own check of the real element; no pre-approval possible; Shared
  mode asks before every changing step
- [x] Every action logged (`saga_actions`) and replayable by the user (`GET /browser/agent/:id`) and admins
  (Admin › Browser)
- [x] Tests: multi-step tasks, limits and timeouts, injection attacks, approval bypass attempts, bridge commands and
  acks, the phone's approval check (`services/api/tests/unit/saga-*.test.js`, `tests/security/saga-*.test.js`)
- [ ] Release standard on real phones: multi-step tasks on real sites, injection pages and approvals checked on a
  device (the Android code is not compiled or run in CI here yet for this release)

## Phase 10 — Browser inside chat & control modes ✅ (v0.10.0, 13 Nov 2026; AI-only card v0.10.3)
- The browser appears automatically in the conversation when Saga browses.
- Embedded layout (expandable) and split-screen layout (stacked with a resizable divider on phones).
- Switching layouts never restarts or loses the session.
- Control modes with Take control and Return to AI buttons, plus a live AI activity indicator. Pending AI actions pause the instant the user takes over.
- ~~Open a page in Colon Browser, then ask Saga about it in Colon AI. Both use the same session.~~ Replaced by the
  owner's design: **one browser per chat** (below).
**Release standard:** mode and layout switching are tested across devices with no lost state.

**The owner's design (v0.10.0):** each chat has its own browser, and the user drives it from the chat. Per-chat
sessions replace sharing Colon Browser's tabs with Colon AI (Colon Browser keeps its own device-wide session).
- [x] One browser per conversation: sessions keyed by device and conversation on the server (migration 0010); a
  WebView profile per chat in the Android app (own cookies, storage, tabs, history; LRU beyond
  `-Pcolon.chatProfiles`, default 20; shared-profile fallback); the browser is forgotten with its chat
- [x] Chat-driven browsing: "open the browser", "open google.com", "scroll down" in the chat run on that chat's
  browser; anything else asked of it becomes a Saga task in the chat
- [x] Two modes per chat: **AI only** (Saga drives, the user watches) and **AI + me** (both act; Saga sees the
  user's changes), with Take control, Return to AI, Pause and Stop; the default in Settings, a mode chip on the card
  (Colon AI is AI-only since v0.10.3, below; Colon Browser keeps its modes)
- [x] Saga never fills passwords, codes, card numbers, PINs, or sign-in and payment pages: the page is handed to
  the user ("Your turn") and Saga resumes on Return to AI (`SAGA_HANDOFF_TIMEOUT_MS`)
- [x] Embedded, split, full-screen and inline layouts switch without reloading (since v0.8.0–v0.9.2); the panel
  opens in the conversation when Saga browses (since v0.9.0)
- [x] Tests: control rules, per-chat sessions, handoff ordering, secret-field refusals, chat intents and modes
- [x] **The AI-only browser card (v0.10.3, ADR 0006):** the owner's "Manus-style" redesign. Each Saga task is a
  card in the thread under the message that asked for it: a live desktop page scaled down with a status pill (step,
  "Saga needs you", the result line, Retry, Stop); finished cards keep a picture. The browser is always AI-only (the
  AI only / AI + me setting is gone); Take control, asked for by the user or by Saga (`requestUserControl`), opens
  it full screen above the pinned chat composer, and the user's next message gives it back to Saga as a note. The
  server waits for the user (`SAGA_USER_CONTROL_TIMEOUT_MS`) instead of ending the task
- [ ] Release standard on real phones: mode, layout and chat switching checked across devices with no lost state
  (the Android code is not compiled or run in CI here yet for this release)

## Phase 11 — Launch readiness
- Plans and billing: free tier plus paid plans through a Nigerian gateway (Paystack or AfrStar), with limits enforced per plan.
- Play Store listing, policy review and release (AAB).
- Public landing page, SEO, help centre and FAQ, and contact and support inbox.
- Monitoring and alerts (uptime, errors, provider quota), status page, and performance tuning for slow networks.
- Security review, load test to the hosting limits, backup restore drill, and NDPR-compliant privacy.
**Release standard:** the launch checklist is all green, and restore from backup has been proven.

## Phase 12 — Upgrades & own intelligence (when usage justifies it)
- Server-side Chromium (Playwright) on our own server for full browsing on the web and desktop, starting on a free-forever VM if one is available.
- Collect consented feedback data, then clean it into African datasets.
- LoRA/QLoRA fine-tuning and GPU inference only when the data, users and budget justify it, each re-benchmarked against the current default.
- Regular model refresh: any better free model is evaluated, never adopted on hype.

---

## Standing rules
- Free technology first, with no GPU and no paid servers at the start. Paid services only when genuinely necessary, with alternatives explained.
- Everything can be done from an Android phone, through GitHub and cPanel.
- The browser is one reusable module shared by Colon AI and Colon Browser, never duplicated.
- No phase is "done" because it looks done. It is done when it meets its release standard.
