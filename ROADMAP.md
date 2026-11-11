# Colon AI & Colon Browser — Full Roadmap

By Nifelux. Colon AI (formerly NIRA AI) is an African-focused AI platform. It has three apps on one shared backend: **Colon AI** (chat, with Colon Saga), **Colon Browser**, and the **Admin Dashboard**.

Each phase ships only when it meets its release standard: tested, secured, deployed and documented. After Phase 12, the product is complete and ready to launch.

## Hosting facts (cPanel inspection, 11 Nov 2026)
- AfeesHost cPanel 138 on CloudLinux. Node.js up to 24.22.2 and Python App are available.
- Limits: 1 GB RAM, 20 entry processes, 100 processes, 5 GB disk, 5 MySQL databases, 5 subdomains.
- Tools available: SSH, Git Version Control, cron and JetBackup. There is no browser Terminal.
- What that means: cPanel runs the backend, the three web apps and MySQL. It can't run Chromium or AI models, so those run on separate free services.

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
- Live checks: WebSockets through the proxy, persistent process behaviour, and outbound HTTPS to AI APIs.
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
- The Colon benchmark: Nigerian everyday questions, WAEC, JAMB and university study, coding, reasoning, and tool use, plus Pidgin, Yorùbá, Hausa and Igbo sets.
- Test the free candidates (Qwen, Gemma 4, GLM, DeepSeek and newer ones) on accuracy, speed, language quality and cost. The winner becomes Saga's default.
- Specialist routing, where a model clearly beats Saga on a task, such as code or a particular language.
- Integrate Nigerian language models (for example N-ATLaS) where their licences allow.
- Web search with cited sources for Research mode.
- Study mode: step-by-step explanations, quizzes, flashcards and past-question practice.
- Developer mode: code explain, fix, generate, and a project-files context.
- Safety layer: harmful-content filtering and prompt-injection guards.
**Release standard:** Saga's default is chosen by benchmark score, not popularity, and every model change is re-benchmarked first.

## Phase 6 — Voice
- Voice input built in-house: recording UI, noise handling, language picker, and transcription through the best free Nigerian-capable STT (NaijaVox, Eko STT, Whisper-class).
- Spoken replies (TTS) with Nigerian-accented voices where available.
- Hands-free voice conversation mode.
**Release standard:** accuracy is tested on Nigerian English, Pidgin, Yorùbá, Hausa and Igbo samples, and it works on low-end Android phones.

## Phase 7 — Colon Browser (standalone)
- Browser UI: address and search bar, back, forward, refresh, home, tabs, history, bookmarks, downloads, full-screen, and file upload.
- Browser engine service: real Chromium (Playwright) on a separate free server (for example Oracle Cloud Always Free), not on cPanel. Pages stream to the UI, and taps and typing go back to it.
- Isolated, encrypted profile per user (cookies and storage). No session is ever shared between users.
- Session manager in the backend: active sessions, tabs, URLs, history and control owner.
- A lightweight reader/proxy mode as fallback when the engine is busy.
**Release standard:** major sites (Google, YouTube, banks' public pages, news, social) load and work, and sessions survive reloads.

## Phase 8 — Saga browser automation
- Controlled tool set: openUrl, getPageContent, getLinks, click, fill, scroll, screenshot, back, forward, refresh, tabs.
- Action, then observation, then decision loop with step limits and timeouts.
- Saga explains each step and cites the pages it used.
- Web pages are treated as untrusted content and can't instruct Saga.
- Required approval before payments, purchases, form submissions, sending messages or sharing personal data.
- Every action is logged and replayable for the user and admins.
**Release standard:** a test suite of multi-step tasks passes, injection attacks fail, and approvals can't be bypassed.

## Phase 9 — Browser inside chat & control modes
- The browser appears automatically in the conversation when Saga browses.
- Embedded layout (expandable) and split-screen layout: stacked with a resizable divider on mobile, side by side on desktop.
- Switching layouts never restarts or loses the session.
- Control modes: **AI, Manual, Shared**, with Take control and Return to AI buttons, plus a live AI activity indicator. Pending AI actions pause the instant the user takes over.
- Open a page in Colon Browser, then ask Saga about it in Colon AI. Both use the same session.
**Release standard:** mode and layout switching are tested on Android and desktop with no lost state.

## Phase 10 — Android app
- Android app wrapping the web apps (WebView), built in the cloud with GitHub Actions, with no Android Studio or PC needed.
- Native extras: microphone and file permissions, share-to-Colon, push notifications, and the splash with the logo animation.
- Signed APK/AAB, Play Store listing, and in-app update prompt.
**Release standard:** tested on low, mid and high-end Android devices, passes Play policy review, and has a crash-free rate above 99%.

## Phase 11 — Launch readiness
- Plans and billing: free tier plus paid plans through a Nigerian gateway (Paystack or AfrStar), with limits enforced per plan.
- Public landing page, SEO, help centre and FAQ, and contact and support inbox.
- Monitoring and alerts (uptime, errors, provider quota), status page, and performance tuning for slow networks.
- Security review, load test to the hosting limits, backup restore drill, and NDPR-compliant privacy.
**Release standard:** the launch checklist is all green, and restore from backup has been proven.

## Phase 12 — Growth & own intelligence (ongoing)
- Collect consented feedback data, then clean it into African datasets.
- LoRA/QLoRA fine-tune Saga on rented GPU only when the data and usage justify it, re-benchmarked against the current default.
- Move inference to dedicated GPU when free providers can't carry the load.
- Regular model refresh: any better free model is evaluated, never adopted on hype.

---

## Standing rules
- Free technology first. Paid services only when genuinely necessary, with alternatives explained.
- Everything can be done from an Android phone, through GitHub and cPanel.
- The browser is one reusable module shared by Colon AI and Colon Browser, never duplicated.
- No phase is "done" because it looks done. It is done when it meets its release standard.
