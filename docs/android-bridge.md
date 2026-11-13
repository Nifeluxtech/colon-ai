# Android bridge (v0.10.0, Phases 7–10)

The Colon AI Android app (`apps/android`, flavor `colonai`) has two bridges. Colon Browser (flavor `colonbrowser`)
shows no Colon page, so it has only the backend bridge (2).

1. **JavaScript bridge** (`window.ColonNative`): between the chat web app and the app on the same phone.
2. **Backend bridge** (WebSocket): between the phone and `services/api`, so the backend and Saga can see the
   Colon Browser's page state and send it commands (ROADMAP Phases 9–10).

Both are built so that nothing breaks while the other side is missing: the web app works the same in a normal
browser, and the app works with today's API, which has no bridge logic yet (see "What the backend must add").

---

## 1. JavaScript bridge: `window.ColonNative`

**Where it exists:** only in the main frame of pages from `https://chat.apparatus.name.ng` and
`https://browser.apparatus.name.ng` (`UrlRules.BRIDGE_ORIGINS`), inside the Android app. On current WebViews the
origin rule is enforced by WebView itself (`WebViewCompat.addWebMessageListener` and
`addDocumentStartJavaScript` with those origins). On very old WebViews a fallback `JavascriptInterface` checks the
page origin on every call; the app's shell never shows other sites (they open in Colon Browser tabs, which never
get the bridge). Every other page, including every site in a browser tab, has no bridge.

**Detecting the app:** the user agent ends with `ColonAndroid/<version>` (for example `ColonAndroid/0.7.1`), and
`window.ColonNative` appears before the page's own scripts run (the `colonnative:ready` event fires when it has
answered). The web code goes through `Colon.native` (`packages/ui/js/colon/native.js`), which falls back safely on
the web, and sets `html[data-shell="android"]` for CSS.

**Calls** (each returns a Promise; errors carry `code`):

| Call | Arguments | Result |
|---|---|---|
| `info()` | | `{ platform, version, versionCode, sdk, release, model, lowRam, webview, bridge, online, signedRelease, features[] }` |
| `openTab(url)` | `url` http(s) or `''` | opens the page in the native in-chat browser panel (v0.7.x: a Colon Browser screen) |
| `browser(action, o)` | `action`: `open` (`{ url?, layout? }`) · `navigate` (`{ url }`) · `layout` (`{ layout: inline·embedded·split·full }`) · `collapse` (`{ collapsed }`) · `close` · `back` · `forward` · `reload` · `handoff` · `state` · `anchor` (v0.9.1, see below). Any action may carry `inline: true` (v0.9.1): the page draws the in-thread card | the panel state `{ open, layout, collapsed, url, title, loading, progress, canGoBack, canGoForward, tabs, control, paused, task, browserApp }`; `handoff` → `{ handedOff }` (opens the page in the Colon Browser app, or offers its download); `anchor` → `null`. Phase 10 (v0.10.0): `chat` (`{ conversation_id, adopt? }`) · `forget` (`{ conversation_id }` or `{ all: true }`) · `mode` (`{ mode: ai·shared }`) · `control` (`{ op: take_control·return_to_ai·pause·resume·stop }`), see below. Feature `browserPanel`; `inline` and `anchor` need feature `browserInline`; the Phase 10 actions need feature `browserChats`. |
| `share({ title, text, url })` | | Android share sheet |
| `download(url, name, mime)` | http(s) URL | Android DownloadManager (cookies included, so signed-in files work) |
| `call('saveFile', { name, mime, base64 })` | ≤ 25 MB | saves into Downloads (`{ path }`) — used for blob exports |
| `haptic(kind)` | `tap` · `confirm` · `reject` · `long` | vibration feedback |
| `requestPermission(name)` | `microphone` · `camera` · `notifications` | `{ granted }` |
| `checkUpdate(prompt)` | `true` shows the update dialog | `{ current, currentCode, latest, available }` |
| `setTheme(theme)` | `dark` · `light` | colours the system bars to match the page |
| `setSession({ token? })` | optional bearer token | the backend bridge reconnects if the session changed |
| `takeShare()` | | content shared to Colon from another app, once: `{ text, subject, files: [{ name, type, size, base64 }], skipped }` or `null` |
| `call('bridgeStatus')` | | `{ status }`: `off` · `offline` · `connecting` · `connected` · `bridge_ready` · `unavailable` |

**Events** (`ColonNative.on(name, fn)` or `window` event `colonnative:<name>`): `share` (`{ pending: true }`; call
`takeShare()`), `bridge` (`{ status }`), `resume` (app back in the foreground), `browser` (the panel state above,
whenever the panel opens, closes, changes layout, loads, or Saga's control changes).

**The panel in the chat thread (v0.9.1, feature `browserInline`).** Layout `inline` (the default on phones; wide
screens open `split`) shows the panel inside the conversation, where the web app's "Colon Browser" card sits:

- The page says it can draw the card by adding `inline: true` to its `browser(...)` calls (the chat does on every
  call, including the first `state`). The app uses `inline` only then; with an older page the panel shows
  `embedded` (above the chat) as before, and `state.layout` says which layout is really shown. Since 0.9.2 the app
  starts not knowing (inline, hidden until the card reports) and waits up to 6 s after each open and each shell
  page load before falling back to `embedded`; an `anchor` report also counts as saying so. The state carries
  `inlineReady` (0.9.2): while it is `false` the page should say so again (the chat answers it with a `state` call).
  On phones every open from closed starts `inline` (0.9.2); a layout picked in the panel menu lasts while it is open.
- When `state.layout` is `inline`, the page draws the card in the thread (`.cw-native-host`, next to the web card's
  `.cw-embed-host`): status dot, "Colon Browser", the page's address, collapse (`collapse`), full screen
  (`layout { layout: 'full' }`) and close (`close`), and an empty body box (60vh, at least 320 px). The native
  panel has no header of its own in this layout; full screen brings back its header and menu (where "In the
  conversation", "Embedded in chat" and "Split screen" switch layouts; nothing reloads).
- The page reports the body box with `browser('anchor', { visible, x, y, width, height, viewportTop,
  viewportBottom, dpr })`: CSS px of the shell page (`getBoundingClientRect()`), the visible band of the thread
  (between the chat header and the composer, cut by the keyboard's visual viewport) and `devicePixelRatio`. It
  sends one on open and then at most one per animation frame when the thread scrolls, anything resizes or the
  keyboard opens, and only when something changed; `{ visible: false }` when the box is out of the band, the card
  is collapsed, or the chat leaves the conversation (`apps/chat/src/lib/native-anchor.js`).
- The app lays the panel over that box: px × `dpr` (the screen density when `dpr` is missing or outside 0.5–8),
  offset by the shell WebView's position, clipped to `viewportTop`..`viewportBottom` so it never covers the header
  or the composer; touches outside the clip reach the chat (`InlineGeometry`, `InlineLayer`). Scrolling only moves
  it (translation); it is re-laid out only when the box's size changes. Hidden when not visible or collapsed.

**One browser per chat (v0.10.0, Phase 10, feature `browserChats`).** Each conversation has its own in-chat
browser: its own tabs, history, cookies and storage (a WebView profile per chat on WebViews that support profiles;
the least recently used beyond `-Pcolon.chatProfiles` (1–100, default 20) are deleted; older WebViews share one
profile and the state says `profiles: "shared"`). This replaces sharing Colon Browser's tabs with the chat.

- `browser('chat', { conversation_id, adopt? })`: the chat page now shows this conversation (`conversation_id`
  empty or missing: a new chat with no id yet). The panel switches to that chat's browser; Saga's task in the
  previous chat ends. `adopt: true`: the new chat just got its id, so the browser it already has becomes the
  conversation's (nothing reloads).
- `browser('forget', { conversation_id })`: the chat was deleted; its browser (profile, tabs, history) goes too.
  `{ all: true }` forgets every chat's browser (Delete all chats).
- `browser('mode', { mode })`: the chat's mode, `ai` ("AI only": Saga drives, the user watches) or `shared`
  ("AI + me": both act and Saga sees the user's changes). Anything else fails with `bad_mode`. It never gives Saga
  control: in Manual it only changes what Return to AI goes back to.
- `browser('control', { op })`: the user's Take control, Return to AI, Pause, Resume or Stop from the chat page (the
  inline card or a chat message such as "stop"); `no_change` when it changed nothing.
- The panel state adds `chat` (the conversation shown, or `null`), `chatMode` (`ai` · `shared`), `resumable` (the
  mode Return to AI goes back to, or `null`), `handoff` (`{ kind, message }` while Saga waits for the user, or
  `null`) and `profiles` (`separate` · `shared`).
- **Chat-driven browsing:** the chat reads messages such as "open the browser", "open google.com" or "scroll down"
  (`apps/chat/src/lib/browser-intent.js`) and runs them on this chat's own browser; anything else asked of the
  browser becomes a Saga task in this chat (`POST /browser/agent` with `conversation_id` and `mode`).
- **Secret fields go to the user.** Saga never fills passwords, one-time codes, card numbers, PINs, or sign-in and
  payment pages: the server and the phone each check, and the page is handed to the user ("Your turn" on the card)
  until they tap Return to AI (section 2, "Handoff").

**Native paths that need no call:** `<input type="file">` opens Android's file picker (accept types and multiple
files honoured); `getUserMedia({ audio })` asks for the microphone permission and is granted only to Colon's
pages; links to other sites open in the in-chat browser panel; `mailto:`, `tel:`, `intent://` and other app links leave
the app safely (no explicit components).

**Voice in the app:** Android System WebView has no working speech-recognition service, so inside the app every
language uses "Colon speech" (recorded with `getUserMedia`, transcribed by `POST /voice/transcribe`). Hands-free
mode and read-aloud work the same as in Chrome (the app allows audio playback without a tap).

---

## 2. Backend bridge (WebSocket)

**URL:** `wss://api.apparatus.name.ng/ws?client=android&v=1` — the API's existing gateway
(`services/api/src/ws/index.js`). Override at build time with `-Pcolon.bridgeUrl=wss://…`.

**Handshake headers sent by the app:**

| Header | Value |
|---|---|
| `Cookie` | `colon_sid=…` from the WebView's cookie store (the same session as the chat), only when the URL is the Colon API host |
| `Authorization` | `Bearer <token>` if the web app handed one over with `setSession({ token })` (optional, for a future token flow) |
| `X-Colon-Client` | `android` |
| `User-Agent` | `ColonAndroid/<version> (Android <release>)` |

No `Origin` header is sent, so today's origin check passes. The backend must authenticate the socket itself (below).

**Connection behaviour:** connects while any Colon screen is open and disconnects 30 s after the last one closes
(no background service yet). OkHttp ping frames every 20 s, plus an application `{"type":"ping"}` every 25 s that
today's gateway already answers with `pong`; 70 s without any message counts as a dead link. Reconnects with
exponential backoff and jitter (1 s → 60 s), at once when Android reports the network is back, and every 5 minutes
after a `401`, `403` or `404` handshake (status `unavailable`).

### Messages (JSON text frames, protocol v1)

Every frame has `type`; app frames also carry `v: 1` and `ts` (ms since epoch).

**App → backend**

| type | Fields | When |
|---|---|---|
| `hello` | `client: "android"`, `app_version`, `version_code`, `device_id` (random per install), `sdk`, `low_ram`, `control` (`manual`·`ai`·`shared`), `capabilities[]` (command names below), `conversation_id?` (v0.10.0: the chat the panel shows) | right after connecting |
| `ping` | | every 25 s |
| `page_state` | `tab_id`, `url`, `title`, `loading`, `progress`, `can_go_back`, `can_go_forward`, `tabs`, `mode`, `paused`, `conversation_id?` (v0.10.0) | **only while Saga has AI or Shared control**, throttled to one per 400 ms. Manual browsing is never reported. |
| `control` | `mode`, `paused`, `reason`: `consent` · `declined` · `take_control` · `return_to_ai` · `pause` · `resume` · `stop` · `handoff` (v0.10.0: the page went to the user for a secret field) · `mode` (v0.10.0: the user switched AI only / AI + me while Saga had control) | whenever the user changes who is in control |
| `ack` | `ref` (the command id), `ok`, `result?`, `error?` | answer to every command |
| `chat` | `conversation_id` (`""` = a new chat with no id yet) | v0.10.0: the in-chat panel now shows this conversation's browser; the server keeps session and control per device **and** conversation, and Saga must ask this chat for consent again |

**Backend → app**

| type | Fields | Effect |
|---|---|---|
| `hello` | `service`, `bridge: 1` | `bridge: 1` turns the status to `bridge_ready`. Today's gateway sends `hello` without `bridge`, which the app shows as "connected (the server hasn't switched on Saga commands yet)". |
| `pong` | | keeps the link alive |
| `control` | `mode` (`ai` · `shared` · `manual`), `task` (≤ 200 characters, shown to the user), `conversation_id?` (v0.10.0) | `ai`/`shared`: the phone asks the user "Let Saga browse?" and answers with `control` (`consent` or `declined`). `manual`: Saga's task stops. |
| `command` | `id` (≤ 64 chars), `name`, `args`, `tab_id?`, `conversation_id?` (v0.10.0) | runs on the open Colon Browser (in Colon AI: on that chat's browser); always answered with `ack` |
| `handoff` | `kind` (`password` · `one_time_code` · `card` · `pin` · `sign_in` · `payment`), `message` (≤ 200 characters, shown to the user), `conversation_id?` | v0.10.0: Saga reached a secret field; the phone switches to Manual, shows "Your turn" with the message and answers `control` `handoff` |
| `error` | `code`, `message` | logged |

**Commands (since v0.7.1):** `open_url {url, new_tab?}`, `new_tab {url?}`, `back`, `forward`, `reload`, `stop`,
`switch_tab {tab_id}`, `close_tab {tab_id}`, `get_page_state`, `get_tabs`. Errors: `manual_control` (the user is in
control or never agreed), `paused`, `browser_not_open`, `bad_url`, `no_tab`, `no_history`, `tab_limit`,
`unsupported` (any other name), `private_tab` (v0.8.0: Saga can't read or drive private tabs; they are also left out
of `get_tabs` and `page_state`). In Colon AI the commands run on the in-chat browser panel while it is open; in
Colon Browser on its tabs.

**Saga's page tools (Phase 9, v0.9.0):** run as JavaScript injected into the tab (`app/src/main/assets/saga/
tools.js`, evaluated fresh for each command with `evaluateJavascript`, nothing left on the page's `window`) or
natively (`SagaTools.kt`). The app lists them in `hello.capabilities`; the server only starts Saga tasks on an app
that has `get_page_content`.

| Command | Args | `ack.result` |
|---|---|---|
| `get_page_content` | | `{ url, title, text (≤ 12 000 chars), truncated, elements: [{ id: "c1"…, tag, type, role, label, text, name, placeholder, autocomplete, href, form, contenteditable }] }` (≤ 60 visible interactive elements; ids are written to `data-colon-saga` and are valid until the next read; typed values are never sent) |
| `get_links` | | `{ links: [{ text, url }] }` (http(s), unique, ≤ 80) |
| `click` | `id`, `approval?` | `{ url, title }` |
| `fill` | `id`, `value` (≤ 500), `submit?` (Enter + form submit), `approval?` | `{ url, title }` |
| `scroll` | `direction`: `up` · `down` · `top` · `bottom` | `{ y, max }` |
| `screenshot` | | `{ mime: "image/jpeg", width, height, base64 }` (≤ 480 px wide, ≤ 40 KB, so the ack fits the 64 KB frame) |

New errors: `no_element` (the id is not on the page any more), `page_error` (the script returned nothing),
`no_view`, and `approval_denied`; v0.10.0 adds `secret_field` (the phone refused to fill or click a secret field
and handed the page to the user; `result: { kind }`).

**Approvals on the phone (Phase 9).** Before `click` and `fill` the phone inspects the **real** element
(`inspect`) and classifies it (payment · purchase · send_message · form_submission · personal_data, the same rules
as the server's `modules/saga/policy.js`; `tests/security/saga-phone-tools.test.js` keeps them in step). The server
also sends `args.approval: { kind, reason }` when its own check says so. If either side asks (the stronger kind
wins), a dialog "Approve Saga's next step?" waits for the user's tap; the step runs only after **Approve**, and its
`ack.result` then carries `approval: "approved"` and `approval_kind`. **Don't allow**, dismissing the dialog, or
Saga losing control (Take control, Pause, Stop) answers `ack` `ok: false, error: "approval_denied"` (or
`manual_control` / `paused`). There is no argument that pre-approves anything: the server can add an approval,
never remove one, and it treats an `ok` answer without `approval: "approved"` to a step it flagged as a broken
promise (the task stops with `approval_missing`). In **Shared** mode every command that changes the page
(everything except `get_page_content`, `get_links`, `get_tabs`, `get_page_state`, `screenshot`) asks first
(`approval_kind: "shared"`).

**Consent (v0.9.0):** when the user taps **Allow** on "Let Saga browse?" while the phone is already in that mode,
the app still answers `control` with `reason: consent`, so the server never waits for an answer that can't come.
In Colon AI, a `control` request for AI or Shared **opens the in-chat browser panel** if it is closed (Phase 10:
the browser appears when Saga browses) and then shows the prompt.

**Control on the phone:** AI mode puts a shield over the page with **Take control**; the bar under the address
shows Pause/Resume, Take control / Return to AI and Stop. Commands run only in AI or Shared mode and not paused.

**Handoff and chats (v0.10.0, Phase 10).** Session, control and consent are kept per device and conversation
(migration `0010_chat_browser_sessions.sql`: `browser_sessions.conversation_id`, `''` being the device-wide session
Colon Browser and older apps use; `chat_conversations.browser_mode`; `saga_tasks.mode`). `conversation_id` may be
sent on `hello`, `chat`, `session_sync`, `page_state` (app → backend) and on `control`, `command` and `handoff`
(backend → app). A Saga command for a chat the panel isn't showing fails on the server with `other_chat`; a `chat`
frame cancels Saga's pending commands and ends its task in the old chat. In "AI + me" the server keeps the latest
`page_state` (memory only) so Saga sees what the user changed.

When Saga is about to fill or click a secret field (password, one-time code, card, PIN) or act on a sign-in or
payment page, the server sends `handoff` instead of the command. The phone checks the real element as well: if it
finds a secret field the server missed, it answers that command with `ack` `ok: false, error: "secret_field"`,
`result: { kind }` **first** and only then hands the page to the user and reports `control` `handoff` (so the
server reads "wait for the user", not "the user took over"). A `handoff` report cancels nothing pending (the phone
already answered the refused step); Take control still does. The server then waits up to
`SAGA_HANDOFF_TIMEOUT_MS` (default 600000) for `control` `return_to_ai`; `take_control`, `pause`, `resume` and
`mode` keep it waiting, Stop or a dropped socket end the task. Saga's page snapshots are redacted
(`modules/saga/secrets.js`): typed secret values never reach the model or the logs.

### What the backend must add

**Status (v0.8.1):** items 1 (cookie only; signed-out sockets still connect but get no session features), 2, 3, 6
(control changes) and the 64 KB frame limit of 7 are built, together with Phase 8's `session_sync` /
`session_request` frames and `hello.app` (`services/api/src/modules/browser/bridge.js`; details and choices in
`docs/phase8-backend-contract.md`, "Server notes").
**Status (v0.9.0):** routing (4) and command audit (6) are built for Saga (`services/api/src/modules/saga`, below).
Still open: bearer tokens, storing `page_state` (5), sockets per user (7) and push (8).

### Saga on the server (v0.9.0)

`POST /browser/agent { goal, language?, conversation_id? }` (signed in; 20 an hour per user by default; the goal passes the
safety layer's input check, `422 refused` otherwise) creates a task (`202 { task, phone }`). The worker that holds
a Colon AI socket of the user (Colon Browser if there is none) claims it; a task nobody claims within a minute
fails with `no_phone`. That worker sends `control { mode: "ai", task }`, waits up to `SAGA_APPROVAL_TIMEOUT_MS` for
the phone's `consent` (`declined` stops the task), then runs the loop: the model picks one tool
(`openUrl, getPageContent, getLinks, click, fill, scroll, screenshot, back, forward, refresh, tabs, finish`) as a
JSON object, the server validates it and sends one `command`, and the `ack` becomes the next observation. Page
content reaches the model only neutralised and fenced as untrusted. Limits: `SAGA_MAX_STEPS`,
`SAGA_TASK_TIMEOUT_MS`, `SAGA_MODEL_TIMEOUT_MS`, `SAGA_STEP_TIMEOUT_MS` (per command; approvals wait
`SAGA_APPROVAL_TIMEOUT_MS`). Take control, Pause, Stop or a dropped socket end the task (`interrupted`); at the end
the server sends `control { mode: "manual" }` to hand the browser back. Follow and replay: `GET /browser/agent/:id
?after=<seq>` (`{ task, actions }`), `POST /browser/agent/:id/stop`, `GET /browser/agent`; admins:
`GET /admin/saga/tasks`, `GET /admin/saga/tasks/:id` (Admin › Browser). Every step is a row in `saga_actions`
(explanation, command, arguments with typed personal data hidden, approval asked and given, result, page, time);
page text is never stored.

1. **Authenticate the socket:** in the `upgrade` handler, load the session from the `colon_sid` cookie (the same
   `sessions.load(req)` the HTTP routes use; `req.cookies` must be parsed for upgrade requests) or from
   `Authorization: Bearer`. Refuse (`401`) when there is no valid session. Keep the origin check for browsers;
   accept no-Origin requests only with `X-Colon-Client: android` and a valid session.
2. **Answer `hello` with `{ type: "hello", service: "colon-ai", bridge: 1 }`** for authenticated Android clients and
   remember `{ user_id, device_id, capabilities, control }` per socket.
3. **Device registry:** persist devices (user, device id, app version, last seen) in MySQL — workers are recycled,
   so nothing may live only in memory (see `ws/index.js`). Needs a migration (for example `0008_devices.sql`).
4. **Routing:** a way for Saga (Phase 9) to pick a user's connected phone, send `control` then `command` frames,
   and await `ack` by `ref`, with a per-command timeout (for example 20 s) and per-user rate limits.
5. **Page state:** store the latest `page_state` per device for the browser session manager (Phase 8), never
   for manual browsing (the phone doesn't send it).
6. **Audit:** log every `control` change and every command with its `ack` (Phase 9 "every action is logged").
7. **Limits:** max frame size (for example 64 KB), max sockets per user, idle timeout; keep the existing 25 s
   ping/terminate loop.
8. **Push (later):** an FCM HTTP v1 sender with a service account stored on the server only, and an endpoint to
   register the app's FCM token, so Saga can wake the phone when the app is closed.
