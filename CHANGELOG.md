# Changelog

## [0.9.1] — 2026-11-13 · The browser panel inside the conversation
On phones, Colon AI's browser panel now shows inside the chat thread, where the web's "Colon Browser" card sits,
instead of being pinned above the chat header. Every version number moves to 0.9.1 (apps, `Colon.version`,
`version.json` for both APKs, versionCode 901).
### Added
- **Layout `inline`** for the in-chat browser panel (Android, `PanelLayout.Mode.INLINE`), the default on phones
  (wide screens still open split). The chat draws the card (status dot, "Colon Browser", the address, collapse,
  full screen, close) and an empty body box (60vh, at least 320 px); the app lays the panel's WebView over that
  box, clipped to the visible thread so it never covers the chat header or the composer, and hides it when the card
  is scrolled away or collapsed. Scrolling only translates the panel (no relayout); the same WebView is kept when
  switching to embedded, split or full screen and back, so nothing reloads. "In the conversation" in the panel
  menu (full screen) switches back. Saga opening the panel when it asks to browse opens it inline too.
- **Bridge:** `browser('anchor', { visible, x, y, width, height, viewportTop, viewportBottom, dpr })` (the card's
  body box in CSS px; sent on open, scroll, resize and keyboard, at most once a frame and only when it changed),
  `inline: true` on any `browser(...)` call (the page draws the card), `layout: 'inline'` in the panel state and
  the `layout` action, feature `browserInline` (docs/android-bridge.md).
- **Chat:** `lib/native-anchor.js` (measures and reports the box; keeps the card on screen when the keyboard opens
  for the panel's page) and the card in `.cw-native-host`; tests in `packages/ui/test/native-anchor.test.js`.
  Kotlin: `InlineGeometry` (CSS px -> device px and the clip, `InlineGeometryTest`), `InlineLayer`.
### Changed
- The panel's saved layout moved to a new preference key (`layout`), so phones start in the conversation once
  after the update; a layout picked from then on is remembered.
### Compatibility
- An older chat page in the new app never sends `inline: true`, so the panel stays embedded above the chat as in
  0.9.0 (`state.layout` reports what is shown). The new chat page in an older app (no `browserInline`) keeps the
  0.9.0 behaviour. When the chat page reloads, an inline panel waits hidden up to 4 s for the new page.

## [0.9.0] — 2026-11-13 · Phase 9: Saga browser automation
Saga browses for the user on their phone: it drives the Colon AI browser panel (a real WebView with the user's own
cookies) through the WebSocket bridge, explains every step, cites the pages it read, and waits for the user's tap
before anything risky. Every version number moves to 0.9.0 (apps, `Colon.version`, `version.json` for both APKs).
### Added
- **Saga module** (`services/api/src/modules/saga`, ADR 0005): a decision -> action -> observation loop over the
  existing model router (one JSON action per step, the usual model deviations repaired), the controlled tool set
  `openUrl, getPageContent, getLinks, click, fill, scroll, screenshot, back, forward, refresh, tabs, finish` with
  arguments rebuilt from per-tool allow-lists, blocked hosts refused, element ids only from the latest page read.
  Limits: `SAGA_MAX_STEPS`, `SAGA_TASK_TIMEOUT_MS`, `SAGA_MODEL_TIMEOUT_MS`, `SAGA_STEP_TIMEOUT_MS`,
  `SAGA_APPROVAL_TIMEOUT_MS`; Take control, Pause, Stop or a dropped socket end a task at once.
- **Untrusted pages:** page text, titles, element labels, links and tab titles are neutralised by the safety
  layer's injection guard and fenced with random-id markers; flags are recorded as safety events (route `saga`).
- **Approvals tapped on the phone** for payments, purchases, form submissions, sending messages and personal data:
  the server's policy (`policy.js`) and the phone's check of the real element (`assets/saga/tools.js`) both count,
  the stronger wins; the model can't pre-approve; an `ok` answer without the user's approval stops the task
  (`approval_missing`); a decline is respected. Shared mode asks before every changing step.
- **Action log and replay:** migration `0009_saga_tasks.sql` (`saga_tasks`, `saga_actions`; typed personal data
  hidden, page text never stored), audit entries `saga.task_created` / `saga.task_finished` /
  `admin.saga_replay_viewed`. REST: `POST /browser/agent`, `GET /browser/agent`, `GET /browser/agent/:id?after=`,
  `POST /browser/agent/:id/stop`; admin: `GET /admin/saga/tasks`, `GET /admin/saga/tasks/:id`. Admin › Browser
  lists tasks with a step-by-step replay (it was a placeholder).
- **Bridge:** `command(name, args, tab, { timeoutMs })`, `waitControl()`, `hasControl()`, the phone's
  `capabilities` kept from `hello` (`supports()`); tasks are queued in MySQL and claimed by the worker that holds
  the phone's socket (`ws/index.js` starts the sweep); unclaimed tasks fail with `no_phone` after a minute.
- **Android (both apps):** `get_page_content`, `get_links`, `click`, `fill`, `scroll`, `screenshot` (`SagaTools`,
  `BrowserSaga`), advertised in `hello.capabilities`; the "Approve Saga's next step?" dialog; Allow on "Let Saga
  browse?" always answers `consent`. Colon AI opens its browser panel by itself when Saga asks to browse (Phase 10).
- **Chat:** AI Browse in the Android app (`Colon.native.hasPanel()`) runs on the native panel through Saga
  (`apps/chat/src/actions/saga-native.js`): the panel opens at once, each step's explanation is shown, and the
  answer with "How Saga browsed" and its cited pages is added to the chat. The web reader's AI Browse stays for the
  web, guests, older apps and servers without Saga.
- Config: the seven `SAGA_*` keys (`config/api.env.example`, `config/README.md`).
- Tests (30): `tests/unit/saga-loop.test.js`, `tests/unit/saga-runner.test.js`, `tests/security/
  saga-approval.test.js`, `tests/security/saga-injection.test.js`, `tests/security/saga-phone-tools.test.js`;
  Kotlin `SagaPhase9Test.kt` (runs in the Android CI).
### Not yet
- The Phase 9 release standard on real phones (multi-step tasks on real sites, injection pages, approvals); the
  Kotlin changes were written without a local Android build.
- Screenshots are not given to the model; no push to wake a phone whose app is closed; `page_state` not stored.

## [0.8.1] — 2026-11-13 · Phase 8 server pieces: reader and session manager
The two server pieces Phase 8 left open, built to `docs/phase8-backend-contract.md`. API only: the web clients
already call these endpoints, so no client change was needed. (Version numbers in `package.json` and the apps stay
at 0.8.0 until the release is cut.)
### Added
- **Server reader `GET /browser/fetch`** (`services/api/src/modules/browser`): reads one public page on the server
  for web light mode. SSRF guard: http/https on ports 80/443 only, DNS resolved on the server and every address
  checked (private, loopback, link-local, CGNAT, multicast, IPv6 ULA/link-local, cloud metadata), the socket pinned
  to the checked address, every redirect checked again (at most 5). 10 s, 2 MB, HTML and plain text only, no
  cookies or auth headers, `ColonReader/1.0` user agent. Regex sanitiser with the client's tag allow-list
  (scripts, styles, frames, forms, media, nav/aside and every `on*` attribute removed; links and images made
  absolute; small `data:image` only), plus title, byline, lang and text (≤ 200 000 characters). `robots.txt`
  honoured; host block list in the safety layer (`modules/safety/hosts.js`: adult and malware hosts plus
  `BROWSER_READER_BLOCKLIST`). Contract error codes (`bad_url`, `blocked_private`, `too_large`, `not_html`,
  `needs_login`, `rate_limited` with `retry_after`, `upstream_error` with `upstream_status`, `timeout`,
  `not_enabled`). 30 a minute and 500 a day per user, 60 a minute per IP for guests. 10-minute cache, shared
  between users only when the site sent no cookie and allows shared caching. Logs only user id, host, status,
  bytes and time.
- **Browser session manager**: migration `0008_browser_sessions.sql` (`browser_devices`, `browser_sessions`,
  `browser_tabs`, `browser_history`); `GET`/`PUT`/`DELETE /browser/session` per user and device with optimistic
  `version` (`409 conflict` with the current session), `GET /browser/sessions`, and opt-in `/browser/history`.
  Private tabs are never stored, URLs over 2048 characters are dropped, at most 30 tabs, idle sessions deleted
  after 30 days.
- **WebSocket bridge** (`ws/index.js`, `modules/browser/bridge.js`): sockets are tied to the signed-in user (the
  `colon_sid` cookie); `hello` with `app` registers the device and is answered with `bridge: 1, session: 1`;
  `session_sync` (one write per 2 s, latest wins; 64 KB frames; 10 tabs on low-RAM phones) and `session_request`
  (answered by `ack`); control owner rules (AI/Shared only after consent; Take control, Pause, Stop and Declined win
  at once and cancel pending Saga commands with `manual_control`), every change in the audit log.
- Config: `BROWSER_READER`, `BROWSER_READER_GUESTS`, `BROWSER_READER_BLOCKLIST`. The router gains `PUT` (CORS
  allows it). API errors can carry contract fields beside `error` and `message`.
- Tests: `tests/security/browser-reader.test.js`, `tests/unit/browser-html.test.js`,
  `tests/unit/browser-session.test.js`, `tests/unit/browser-bridge.test.js` (29 tests).
### Not yet
- Saga routing on the bridge (choosing a phone, sending commands, per-command rate limits) is Phase 9; the bridge
  already exposes `command`, `askControl` and `requestSession` for it.
- The "Sync my tabs with Colon" setting on the phones; `page_state` is not stored yet.

## [0.8.0] — 2026-11-13 · Colon Browser becomes its own app (Phase 8, client side)
Two Android apps from one project: **Colon AI** (chat, with a real browser panel beside it) and **Colon Browser**
(the full standalone browser). Web light mode gets its "open in the app" prompt and a server-reader adapter. The
server pieces of Phase 8 are not built yet; their contract is `docs/phase8-backend-contract.md`. Decision:
`docs/decisions/0004-two-android-apps.md`.
### Added
- **Two APKs, one Gradle project** (`apps/android`): product flavors `colonai` (`ng.nifelux.colonai`) and
  `colonbrowser` (`ng.nifelux.colonbrowser`), all code shared in `src/main`; per-flavor manifests, name, launcher
  icon (a cyan globe around the flame for Colon Browser), splash and update texts. versionCode 800.
- **Colon AI: in-chat browser panel** (`ChatBrowserPanel`, `PanelLayout`): pages from the chat open in a native
  WebView beside the chat instead of a separate screen. Embedded (collapsible), split (draggable divider; side by
  side on wide landscape screens) and full screen, switched without reloading. Address bar, back, forward,
  reload/stop, tabs (6), desktop site, share, downloads list, clear data, close; **Open in Colon Browser** (or its
  download page when not installed). Saga's AI / Manual / Shared control, consent and shield work in the panel.
  Bridge: `ColonNative.browser(action, …)` and the `browser` event (`docs/android-bridge.md`); the chat's Browser
  button and links drive it (`apps/chat/src/components/browser-panel.js`). On the web the reader panel stays.
- **Colon Browser app** (`BrowserActivity`, `BrowserMenu`): opens straight into the browser; **private tabs**
  (violet bar, no history or cache, never saved or seen by Saga, own cookies and storage in a throwaway WebView
  profile deleted when the last one closes; an honest warning on WebViews without profiles), **tabs and history
  that survive restarts** (`TabSnapshot`, saved as they change), **clear browsing data screen**
  (`ClearDataActivity`: history, cookies, cache, site storage, downloads list; Colon AI sign-in kept), **downloads
  list**, **desktop site** per tab, full-screen video (shared `Fullscreen`), web searches from other apps, "Ask
  Colon AI about this page" and "Open Colon AI" handoffs (`Handoff`).
- **Google and bank sign-in in a Chrome Custom Tab** (`SignInTabs`, `androidx.browser` 1.8.0):
  `accounts.google.com`, `accounts.youtube.com` and the internet-banking hosts of GTBank, Access, Zenith, UBA and
  First Bank (`UrlRules.CUSTOM_TAB_HOSTS`, extendable with `-Pcolon.customTabHosts=`); the tab reloads on return.
- **Per-app updates:** `version.json` gains a `browser` entry; each app reads only its own entry and accepts only
  an APK named for itself (`VersionManifest.forApp`). The top-level fields are unchanged, so v0.7.x keeps updating.
- **CI** (`.github/workflows/android.yml`): tests and lint for both flavors; builds, signs (same key) and
  publishes `colon-ai-<v>.apk`, `colon-ai.apk`, `colon-browser-<v>.apk`, `colon-browser.apk` and a `.sha256` for each.
- **Web light mode** (`packages/ui/js/browser/app-prompt.js`, `reader-proxy.js`): "Light mode … Open in the app for
  full browsing" above reader pages and the new tab page (Colon Browser's APK on Android, the release page
  elsewhere), a stronger prompt on sites that need the full browser; a server-reader adapter for
  `GET /browser/fetch` with graceful fallback, and a labelled **Preview** mock (`localStorage['colon.reader'] =
  'mock'`). Settings › App and Help list both apps; Colon Browser web Help explains light mode.
- Docs: `docs/phase8-backend-contract.md` (reader proxy, session manager REST and WebSocket messages, control
  owner rules), ADR 0004, `apps/android/README.md` rewritten for two apps.
- Tests: `BrowserPhase8Test.kt` (20 JVM tests: tab persistence, private-tab rules, Custom Tab hosts, desktop user
  agent, panel layouts, clear-data rules, downloads list, per-app update manifest, handoff), run for both flavors;
  `packages/ui/test/light-mode.test.js` (7); `scripts/deploy/android-version.test.js` checks both apps.
### Changed
- The browser engine is one module for both screens: `BrowserHost` (implemented by `BrowserActivity` and
  `ChatBrowserPanel`), `BrowserWeb`, `BrowserSaga`, `TabManager`. Saga can't read or drive private tabs
  (`private_tab` error; left out of `get_tabs` and `page_state`).
- Colon AI no longer contains a standalone browser screen; `openTab` and links open the in-chat panel.
### Not yet (stubbed)
- **Server-side reader** (`GET /browser/fetch`) and the **browser session manager** (tabs, URLs, history and control
  owner per user and device): not in `services/api`; clients fall back (contract in
  `docs/phase8-backend-contract.md`).
- Saga driving the native panel (Phase 9): the chat's AI Browse still runs in the web reader panel.
- Real-device testing of both apps (private tabs on old WebViews, Custom Tab round trips, split divider), push
  notifications, App Links, crash reporting.

## [0.7.1] — 2026-11-13 · Android app (Phase 7 begins)
Colon AI in a native Android shell, with Colon Browser built on Android System WebView. Built in the cloud by GitHub
Actions. Details: `apps/android/README.md`, `docs/android-bridge.md`.
### Added
- **Android app** (`apps/android`, `ng.nifelux.colonai`, Android 7.0+ / minSdk 24, targets API 36, about 2 MB
  shrunk with R8): loads `chat.apparatus.name.ng` with file picker, microphone, back button, offline screen with
  retry, downloads, edge-to-edge insets, system bars that follow the chat theme, and recovery when a low-memory
  phone kills the WebView renderer. Splash (SplashScreen API, backported) and adaptive/themed launcher icons.
  versionCode = major × 10000 + minor × 100 + patch (0.7.1 → 701).
- **Native Colon Browser** (`BrowserActivity`, `TabManager`, `BrowserWeb`): address bar (URL or search), back /
  forward / reload, home page with bookmarks, tabs (10 on low-RAM phones, 30 otherwise) with only 2–5 live WebViews
  (older background tabs are discarded and reload when opened), history and bookmarks on the phone only,
  DownloadManager downloads, full-screen video, uploads, per-site camera/microphone, "Clear browsing data" that
  keeps the Colon AI sign-in. Listed in Android's "Open with" for web links. Saga control indicator (AI / Manual /
  Shared) with Take control, Return to AI, Pause, Stop and a consent prompt.
- **`window.ColonNative` bridge** (`NativeBridge.kt`): origin-restricted to Colon's own pages (WebView
  `addWebMessageListener` / document-start script, with a checked fallback on old WebViews): `info`, `openTab`,
  `share`, `download`, `saveFile`, `haptic`, `requestPermission`, `checkUpdate`, `setTheme`, `setSession`,
  `takeShare`, `bridgeStatus`, plus `share` / `bridge` / `resume` events. User agent ends with `ColonAndroid/<ver>`.
- **Backend bridge client** (`BridgeClient`, `BridgeProtocol`, `Backoff`): WebSocket to `wss://api.apparatus.name.ng/ws`
  with reconnect backoff, heartbeats and network awareness; protocol in `docs/android-bridge.md`.
- **Share to Colon** (`ShareReceiverActivity`, `ShareIntake`): text, links or up to 5 images from any app land in
  the message box and upload tray.
- **In-app updates** (`UpdateChecker`, `VersionManifest`): reads `apps/chat/public/android/version.json` every
  12 hours; downloads the APK, checks package, version and signing key, then opens Android's installer.
- **CI:** `.github/workflows/android.yml` (unit tests, lint, release APK artifact; "Publish a release" or a `v*` tag
  creates the GitHub Release with `colon-ai-<version>.apk`, `.sha256` and `colon-ai.apk`; tag must match
  `package.json`). `.github/workflows/android-keystore.yml` creates the release signing key into repository secrets
  from a phone (modes `create` / `backup`, optional encrypted backup artifact).
- **Web native-shell integration:** `Colon.native` (`packages/ui/js/colon/native.js`) detects the app and sets
  `html[data-shell="android"]`; `apps/chat/src/lib/native-shell.js` syncs theme and session and drops shared content
  into the composer; links and "Open browser" open native tabs (AI Browse stays in the panel); blob exports save
  through the app; voice uses Colon speech in the app. Settings › App and Help show a "Get the Android app" row on
  the web (APK on GitHub Releases) and the installed version with "Check for updates" inside the app
  (`apps/chat/src/components/app-row.js`); Colon Browser web Help has the same row.
- **Polish** (`packages/ui/css/polish.css`): Android shell safe-area handling, no long-press callouts on controls,
  and refined states, spacing and motion of existing components (no layout changes).
- Tests: 17 JVM unit tests (`LogicTest.kt`, `UrlRulesTest.kt`), `packages/ui/test/native.test.js` (6),
  `scripts/deploy/android-version.test.js` (2).
### Fixed
- **Settings opened scrolled to the bottom** on phones (scrollTop ≈ 3450 at 360 px): hiding the composer on a page
  resized it, and the "follow the latest message" handler pulled the shared scroll area down. Pages now always open
  at the top; returning to a conversation still opens at the latest message.
### Not yet (stubbed)
- **Push notifications (FCM):** channels and the Android 13 permission only; needs a Firebase project.
- **Backend bridge server:** today's API only says hello on `/ws`; no Saga commands yet (the app shows this and
  keeps working).
- Native SpeechRecognizer dictation, Google sign-in inside the app (Custom Tab), App Links (`assetlinks.json`),
  crash reporting, and testing on real low/mid/high-end phones.

## [0.6.5] — 2026-11-13 · Hands-free conversation
### Added
- **Hands-free mode** (`apps/chat/src/lib/hands-free.js`): pick "Hands-free conversation" at the bottom of the mic's
  language list. Colon listens, sends when you stop talking, reads the reply aloud, then listens again. A
  "Hands-free" pill above the composer shows Listening / thinking / speaking with an End button; Cancel on the
  recording bar or tapping the mic also ends it. Two turns in a row with no speech end the session.
- End of a turn: 1.6 s without new words (English dictation) or 1.5 s below speech level on the microphone (Colon
  speech for Naijá, Yorùbá, Hausa, Igbo); 9 s of nothing counts as a miss. `ChatMedia` gained `onLevel`, and a
  failed or empty Colon transcription now reports an empty final transcript so the loop can move on.
- Tests: `packages/ui/test/hands-free.test.js` (3).

## [0.6.4] — 2026-11-13 · Done button fix
### Fixed
- **Tapping Done could leave the mic stuck** on Android: if Done landed between two dictation restarts, Chrome had
  no session to end and never fired `onend`, so the bar stayed open and nothing reached the message box. Done now
  finishes with the words so far if `onend` hasn't arrived within a second.

## [0.6.3] — 2026-11-13 · Dictation text fix
### Fixed
- **Spoken words appeared several times** in the message box on Android ("hi hi how hi how are you…"): Chrome
  repeats earlier words inside each new result. The dictation text is now rebuilt from the results each time, and a
  result that already holds the text so far replaces it rather than being added.

## [0.6.2] — 2026-11-13 · Voice fix
### Fixed
- **English dictation stopped after about 5 seconds** on Android: Chrome ends a speech session at the first short
  pause even with `continuous` on. The mic now restarts the session quietly and keeps the words heard so far until
  you tap Done (5-minute cap). A pause with no speech no longer ends the recording. The bar says "tap Done when you
  finish" for dictation too.

## [0.6.1] — 2026-11-13 · Spoken replies
### Added
- **Read aloud in Nigerian voices:** `POST /voice/speak` (`{ text, lang, speaker }` → MP3, ≤ 900 characters) with
  Naija Speech voices for Yorùbá, Hausa, Igbo and Nigerian English (female/male per language); the language is
  detected from the reply. Markdown, code, links and emoji are not read. Last 40 chunks cached in memory.
  Limits: 300 chunks an hour signed in, 60 for guests, and at most `VOICE_TTS_PER_MINUTE` (default 7) a minute for
  the whole app, since the key allows 10 requests a minute in total. Logs `tts_ok` / `tts_failed`.
- **Client** (`apps/chat/src/lib/read-aloud.js`): plays a reply chunk by chunk (≈120 characters first, then ≤ 300),
  fetching the next chunk while one plays; falls back to the phone's voice when Colon voices are off, busy or
  offline. Settings › Voice: read-aloud voice (Automatic / Colon / phone) and Colon voice (female / male).
- **Language first:** tapping the mic opens a small list (English, Naijá, Yorùbá, Hausa, Igbo, Mixed) above it;
  picking one remembers it and starts recording. The recording bar shows the language and no longer has a picker.
### Changed
- Read-aloud "Automatic" uses Colon voices for Yorùbá, Hausa and Igbo replies and the phone's voice for English and
  Naijá: Naija Speech generates slower than real time (measured 9–18 s for 70–130 characters, one request at a time),
  which is fine where no phone voice exists but slower than the phone for English.

## [0.6.0] — 2026-11-13 · Voice input (Phase 6 begins)
Speak to Colon in English, Naijá, Yorùbá, Hausa or Igbo; the words land in the message box to check before sending.
Details: `docs/phases/phase-6-voice.md`.
### Added
- **Voice module** (`services/api/src/modules/voice`): `POST /voice/transcribe` (multipart `file` + `lang`,
  12 MB / 5 minutes) and `GET /voice/status`. Signed-in users 60 recordings an hour; guests 20 an hour per IP (own
  origins only, follows the guest-chat switch). Logs `voice_ok` / `voice_failed` with provider, language and time.
- **Providers:** Naija Speech API (free; NCAIR / N-ATLaS ASR models) leads for Hausa, Igbo, Yorùbá and Nigerian
  English; a Gemini model (`VOICE_GEMINI_MODEL`, default `gemini-3.5-flash-lite`, on `GEMINI_API_KEY`) handles Pidgin
  and "Mixed" and is the fallback. Recordings are never stored.
- **Composer:** "Colon speech" voice method. The recording bar has a language picker (remembered in Settings), a
  level meter and a "Transcribing…" state; a failed transcription falls back to a voice note (signed in).
  Recording is mono with noise suppression at 24 kbps Opus, about 180 KB a minute on slow networks.
- New env: `VOICE`, `NAIJA_SPEECH_API_KEY`, `NAIJA_SPEECH_BASE_URL`, `VOICE_GEMINI_MODEL`, `VOICE_MAX_SECONDS`.
- Settings › Voice: Naijá and "Mixed / not sure" languages, model attribution (required by the NCAIR licence).
### Changed
- Voice method "Automatic": English uses the browser's live dictation when it has it; every other language uses
  Colon speech.

## [0.5.11] — 2026-11-13 · N-ATLaS and Phase 5 complete
Closes Phase 5 (Intelligence & evaluation).
### Added
- **N-ATLaS on Langa**: the `natlas` provider defaults to `https://langa.julimer.com/v1` (model `n-atlas`); it turns on
  only when `NATLAS_API_KEY` is set and stays third in the African-language chain. New env `NATLAS_MAX_TOKENS`
  (default 2048): a provider-level output cap (`client.capTokens`), so Developer mode's 8192 never reaches the host.
- Small N-ATLaS bench `bench/results/natlas-2026-11-13` (Hausa, Igbo, Yorùbá, 2 items each): 3/6, ~0.9 s first token
  (Gemma 4 26B: 4/6 on the same items). Not enabled in production: Langa's free plan is 12,500 tokens/month.
- Benchmark 2026-11-12 complete (Mistral Large 4 with `reasoning_effort: 'low'`; `'none'` answers 400).
### Changed
- Built-in specialist table: Everyday no longer goes to MiniMax; after the complete rerun Gemma 4 26B leads every
  category (MiniMax still last for Yorùbá, Hausa, Igbo).
### Fixed
- Two stale unit tests (Mistral body, specialist table) that failed after the benchmark rerun.
- Version 0.5.11 everywhere.

## [0.5.10] — 2026-11-13 · Specialist routing
Phase 5 specialist routing: where a model clearly beats Saga's default on a kind of request, it leads the chain for
those requests. Details: `docs/phases/phase-5-specialist-routing.md`.
### Added
- **Task classifier** (`ai/classify.js`, rule-based, no model call): category = the African reply language (Naijá,
  Yorùbá, Hausa, Igbo; reuses `prompts.detectLanguage`), else code / reasoning / exam / research / everyday from the
  mode, the message and attachment names.
- **Specialist derivation** (`ai/specialists.js`, pure): from the newest imported benchmark, per category; a model
  leads only when complete in the benchmark and ≥5 points better than the default plus 0.5 point per second of
  slower first token, with a median first token ≤15 s. Complete models under 70 in a category, and MiniMax for
  Yorùbá/Hausa/Igbo, go last. Built-in table (bench 2026-11-12) when no benchmark is imported. Re-derived on import.
- From bench 2026-11-12: Everyday → MiniMax M3.1 Flash; every other category keeps Gemma 4 26B; MiniMax goes last
  for Yorùbá, Hausa and Igbo (Gemma 4 31B wins Hausa on score but is ~18 s to first token, so it stays second).
- **Admin › Routing**: Specialist routing card (per-category head, reason, demoted models, rule, source) and an
  On/Off switch saved with the routing setting; `GET /admin/routing` returns `specialists`, `PATCH` accepts
  `specialists: true|false`. New optional env **`AI_SPECIALIST_ROUTING`** (on|off, default on) when the switch was
  never saved.
- **Admin › Evaluation › Import benchmark** button (posts a `bench/results/<run>.eval.json` to
  `POST /admin/evaluation/bench`).
- `ai_reply_ok` in stderr.log carries `route=specialist:<category>` / `default:<category>` / `default`.
- Tests (11 new): classifier, derivation (margin, latency, incomplete exclusion, demotion, no-eval fallback, static
  table = committed bench), chain reordering, hedge waves, settings switch, import time parsing; integration with
  the mock provider and the admin routing handlers.
### Changed
- Specialists only reorder the head of the chain (and push weak models last); fallback, resting and hedging are
  unchanged, except that a hedged wave no longer pulls a demoted model forward to mix providers.
- Benchmark import accepts the report's local "finished" time (`Thu 2026-11-12 1:52 PM WAT (UTC+01:00)`), so the
  committed 2026-11-12 file imports as is; importing or deleting a run clears the routing cache.
- The routing loader reads the newest benchmark rows from `eval_runs` (one extra query per 30 s per worker).
- Version 0.5.10 everywhere.
### Not changed
- No migration, no new route, no new dependency; the configured routing order is the fallback order.

## [0.5.9] — 2026-11-13 · Developer mode
Phase 5 Developer mode: code explain, fix, generate and review, and a project-files context. Details:
`docs/phases/phase-5-developer.md`.
### Added
- **Developer prompt** (`ai/prompts.js`): explain (walk-through, complexity, pitfalls); fix (name the bug, root cause,
  corrected code as a minimal diff or the full file, how to test); generate (complete runnable code, file names,
  dependencies, run instructions); review/refactor by severity. Fenced code blocks with language tags; code and
  identifiers in English, prose in the reply language; never invent APIs, say when unsure; secure by default (no
  hard-coded secrets, parameterised SQL, input validation); one clarifying question only when essential; Nigerian
  context (cPanel hosting, Paystack/Flutterwave) when relevant.
- **Larger output for Developer replies**: new optional env `AI_DEVELOPER_MAX_TOKENS` (default 8192; other modes keep
  `AI_MAX_TOKENS`). Routing order unchanged.
- **Project files**: attach code files or a `.zip` of a project (20 MB, kind `doc`, mime `application/zip`; other
  ZIP-based files are still refused; more code extensions accepted). The zip is read once at upload into a snapshot
  (`modules/developer/snapshot.js`): top folder stripped; `node_modules`, `.git`, `vendor`, `dist`, `build` and
  other tool folders counted but not read; binaries, images, minified bundles, lockfiles (size only) and secret
  files (`.env`, keys; `.env.example` is read) listed without contents.
- **Project context** for every Developer reply (`modules/developer/project.js`, `chat/context.js forMode`): code
  files and snapshots from every message in the conversation (follow-ups keep them; a re-attached file replaces
  the old copy), ordered by files named in the message, then entry points/configs, then smallest code first, within
  48,000 characters (12,000 per file, 24,000 for a named file). A header with counts and languages and a file tree
  marking every truncated or omitted file and why; the model is told not to guess missing files. Tree and files are
  untrusted: neutralised by the injection guard and fenced per file with random end markers. Guests get a plain
  rendering from `/chat/guest/extract`.
- **Safe ZIP reader** (`extract/zip.js`), now shared with DOCX/PPTX/XLSX/ODT: path traversal, absolute paths and
  NUL names refuse a project archive (422 `unsafe`); zip bombs refused by declared total (128 MB), ratio (200× for
  entries over 1 MB) and entry count (20,000); every entry inflated with a cap at its declared size.
- **Developer quick actions** in the chat app: Explain, Fix a bug, Generate, Review (prefill a short template) and
  Attach project, shown above the composer in Developer mode only. Help FAQ: "How do I get help with my code?".
- Tests (13 new): prompt contents and output cap; snapshot ignore rules, traversal and zip-bomb refusal; context
  priority, budget, truncation and omission notes, merging, injection fencing; chat context per mode; and an
  integration test with the mock provider (the stored zip reaches the model as context and a follow-up reuses it).
### Changed
- Code blocks never widen a message on phones (`max-width`, horizontal scroll contained); they already had the
  language label and Copy.
- Version 0.5.9 everywhere.
### Not changed
- No migration, no new route, no new dependency; routing order as configured.

## [0.5.8] — 2026-11-13 · CBT: fresh questions every test
### Fixed
- **CBT tests no longer repeat themselves.** The same exam + subject + topic used to send the model the identical
  prompt with no memory of earlier tests and no temperature, and only exact-text duplicates were removed, so tests
  came back nearly the same. Now:
  - **Memory of recent tests** (app, `core/cbt-store.js`): the last 40 question stems (140 characters each) per
    exam + subject + topic are kept in `localStorage` (12 kinds, ~40 KB at most; oldest rotate out; bad JSON is
    ignored) and sent with every new test and Retake as `avoid`.
  - **`POST /study/cbt` accepts `avoid`** (optional; up to 40 strings, one line, 160 characters each, 5000 in total).
    They reach the prompt as quoted data items, never as instructions: "do not repeat or closely paraphrase these;
    if you test the same concept, change the angle, numbers, context and options".
  - **A random focus per request** (`modules/study/variety.js`): a shuffled set of syllabus areas to spread over (at
    least 6; built-in lists for the quick subjects, otherwise a random starting area in the model's own syllabus
    order), or with a topic, at least 6 angles on it; a random mix of question types (recall, application,
    calculation, interpretation, error-spotting) and a random variety token. Temperature 0.9 for CBT generation.
  - **Near-duplicate filter** (`modules/study/similar.js`): stems are compared as token sets (no punctuation or stop
    words, plurals folded; Jaccard ≥ 0.6, or ≥ 0.4 with the same correct option). Different numbers = a new
    question. Applied within the test and against `avoid`. A short first answer is topped up by the second call,
    which also avoids the stems already accepted; still short after two calls, items held back only for resembling
    an earlier test fill the gap (never an in-test duplicate) and `cbt_short` is logged.
- Unit tests for the avoid input, the similarity filter, the focused prompt (fixed rng), temperature and top-up.

## [0.5.7] — 2026-11-13 · Study mode tools
### Added
- **Quizzes** in Study mode: Colon Saga settles the subject and level, asks one WAEC/JAMB-style A–D question at a
  time (5 by default), waits for the answer, marks it with a short explanation and a running score, and ends with the
  score, weak topics and what to revise.
- **Flashcards**: 10 by default, as a Markdown table (#, Front, Back), basic to harder, with an offer to quiz on them.
- **Past-question practice**: never presents a made-up question as a real WAEC, NECO, JAMB or university past
  question; generated ones are labelled "WAEC-style"/"JAMB-style". Pasted past questions are solved step by step,
  with the option letter, marking-scheme-style working for theory, and one similar practice question.
- **CBT practice test** (`#/cbt`, from Explore › Study, "CBT practice" in the menu and the Help FAQ): pick WAEC,
  NECO, JAMB, University or General, a subject (quick chips) and an optional topic, then answer exactly 10 objective
  questions (A–D) in 5:00 for the whole test, laid out like the JAMB CBT: countdown (warning at 1:00, red at 0:30,
  screen-reader announcements), question navigator with flags, keyboard shortcuts (A–D, N/P or arrows, F) and
  Submit with an unanswered count. The test submits itself at 0:00 ("Time up — submitted"); the timer counts to an
  absolute end time kept with the answers in `sessionStorage`, so a refresh resumes with the right time left. The
  results show the score, time used and every question with your answer, the right one and why, plus Retake (new
  questions), New test and "Discuss my mistakes" (a Study chat prefilled with the missed questions). Preview mode
  (no connection) shows a friendly "needs a connection" notice.
- **`POST /study/cbt`** (new `modules/study`, route `http/routes/study.js`): open to guests (when guest chat is on)
  and signed-in users, 5 tests per 10 minutes per IP, counted as one Study-mode reply against the daily limits (given
  back when no test could be made), subject and topic run through the safety input check. The model is asked for
  strict JSON; the reply is repaired (fences, LaTeX backslashes, trailing commas, cut-off items) and every item
  checked (4 distinct options, one answer A–D); numeric answer keys that contradict the explanation's own working are
  corrected, and options are shuffled so the right letter varies. Under 10 valid questions → one retry (questions
  pooled), then a 502 with a friendly message. Unit tests for the parser, prompt, input and handler.
- Help page mentions the Study tools. Unit test for the Study prompt.

## [0.5.6] — 2026-11-13 · Benchmark rerun fixes
Gets the four models that failed or stopped in the first benchmark (`services/api/bench/results/2026-11-12.md`)
ready for a rerun: DeepSeek V4.1 Flash and GLM-5.3 Flash (100 % first-token timeouts on NVIDIA), Nemotron 3.5
Lightning (stopped at 130/135) and Mistral Large 4 (stopped at 42). Root causes and the rerun steps:
`docs/phases/phase-5-benchmark.md`.
### Fixed
- **GLM-5.3 Flash** now sends `reasoning_effort: low` (NVIDIA's default is `max`), in Saga's routing and in the
  benchmark. New optional env `NVIDIA_GLM_REASONING` (`low`, `high`, `max`, or `default`).
- **Nemotron 3.5 Lightning** is benchmarked with `reasoning_budget: 1024` and 4096 max tokens: its reasoning counted
  against 2048 max tokens and 16 replies ended at `finish_reason: length` with no answer.
- **Mistral Large 4** sends `reasoning_effort: none` explicitly. DeepSeek, GLM and Mistral get 180 s to the first
  token (NVIDIA free-tier queueing), Nemotron 120 s.
### Added
- **Resume from checkpoint**: `npm run bench -- --resume [run]` continues a stopped run with the same flags; a
  `<model>.status.json` per model (`running`, `done`, `stopped`, `unreliable`, `failed`); Ctrl-C/SIGTERM marks
  running models `stopped`. Each row carries a settings fingerprint, so answers made with other settings are asked
  again instead of being mixed in. `--reset-unreliable`.
- **Provider-wide limits**: one limiter per provider for all its models (NVIDIA: 30 requests/min, 4 in flight by
  default; `--rpm-nvidia`, `--inflight-nvidia`, `BENCH_RPM_NVIDIA`).
- **Retries**: `Retry-After` is honoured on 429/503, exponential back-off with jitter; 400/401/403/404 are never
  retried, and a wrong key or model id stops that model at once.
- **Clear error reasons** per item: code, HTTP status, where it stalled (`connect` = no response headers, the host is
  queueing; `first_token`; `idle`; `max`), reasoning chunks seen, attempts and time, plus an attempt log. Replies cut
  at the token cap say so. The report lists errors by reason per model.
- `npm run bench -- --probe`: one tiny request per model (headers, first reasoning chunk, first answer, finish
  reason) before a long run.
- The provider client attaches `retryAfterMs` and the stall `phase` to its errors (no change to what users see).
- Tests (10 new, mock provider): retry policy, limiter, stall phases, cut-off replies, fatal stop, per-model options,
  checkpoints, probe, and the CLI stopped with SIGTERM then resumed end to end.
### Changed
- Version 0.5.6 everywhere.
### Not changed
- No route, migration or app screen changed; the 2026-11-12 results are kept as they were.

## [0.5.5] — 2026-11-13 · Safety layer
Phase 5 safety: harmful-content filtering on what users send and what the model streams back, prompt-injection
guards for web pages and uploaded files, and an Admin › Safety view. Rule-based and in process (no model, no new
dependency, ~2 ms per message), with lists in English, Nigerian Pidgin, Yorùbá, Hausa and Igbo. Decision record:
`docs/decisions/0003-safety-layer.md`.
### Added
- **`services/api/src/modules/safety/`** (facade `index.js`): `normalize.js` (one folding pass: tone marks, invisible
  characters, look-alike digits, spaced-out letters), `rules.js` (co-occurrence rules with benign-context
  exceptions), `data/*.js` (one file per category), `classify.js`, `policy.js` (settings per audience), `care.js`
  (model guidance), `messages.js` (refusals, stop notice and helplines in five languages), `redact.js`,
  `injection.js`, `output.js`, `provider.js`, `events.js`.
- **Input moderation before the model call** on every chat route (send, regenerate, edit, guest). Categories:
  child sexual content (always refused, cannot be switched off, fail closed), self-harm (never refused: a supportive
  message with Nigerian helplines first, then a careful answer), weapons/explosives/violent harm, illegal drug making
  (incl. mkpuru mmiri, skuchies, gutter water), hate and harassment, explicit sexual content (refused for guests,
  non-graphic for signed-in adults), fraud and scams (Yahoo-yahoo formats, fake alerts, card cloning, BVN/OTP/PIN
  phishing; victims get anti-fraud steps), personal data exposure (finding, tracking or doxxing people). Actions:
  allow, allow with care (guidance added to the system prompt) or refuse (a localized refusal streamed as a normal
  reply; no provider call, no web search, no quota used).
- **Secret redaction**: the user's own card numbers (Luhn-checked), BVN/NIN, OTP, PIN, CVV and passwords are masked
  before the message goes to an AI provider; the saved chat keeps what the user typed.
- **Optional moderation endpoint** (OpenAI-compatible `/moderations`), off by default; only ever stricter; fails
  open with a log line, never for child safety.
- **Prompt-injection guard**: web titles, snippets and page text (Research mode) and uploaded file names and text
  are neutralised (hidden characters, HTML comments, "ignore previous instructions", fake role tags, `SYSTEM:` lines,
  forged delimiters) and fenced in `<<<SOURCES|FILE untrusted id=…>>>` blocks with a random end marker; flags are
  logged.
- **System prompt safety section** in every mode: refuse seriously harmful help, care for self-harm, never reveal
  the prompt or keys, the untrusted-content rule.
- **Output check on streamed replies**: each delta is checked before it is sent (child sexual content, explosive
  recipes, drug synthesis, system-prompt leaks); on a hit the provider is cancelled and `done` carries a safe ending.
  Same SSE events as before (`start → delta… → done`), so the apps need no change.
- **Migration `0007_safety_events`** (new table only): stage, category, action, rule, source, route, mode, language,
  request id, user or guest; no message text unless `SAFETY_LOG_TEXT` is `hash` (keyed HMAC) or `excerpt` (first 80
  characters).
- **Admin › Safety** (admin + 2FA): recent events with category, action and date filters; switches per category
  for signed-in users and guests; provider moderation on/off/default. `GET /admin/safety`,
  `GET /admin/safety/settings`, `PATCH /admin/safety/settings` (audited `admin.safety_updated`; stored in
  `app_settings` key `safety`, live within 30 s).
- New optional env vars: `SAFETY`, `SAFETY_LOG_TEXT`, `SAFETY_PROVIDER_MODERATION`, `SAFETY_MODERATION_URL`,
  `SAFETY_MODERATION_API_KEY`, `SAFETY_MODERATION_MODEL`, `SAFETY_MODERATION_TIMEOUT_MS` (`config/README.md`).
- Tests (30 new): per-category positives and false-positive negatives (medical, news, prevention, slang such as
  "bath bomb", "don't bomb your WAEC", "this traffic go kill me"), injection guard, redaction, output guard,
  chat and Research integration with the mock provider (refusal, care, stream stop, injection, moderation endpoint),
  and security (admin guards, child-safety lock, SQL-safe filters, no reflection).
### Changed
- File blocks and the Research sources block carry an `untrusted id=…` marker; the user's name in the system prompt
  can't add lines.
- `scripts/dev/headless-check.js` also opens Admin › Safety.
- Version 0.5.5 everywhere.
### Not changed
- No route removed or reordered (3 admin routes added); no change to the chat or browser apps.

## [0.5.4] — 2026-11-12 · Restructure: company-grade layout
The repository is reorganised so each part has one obvious place and the rules are checked by CI. Same routes
(97, identical order), same API behaviour and same screens; the only visible differences are the URL changes below.
### Changed
- **API layers** (`services/api/src`): `http/` (server, middleware, router, routes), `ws/`, `modules/` (account, admin,
  ai, auth, bench, chat, extract, health, search), `shared/`, `db/`, `config/`. Dependencies point one way:
  http/ws → modules → shared/db/config.
- **Thin routes**: `http/routes/{health,auth,account,admin,chat}/` only wire paths to guards, rate limits and handlers;
  handlers live in `modules/*/handlers/`.
- **Module facades**: every module has an `index.js`; other code imports a module only through it.
- **One file per provider**: AI providers in `modules/ai/providers/` (hedged racing in `hedge.js`), web search
  providers in `modules/search/providers/`; text extraction split by file type (`sniff`, `image`, `docx`, `pdf`,
  `text`).
- **Tests split**: `services/api/tests/{unit,integration,security,e2e,helpers,fixtures}` (same 87 tests).
- **Config validated at boot**: one schema (`src/config/defaults.js`); production refuses to start without
  `DB_USER`/`DB_NAME`, and any non-numeric value in a numeric variable (or a malformed URL) stops the API with a
  message listing every problem. `.env.example` → `config/api.env.example`, every variable documented in
  `config/README.md`.
- **Request ids**: every response has an `X-Request-Id` header and every log line for that request carries `req_id`.
- **e2e** scripts fixed for Gemma-first routing (`config/e2e.env.example`, mock provider in every slot).
- **Frontend**: classic scripts → ES modules, split into `core/`, `pages/`, `components/` and `actions/` per app;
  the UI kit into `packages/ui/js/{colon,markdown,browser}/` behind its entry files; CSS split per concern
  (`packages/ui/css/*`, `apps/*/public/assets/css/*`); fonts in `packages/ui/fonts`, brand in `packages/brand`.
  `window.Colon` and the other globals keep their keys. The version shown in Help and Settings now comes from
  `Colon.version`.
- **Versioned deploy**: `scripts/deploy/build-docroot.sh` (run by `.cpanel.yml`) puts each release's modules under
  `/v<version>/` and copies `index.html` last; `.htaccess` is never written.
- **`scripts/check.js`** enforces syntax, ≤300 lines per file, ≤120 characters per line, API layer rules, app import
  rules, one version everywhere, and `config/api.env.example` matching the config schema.
- **Docs**: `docs/adr` → `docs/decisions`, phase notes → `docs/phases`; `docs/architecture.md` rewritten; new runbooks
  (`docs/runbooks/`: deploy, rollback, key rotation, backup and restore) and `docs/security/threat-model.md`.
- Dev tools: `scripts/dev/headless-check.js` (Playwright), `static-server.js`, `linkcheck.js`, `cycles.js`.
### URL changes
- Favicon is the SVG file `/v<version>/packages/brand/assets/colon-mark.svg` (admin: `colon-admin-mark.svg`)
  instead of an inline data URL.
- The Preview model list moved to `assets/config/models.json`.
- `/ui/` on the app subdomains now only mirrors the fonts (`/ui/fonts/`) for older pages; the kit itself loads from
  `/v<version>/packages/ui/`. `/brand/` keeps its old files.
### Not changed
- No other behaviour change: same API routes and responses, same database schema (no new migration), same
  screens.

## [0.5.3] — 2026-11-12 · Phase 5: web search with cited sources (Research mode)
Research mode now looks things up on the web before answering and cites what it found with tappable [1], [2] chips and a Sources list. Free and keyless by default; never breaks chat. Details: `docs/phases/phase-5-research.md`.
### Added
- **Web search** (`services/api/src/search/`): pluggable providers behind one interface `search(query, { limit, lang, signal }) → [{ title, url, snippet }]`. Keyless chain **DuckDuckGo** (html endpoint, lite as a second try, `uddg` redirects unwrapped, ads dropped) → **Wikipedia** (English, plus the Naijá/Yorùbá/Hausa/Igbo Wikipedia when the reply is in that language). Optional keyed providers, only used when configured: **Brave Search API**, **Tavily**, **SearXNG** (base URL). A provider that shows a captcha/anomaly page is marked blocked and rested for 10 minutes; any failure hands over to the next provider.
- **Page reader**: the top 3 result pages (admin: 0–5) read in parallel, ~6 s each and ~12 s overall, 1.5 MB cap, HTML only (PDFs and binaries skipped), main text kept (scripts, nav, header, footer, asides, cookie banners dropped) and trimmed to ~2,500 characters around the question. Wikipedia pages through Wikipedia's plain-text API. 10-minute in-memory LRU cache.
- **SSRF guard**: only http/https on ports 80/443, no credentials in URLs, every hop (max 3 redirects) must resolve to public addresses only (loopback, private, link-local/metadata, CGNAT, multicast and IPv6 equivalents refused after DNS resolution).
- **Research flow** (`chat/reply.js`): queries from the latest message (heuristic: filler removed, the year added for "current/latest" questions, a keyword variant, short follow-ups borrow the previous question's topic); for Naijá/Yorùbá/Hausa/Igbo a ~1 s model call writes English queries plus a faithful translation (4 s budget, heuristic fallback). New SSE events before the answer: `status` (`searching`, `reading` + count, `writing`, `unavailable`) and `sources [{ n, title, url, site, snippet }]`. The model gets the numbered sources with strict rules: cite [n] after the claims they support, only use the given sources for facts, say when they don't cover something, today's date in Africa/Lagos for recency, web text treated as untrusted data. If search fails entirely the answer still streams, starting with a short "web search wasn't available" notice. Daily limits and guest mode unchanged (the search runs after the limit check). Logs `search_ok` / `search_failed` (provider, ms, count; no query text).
- Sources are saved with the assistant message (existing `chat_messages.sources`) plus a new `web_search` column (`{ ok, provider, ms, read }`), so history and shared links show them.
- **Chat UI**: "Searching the web…" / "Reading N sources…" / "Writing from N sources…" status while it works; citations render as small superscript chips linking to the source in a new tab (`rel=noopener`); compact Sources row under the answer with the site's own favicon (hidden when missing), title and domain; a **Web** badge on answers that used search (**No web** when it failed). Works in light/dark and in shared chats.
- **Admin › System › Web search** (Super Admin): on/off (default on), provider order with per-provider on/off, results per search (3–8), pages read (0–5), SearXNG URL, and Brave/Tavily/SearXNG keys stored AES-256-GCM encrypted and shown masked. `GET/PATCH /admin/search`, `POST /admin/search/key` (audited).
- Migration `0006_web_search` (runs automatically on API start): `chat_messages.web_search JSON NULL`. New column only.
- New optional env vars: `WEB_SEARCH` (`off` to disable), `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `SEARXNG_URL`, `SEARXNG_API_KEY`.
- `services/api/scripts/research-check.js`: live check of search + reader + a full research answer with timings.
- Tests: `services/api/test/search.test.js` (DuckDuckGo and Wikipedia parsers on fixtures, blocked-page detection and fallback, SSRF guard and redirects, size cap, HTML to text, page reader, citation prompt, SSE `status → sources → answer` order, a failed search still answering, model-written queries) and Web search admin permissions/key masking in `admin.test.js`.
### Changed
- Research-mode system prompt: "you cannot browse" only when there are no web sources.
- Version 0.5.3 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`.

## [0.5.2] — 2026-11-12 · Phase 5: the Colon benchmark
### Changed (routing, from the first benchmark run)
- Every mode now goes Gemma 4 26B (Google) → MiniMax M3.1 Flash (NVIDIA) → Gemma 4 31B → Qwen → DeepSeek → GLM. African languages go Gemma 4 26B → Gemma 4 31B → N-ATLaS → MiniMax → Qwen → DeepSeek → GLM (MiniMax is weak in Yorùbá/Hausa/Igbo). New targets `gemma31` and `minimax` (`NVIDIA_MINIMAX_MODEL`). `.env.example`: `NVIDIA_GEMMA_MODEL` empty (NVIDIA's Gemma 4 31B is gone).
### Results (first run, 2026-11-12, `services/api/bench/results/2026-11-12.md`)
- Gemma 4 26B (Google) 94.6, fastest (0.8 s first token), wrong answers 0 (all 6 misses were Google 500s). MiniMax M3.1 Flash 88.9 (weak Yorùbá/Hausa/Igbo). Gemma 4 31B 83.5 (21 s first token). Gemini 3.5 Flash Lite 96.8 (reference only). DeepSeek V4.1 Flash and GLM-5.3 Flash (NVIDIA) answered nothing. Nemotron and Mistral Large 4 incomplete.
Saga's default is now chosen by benchmark score, and a model can only go into routing after a fresh benchmark. Details and the score formula: `docs/phases/phase-5-benchmark.md`. First live run: `services/api/bench/results/2026-11-12.md`.
### Added
- **The Colon benchmark** (`services/api/bench/sets/*.json`, suite `colon-bench-1`, 135 original items): Nigerian everyday questions, WAEC-style, JAMB-style, university study, coding, reasoning, tool use (tool calls and structured JSON), and Naijá, Yorùbá, Hausa and Igbo. Everything is graded automatically: multiple-choice letters, numbers (`Answer:` line, ₦, commas, fractions), accent-insensitive keywords and regex, JSON parsed and checked against a schema subset and expected values, JavaScript run against unit tests in a **sandboxed child process** (fresh `vm` context, no `require`/`process`/network, CPU and wall-clock timeouts), and a target-language check (function words vs English, plus subdots/tone marks/hooked letters). Optional LLM judge for the language sets (`--judge`).
- **Runner** `npm run bench` (`services/api/scripts/bench.js`, core in `src/bench/`): asks every candidate through the app's own provider client with Saga's real system prompt per mode and language, and records per item the score, first-token and total time and errors. Polite to free tiers: one or two requests at a time per model (per provider with `--concurrency-<provider>`), a gap between items, two retries with back-off on 5xx/timeouts, and longer waits on 429 that don't count as failures. A model with more than 50 % errors after 20 items is stopped as **unreliable**. Resumable (`--run`, `--retry-errors`), re-gradable from saved replies (`--report --regrade`). Writes `bench/results/<run>.md` (scoreboard and every failure), `.json` and `.eval.json`.
- **Score**: `100 × (0.60 accuracy + 0.15 language quality + 0.10 speed + 0.15 reliability)`; cost is recorded ($0 on the free tiers) and breaks ties.
- **Admin › Evaluation** shows benchmark runs: `--save` writes them to `eval_runs`, or post `bench/results/<run>.eval.json` to the new `POST /admin/evaluation/bench`. `GET /admin/models` shows each model's latest benchmark score.
- **The model-change gate** (`src/bench/gate.js`): adding a model, changing a model's id or host, switching one back on, or giving a mode a new first choice in Routing is refused with `409 needs_benchmark` unless a finished benchmark of exactly that provider + model is newer than `BENCH_MAX_AGE_DAYS` (default 30). A Super Admin can skip it once with a written reason (audited); `BENCH_GATE=off` turns it off. CLI: `npm run bench -- --gate provider:model`.
- Migration `0005_bench`: new `eval_runs` columns (`kind`, `provider`, `suite`, `items`, `error_rate`, `first_token_ms`, `details`) and an index.
- Tests: `services/api/test/bench.test.js` (graders, sandbox, every coding item solvable by a reference solution, aggregation and the score, the runner against a mock provider including retries, 429 waits and the unreliable stop, the report, the gate and its wiring into the admin routes).
### Changed
- Version 0.5.2 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`.

## [0.5.1] — 2026-11-12 · Fix: Delete account tap
### Fixed
- The decorative COLON intro wordmark could sit over Settings › Account › **Delete account** and swallow taps on the middle of the row. The intro artwork now has `pointer-events:none`, the faded intro drops behind the page (`visibility:hidden`, `z-index:-1`) and is removed after a tap-to-skip, and the decorative brand marks (`.logo-mark`, `.auth-mark`, `.cw-hero-mark`) never take a tap.
- Version 0.5.1 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`, so phones load the fixed CSS instead of a cached copy.

## [0.5.0] — 2026-11-12 · Phase 4: Admin Dashboard
Every platform setting can now be changed from admin.apparatus.name.ng, and each role sees only what it is allowed to (enforced by the API; every change is audited). Details: `docs/phases/phase-4.md`.
### Added
- **Overview** from stored data: users, chat requests and failures, provider success rates and reply latency, top errors and open reports (new `ai_calls` log, one row per provider attempt, kept 30 days).
- **Models and providers**: add, edit, enable and disable providers and models in the database. Provider API keys are **Super Admin only**, stored AES-256-GCM encrypted (key from `APP_SECRET`) and only ever shown masked (`••••1234`). Environment keys stay the fallback; the first model edit copies the built-in table into the database.
- **Routing** per mode (General/Saga, Study, Developer, Research and the African-languages route): ordered model list with fallbacks, plus the hedge count. **Live, no redeploy:** each worker re-reads within ~30 s. If the database config is empty, broken or leaves no usable model, routing falls back to `routing.js` (chat never breaks).
- **Usage and limits**: member, guest and guest-per-IP daily limits, optional per-mode daily caps, and a per-user override, all editable live.
- **Users**: search and filters (staff, suspended), user page with sessions (revoke one or all), recent sign-in events, role, daily limit, and **suspend/unsuspend** (a suspended user is blocked at sign-in, including Google, and every session is revoked).
- **Moderation queue**: "bad" feedback on replies plus reports on shared links (new **Report this chat** button on shared chats, `POST /shared/:token/report`), with resolve, resolve-and-turn-off-the-link, dismiss and reopen. Feedback context is hidden when the user turned off sharing feedback.
- **Evaluation** (stub): log benchmark runs, and see thumbs up/down per model and the reasons for bad ratings (full benchmarks are Phase 5).
- **African AI registry**: CRUD list of language models and datasets with languages, licence, licence link, source link, commercial-use and status.
- **Voice**: STT/TTS engine settings (stored only, for Phase 6). **Browser**: placeholder until Phases 8–10.
- **System settings** (Super Admin): product name, feature flags (sign-ups, guest chat, uploads, share links), **maintenance mode** (new chat activity gets `503 {error:"maintenance"}` with your message; staff exempt; history still loads) and an **announcement banner** shown in Colon AI.
- **Security**: staff 2FA status, sign-in counts (24 h), sign-in events and the full audit trail.
- Mobile-first admin UI (`apps/admin/public/js/admin-app.js`, `css/admin.css`): bottom tabs for Overview, Users, Moderation and More; every section in the desktop sidebar.
- Migration `0004_admin` (runs automatically on API start): `app_settings`, `ai_providers`, `ai_models`, `ai_calls`, `user_limits`, `user_suspensions`, `moderation_reports`, `eval_runs`, `african_registry`. New tables only.
- Tests: `services/api/test/admin.test.js` (permission matrix for every admin endpoint, live routing and fallback, settings cache, limits, call log) in `npm test`; `services/api/test/e2e-admin.js` runs the whole dashboard API against MySQL and the mock provider.
### Changed
- Moderators now get moderation plus **read-only** users (unlocking an account and `/admin/stats` moved to Admin).
- `/health` reports `ai.routing` (`database` or `default`). `/auth/config` adds `brand_name`, `features`, `maintenance` and `announcement`.
- Nav items in the UI kit can stay out of the tab bar (`tab: false`) or the sidebar (`side: false`); the shell brand follows the system brand name.
- Version 0.5.0 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`.

## [0.4.4] — 2026-11-11 · ~1 s first reply
- **Gemma 4 26B A4B is the main Google model** (first token ≈0.7–1.2 s in tests); Gemma 4 31B is now the Google backup (often 500/503 or 14 s+).
- **Rolling hedge pool:** two models always in flight; one that fails fast is replaced at once instead of waiting for the slow one.
- **Quick 5xx retried once** on the same model (Google's free tier throws random 500s that succeed on retry).
- NVIDIA Gemma disabled by default (`NVIDIA_GEMMA_MODEL` empty; the model id now 404s on NVIDIA). NVIDIA DeepSeek/GLM stay as backups (free tier queues 7–34 s before the first token).
- `ai_reply_ok` log line (provider, model, ms) in stderr.log so the live winner is visible.

## [0.4.3] — 2026-11-11 · Faster replies: hedged racing
- **Saga asks two models at once** (from different providers, e.g. DeepSeek on NVIDIA and Gemma 4 on Google) and streams whichever starts answering first; the other is cancelled. A slow or overloaded free host no longer adds 25 s of "thinking". If both fail before answering, the next pair is tried. `AI_HEDGE` (default 2; 1 = one at a time).
- Live server log before this fix: NVIDIA DeepSeek first-token timeouts and Google Gemma 500/503 "high demand" errors, tried one after another.

## [0.4.2] — 2026-11-11 · NVIDIA provider (free DeepSeek)
- **New provider: NVIDIA build.nvidia.com** (`NVIDIA_API_KEY`). DeepSeek V4.1 Flash is now the first DeepSeek target (thinking off, answers in about 2–7 s), Gemma 4 31B on NVIDIA is a second Gemma host after Google, and GLM-5.3 Flash is the last fallback on every route.
- Routing targets can now carry per-model request options (`body`).
- Tested live: a Pidgin General question and a Developer question both answered through NVIDIA DeepSeek.

## [0.4.1] — 2026-11-11 · Saga reliability fixes
### Fixed
- **Google AI Studio (Gemma 4)**: Google doesn't serve Gemma models on its OpenAI-compatible endpoint, so every Gemma call failed and Saga answered "couldn't reach an AI provider". The client now talks to the native Gemini API (`/v1beta/models/{model}:streamGenerateContent?alt=sse`, `x-goog-api-key`), sending the system prompt as `systemInstruction`, assistant turns as `model`, images as `inlineData`, and hiding thought parts. New `GEMINI_THINKING` (default `minimal`, or `high`, or `off`).
- A second Google model, Gemma 4 26B A4B (`GEMINI_FALLBACK_MODEL`, `off` to disable), now backs up Gemma 4 31B, so a Google error on one doesn't leave Saga silent.
- **No more endless "thinking"**: the chat app now turns a non-stream answer (such as a hosting firewall page), a stream silent for 90 s, or a stream that closes without finishing into a clear error with Retry.
- warn/error logs go to stderr, so cPanel's `stderr.log` shows provider failures.

## [0.4.0] — 2026-11-11 · Phase 3: Colon AI chat backend, model router v1, guest chat
### Added
- **Chat API** (`services/api/src/http/routes/chat.js`, `uploads.js`): every endpoint the remote chat adapter expects. Conversations (list, search, create, rename, pin, archive, delete one or all, export), streamed replies as server-sent events (`user` → `start` → `delta`… → `done`, or `error {code}`), **Stop** (closing the stream, or `POST …/messages/:mid/stop`, which also reaches another worker), **regenerate** (new version replaces the reply), **edit** a sent message (re-answers from there), AI Browse notes, **feedback** (good/bad + reason + comment, stored with the provider and model for evaluation), **share links** (read-only `GET /shared/:token`, can be turned off), chat settings and stats, and `GET /models` from configuration.
- **Uploads**: images, PDF, Word/PowerPoint/Excel/ODT/RTF, text and code files, and recorder voice notes. The real file signature is checked server-side (a renamed `.exe` is refused), size limits match the app (images 10 MB, documents 20 MB, text 2 MB, 5 per message), and files are stored outside web roots with a per-user quota. Text is extracted once at upload with Node built-ins only: PDFs (including compressed object streams and subset fonts with ToUnicode maps, so Yorùbá tone marks and ₦ survive), DOCX/PPTX/XLSX/ODT (built-in ZIP reader), RTF, and an approximate reader for old .doc/.ppt/.xls. Scanned PDFs say they have no text layer. Images go to a vision-capable model when one is configured; otherwise the reply explains it (`no_vision`).
- **Model router v1** (`services/api/src/ai/`): provider-agnostic OpenAI-compatible streaming client (built-in `fetch`), with Groq (Qwen), OpenRouter (DeepSeek, Gemma 4), Google AI Studio (Gemma 4) and N-ATLaS, each enabled only when its key is set and every model id env-overridable. Routing table in one file (`routing.js`) for Phase 4: Naijá, Yorùbá, Hausa or Igbo replies go DeepSeek → N-ATLaS → Gemma 4 → Qwen; General/Study/Research go Qwen → DeepSeek → Gemma 4; Developer goes DeepSeek → Qwen → Gemma 4. Automatic fallback on errors, 429s, missing models and timeouts before the first token (no silent switch mid-answer), with a short rest for a failed target so it doesn't slow every reply. `<think>` reasoning is hidden. `/health` reports which providers are on.
- **The African layer**: per-mode system prompts (General, Study as a patient Nigerian teacher, Developer, Research), Nigerian context and examples, and replies in the user's language. The profile language wins; otherwise Naijá, Yorùbá, Hausa or Igbo is detected from the message.
- **Daily limits** per user and a lower one for guests, in MySQL (`CHAT_DAILY_LIMIT`, `CHAT_GUEST_DAILY_LIMIT`). Guests are counted per browser (an anonymous `colon_gid` cookie), plus a higher shared cap per hashed IP (`CHAT_GUEST_IP_DAILY_LIMIT`) because many mobile users sit behind one carrier IP; raw IPs are never stored. A reply that no provider could give is not counted.
- **Guest chat (ChatGPT-style)**: Colon AI works without an account. Guests chat with Saga through `POST /chat/guest` (streams, saves nothing; origin-checked, rate limited) and the conversation lives only in that tab. Guests can attach documents (read once by `POST /chat/guest/extract`, not stored); images need an account. The sidebar shows **Log in / Sign up** and "Log in to save your chats"; History, Saved and Settings ask guests to log in.
- **New sign-in flow** (`packages/ui/assets/colon-app.js`): **Continue with Google** on top, **OR**, email → **Continue** → password (log in) or name/password/language (sign up), with links to switch, forgot password and the 2FA step. It opens as a dialog in Colon AI (bottom sheet on phones) and is also the `/login` and `/register` page in every app. It reuses the Phase 2 endpoints and never asks the server whether an email exists.
- Migration `0003_chat` (runs automatically on API start like `0002`): `chat_conversations`, `chat_messages`, `chat_attachments`, `chat_feedback`, `chat_settings`, `chat_usage`.
- Unit tests for the router (language and mode routing, fallback order, timeouts, Stop, SSE parsing, `<think>` filtering) and chat helpers (limits, language detection, prompts, context budget, file checks, PDF/DOCX/XLSX/RTF extraction) with mocked `fetch`; `npm test` runs them with the UI tests. `services/api/test/e2e-smoke.js` and `test/helpers/mock-provider.js` run a full guest + account flow against MySQL/MariaDB with a fake provider.
### Changed
- **Colon AI no longer forces sign-in.** The chat app picks its data adapter on start: your account when signed in (Remote, the new default), a guest chat when signed out, and the on-device Preview only when the API can't be reached. Signing in or out reloads into the right mode. The Admin Dashboard still requires sign-in (and 2FA), and Colon Browser is unchanged.
- "Save chat history" off now makes signed-in chats temporary (streamed through `/chat/guest`, never saved).
- Version 0.4.0 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`.

## [0.3.1] — 2026-11-11 · Mobile fixes: scrolling, floating composer, stale-cache crash
Frontend only: no changes to `services/api`, `database`, `.cpanel.yml` or server configuration.
### Fixed
- **Scrolling on phones (Colon AI and Colon Browser).** Root cause: below 900 px both app shells stack vertically, and the flex column item between the fixed frame and the scroll area (`.cw-main` / `.bw-main`) had no `min-height:0`. It grew to the full height of its content, so the inner scroll areas (`#cw-scroll`, `.bw-page`, `.cb-viewport`) never overflowed, and the frame (`overflow:hidden`) clipped everything. Nothing could be scrolled by touch on any page. Desktop was unaffected because the shell is a row there. Fixed with `min-height:0` on `.cw-main`, `.cw-chat`, `.cw-split` and `.bw-main`. Verified with real touch drags (CDP touch events, 360×780, mobile emulation) on welcome, conversation, History, Saved, Explore, Settings, Help, the drawer list, and browser home, reader view, tabs, bookmarks, history, downloads, settings and help, plus mouse-wheel at 1440×900.
- **Colon Browser "C.keyboard is not a function".** Phones were running a stale cached `/ui/colon-app.js` from v0.2.0. Every CSS, JS and font reference in `apps/chat`, `apps/browser` and `apps/admin` `index.html` (and the `@font-face` URLs in `colon-ui.css`) now carries `?v=0.3.1`. Boot is defensive: optional kit helpers (`keyboard`, `resizable`, `verifyBanner`, `bindBanner`) are feature-checked before use, each app checks the kit (`Colon.version` plus the helpers it needs) before starting and shows a friendly **Please refresh** screen if an old kit loads, and a screen that fails to draw shows the same refresh card instead of a raw error. New `public/.htaccess` in each app sends `Cache-Control: no-cache` for `index.html` only. `scripts/check.js` now fails CI if any asset reference is not on the `package.json` version.
- Welcome subtitle is now exactly "Your ideas, questions and ambitions start here." (it was prefixed with the first word of the account name).
### Changed
- **Colon AI mobile footer removed.** The Home / History / Saved / Profile tab bar is gone, and those screens are in the hamburger drawer and sidebar. The shared account screens no longer show a tab bar in Colon AI or Colon Browser (`Colon.start({ tabbar: false })`). Colon Browser keeps its bottom navigation controls (back, forward, home, tabs, menu).
- **Floating composer.** The input is now a rounded pill that floats above the bottom edge, with side and bottom margins. It respects the safe area and sits above the on-screen keyboard (`visualViewport`, `100dvh` fallback). It has a soft shadow and blur, and the thread scrolls underneath it behind a fade. Attach, mode, mic and send are inside the pill. The mode is a compact button in the pill with a menu (General, Study, Developer, Research, Browse the Web). On the welcome screen the Study / Developer / Research chips scroll with the content and are horizontally scrollable without catching vertical swipes. Attach File / Voice Input / Browse the Web chips show on the desktop welcome screen only.
- **Scrolling behaviour.** There is one scroll container per view, and the page behind full-screen apps is locked (`html.app-lock`). Momentum scrolling is on, and `overscroll-behavior: contain` is set on the thread, drawer, conversation list, browser pages and tab strip. While a reply streams, the thread follows only if you are at the bottom. Scrolling up (touch, wheel or keys) stops the follow and shows a **Latest** button. Entry animations play only for new messages, and older messages use `content-visibility: auto` so long threads stay light.
- The "Preview" labels for the on-device data mode are unchanged, and they go away when the backend is connected.

## [0.3.0] — 2026-11-11 · Colon AI + Colon Browser interfaces (UI)
Frontend only: no changes to `services/api`, `database/migrations`, `.cpanel.yml` or server configuration.
### Added
- **Design system v2** (`packages/ui`): royal-blue tokens from the UI spec (#4169E1, #3457C7, #101B3D, #080F24, #EAF0FF, #38BDF8, #0F172A, #64748B, #E2E8F0, #16A34A, #DC2626), light and dark themes with no flash, self-hosted Inter and JetBrains Mono (OFL), new flame logo "COLON AI by Nifelux", glass surfaces, and shared components with every state (default, hover, active, focus, disabled, loading, error): buttons, inputs, switches, segmented controls, chips, popover menus with keyboard navigation, confirm and prompt dialogs, tooltips, drawers, toasts with actions, loaders, progress, skeletons, resizable split handles, 94 inline SVG icons. `visualViewport` tracking keeps inputs above the on-screen keyboard.
- **Colon AI** (`apps/chat`): welcome screen ("What can we explore today?", four prompt cards, Study / Developer / Research modes, input with attach and mic, Attach File / Voice Input / Browse the Web), chat workspace with collapsible sidebar (New Chat, search, Saved, Recent, History, Settings, Help, account), header (sidebar toggle, title rename, model selector, new chat, browser, theme, profile), token-by-token streaming with stop, Markdown, highlighted code with copy, tables, maths, citations and source cards, copy / regenerate / feedback with reasons / read aloud, auto-growing input, mode kept per conversation, model list from configuration, rename / pin / archive / delete with confirmation, uploads (images, PDF, documents, text) with previews, progress, validation and error states, voice input (live dictation or voice notes, with permission-denied, no-microphone and unsupported states), Settings (account, appearance, language, voice, chat preferences, privacy, data export and deletion, sign out), History, Saved, Explore and Help screens, and the integrated browser in embedded and split modes (resizable on desktop, switchable on mobile) sharing one browser session.
- **Colon Browser** (`apps/browser`): standalone app with sidebar (Home, Tabs with count, Bookmarks, History, Downloads, AI Browse, Settings, Help), address bar for URLs and searches with suggestions, back / forward / refresh / home / bookmark / download / full screen, tabs with a mobile tab overview, bookmarks with folders, date-grouped searchable history, downloads and uploads, settings (homepage, search engine, appearance, privacy, permissions, downloads, sessions, clear data), session restore, and visually distinct AI / Manual / Shared control modes with Take Control, Return to AI, Pause AI and Stop. Handoff pauses pending automation before the user takes over. The AI Browse panel shows the task, current site, progress, steps, an action log and sources; Shared mode asks for approval before each action.
- Honest **web reader preview** (docs/decisions/0002): pages are fetched as data, sanitised and rendered without scripts; private and local addresses are blocked by a unit-tested URL guard; sites that refuse cross-origin reads show an "open in new tab / Android app" state.
- **Data adapters** (`apps/chat/public/js/chat-data.js`, `packages/ui/assets/colon-browser-data.js`): every new screen works today on an in-browser implementation (IndexedDB, simulated streaming, on-device preview replies labelled "Preview") and switches to the API with `localStorage['colon.data'] = 'remote'`. Expected endpoints: `docs/frontend-data-adapters.md`.
- Unit tests (`node --test "packages/ui/test/*.test.js"`) for the Markdown renderer, URL/SSRF guard, preview responder and storage; CI runs them.
### Changed
- The animated intro and the Admin Dashboard pick up the new royal-blue brand through the shared design system. Account screens gain an Appearance (theme) control.

## [0.2.0] — 2026-11-11 · Phase 2: Accounts & security
### Added
- Accounts: register, sign in, Google sign-in (when `GOOGLE_CLIENT_ID` is set), email verification and password reset through Brevo (when `BREVO_API_KEY` is set).
- Sessions: httpOnly, Secure, SameSite=Lax cookie shared across Colon apps; device list, sign out one device or all others.
- Roles: Member, Moderator, Admin, Super Admin (`OWNER_EMAIL` becomes Super Admin). TOTP two-factor, required for every staff role.
- Security: scrypt password hashing, AES-256-GCM for 2FA secrets, MySQL-backed rate limits, lockout after 5 failed passwords, CSRF header + origin check, input validation, security headers, audit log.
- Profile with language preference (English, Naijá, Yorùbá, Hausa, Igbo), draft Terms and Privacy, account deletion.
- Admin: overview stats, users and roles, unlock, sign out a user, audit log.
- `packages/ui`: Colon design system and app core. Mobile-first: bottom tab bar, desktop sidebar, safe areas, bottom sheets, smooth route transitions.
- Database migrations now run automatically on API start (`0002_auth`).
### Changed
- Root `package.json` no longer uses npm workspaces, so cPanel installs API packages inside `services/api`.

## [0.1.0] — 2026-11-11
### Added
- Monorepo structure for Nifelux · Colon AI.
- `services/api`: Node 24 API with `/health` and the `/ws` WebSocket gateway.
- `apps/chat`, `apps/browser`, `apps/admin`: app shells with the animated COLON logo intro.
- cPanel Git deployment (`.cpanel.yml`), CI syntax check, and docs.
