# Android bridge (v0.10.3, Phases 7–10)

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
  (`layout { layout: 'full' }`) and close (`close`), and an empty body box (since 0.10.2: 50vh, never taller than
  the space between the header and the composer, at least 240 px; it was 60vh, at least 320 px). The native
  panel has no header of its own in this layout; full screen brings back its header and menu (where "In the
  conversation", "Embedded in chat" and "Split screen" switch layouts; nothing reloads).
- The page reports the body box with `browser('anchor', { visible, x, y, width, height, viewportTop,
  viewportBottom, dpr })`: CSS px of the shell page (`getBoundingClientRect()`), the visible band of the thread
  (between the chat header and the top of the floating composer, which the thread scrolls under; cut by the
  keyboard's visual viewport; since 0.10.1 `viewportBottom` is the composer's top, not the scroller's bottom, and
  since 0.10.2 the top of the composer's "Latest" button when it shows) and `devicePixelRatio`. Since 0.10.2 every
  number is measured from the visual viewport's corner (what the app's WebView shows on screen: the layout
  viewport can be moved by the keyboard or a focus scroll), `dpr` includes the visual viewport's scale, and
  `pageHeight` is the visible page's height in CSS px. It
  sends one on open and then at most one per animation frame when the thread scrolls, anything resizes or the
  keyboard opens, and only when something changed; `{ visible: false }` when the box is out of the band, the card
  is collapsed, or the chat leaves the conversation (`apps/chat/src/lib/native-anchor.js`).
- The app lays the panel over that box: px × `dpr` (the screen density when `dpr` is missing or outside 0.5–8),
  offset by the shell WebView's position, clipped to `viewportTop`..`viewportBottom` so it never covers the header
  or the composer; touches outside the clip reach the chat (`InlineGeometry`, `InlineLayer`). Scrolling only moves
  it (translation); it is re-laid out only when the box's size changes. Hidden when not visible or collapsed.
  Since 0.10.2 the clip also keeps the gap the page saw under `viewportBottom` (`pageHeight − viewportBottom`) from
  the shell WebView's bottom as it is now: when the keyboard opens (or the composer grows) the app's views resize
  a frame or more before the page reports again, and up to 0.10.1 the clip then ran to the bottom of the shrunken
  layer, over the composer.

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

**Saga's AI-only card (v0.10.3, feature `browserCard`; ADR 0006).** The in-chat browser is a card per Saga task
in the thread, always Saga's: the user's touches reach the page only after Take control.

- `browser('task', { op: 'start', goal, anchor, id? })`: the chat starts a task. Sent **before** `POST
  /browser/agent` (so the chat's own instruction counts as the user's consent for this chat and no "Let Saga
  browse?" dialog shows) and again with the task's `id` once known. `anchor` is the chat message the card goes
  under. `{ op: 'end', id, kind: done·error·stopped, result }`: the chat saw the task end (from its poll) with the
  result line. Answers with the panel state.
- `browser('cards')` → `[{ id, goal, anchor, state, result, at, snapshot? }]`: this chat's finished task cards,
  oldest first, `snapshot` a `data:image/jpeg;base64,…` picture of the page when the task ended (the app keeps at
  most 6 pictures, 600 KB and 20 cards per chat; they go with the chat's browser).
- `browser('control', { op, note? })`: `take_control` opens the full-screen view with the page unlocked;
  `return_to_ai` (Give back to Saga) carries the user's words as `note` (from the composer: "I've logged in,
  continue"); the app adds the page's host and path, hides anything secret-looking (HandoffNote) and sends it on
  the `control` frame. `stop` also ends the task.
- `browser('layout', { layout: 'full' })` in the thread opens the full-screen view read-only (`inline` closes it).
- The state adds `run` (`{ state: idle·running·paused·needs_user·user_control·done·error·stopped, task, goal,
  anchor, step, request: { kind, message } | null, result, since, deadline, resumes, pill: { icon, text,
  takeControl, giveBack, retry, stop } }`, kept per chat across app restarts) and `focus` (the full-screen view is
  open). `chatMode` is always `ai`; `mode` calls are kept and change nothing.
- Event `browserRetry` (`{ goal, anchor }`): the card's Retry; the chat runs the goal again.
- The anchor may carry `band: true` reports: a hidden report then still has `viewportTop`, `viewportBottom`,
  `pageHeight` and `dpr`, so the full-screen view can stop above the composer while the card is off screen.

In the thread the app draws over the card: the status pill (Saga's step with a spinner; "Saga needs you: …" with
Take control; a check and the result; an error with Retry; a stop button while it runs) and the expand button at
the bottom-right. The locked page answers a tap by opening the full-screen view. Full screen is the same WebView
laid over the chat from the top of the screen to the top of the composer (it follows the keyboard), with a slim bar:
back, the page's title and host, reload (while the user has it), Take control or Give back to Saga, more (Stop, Open
in Colon Browser, share, downloads, clear data) and back to the chat. Android's Back closes the full-screen view.
Pages are the desktop site: a desktop user agent, wide viewport, overview mode and a document-start script that keeps
the viewport at `width=1280` (`DesktopView`; less on phones narrower than 320 dp). When Saga asks for the user and
the app is in the background, a notification says so (channel `saga`).

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
| `control` | `mode`, `paused`, `reason`: `consent` · `declined` · `take_control` · `return_to_ai` · `pause` · `resume` · `stop` · `handoff` (v0.10.0: the page went to the user for a secret field) · `mode` (v0.10.0: the user switched AI only / AI + me while Saga had control); `note?` (v0.10.3, with `return_to_ai`: the user's hand-back words, ≤ 500 characters, no field values; the server hides secret-looking words again) | whenever the user changes who is in control |
| `ack` | `ref` (the command id), `ok`, `result?`, `error?` | answer to every command |
| `chat` | `conversation_id` (`""` = a new chat with no id yet) | v0.10.0: the in-chat panel now shows this conversation's browser; the server keeps session and control per device **and** conversation, and Saga must ask this chat for consent again |

**Backend → app**

| type | Fields | Effect |
|---|---|---|
| `hello` | `service`, `bridge: 1` | `bridge: 1` turns the status to `bridge_ready`. Today's gateway sends `hello` without `bridge`, which the app shows as "connected (the server hasn't switched on Saga commands yet)". |
| `pong` | | keeps the link alive |
| `control` | `mode` (`ai` · `shared` · `manual`), `task` (≤ 200 characters, shown to the user), `conversation_id?` (v0.10.0) | `ai`/`shared`: the phone asks the user "Let Saga browse?" and answers with `control` (`consent` or `declined`). `manual`: Saga's task stops. |
| `command` | `id` (≤ 64 chars), `name`, `args`, `tab_id?`, `conversation_id?` (v0.10.0), `say?` (v0.10.2: Saga's one-line explanation, ≤ 160 characters, shown in "AI + me"; never part of what the step does) | runs on the open Colon Browser (in Colon AI: on that chat's browser); always answered with `ack` |
| `handoff` | `kind` (`password` · `one_time_code` · `card` · `pin` · `sign_in` · `payment`; v0.10.3 also Saga's own requests: `captcha` · `consent` · `other`), `message` (≤ 200 characters, shown to the user), `timeout_ms?` (v0.10.3: how long Saga waits), `conversation_id?` | v0.10.0: Saga reached a secret field; the phone switches to Manual, shows "Your turn" with the message and answers `control` `handoff` |
| `notice` | `text` (≤ 160 characters, one line), `kind` (`step` · `ask` · `done`; v0.10.3 `error` · `stopped`; on `done` the text is Saga's result line), `conversation_id?` | v0.10.2: a line for the user on the page, shown in "AI + me" (the server sends "Done. Saga's answer is in the chat." when a task ends). Older apps ignore it |
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
| `click` | `id`, `approval?` | `{ url, title, method, changed, covered? }` (v0.10.1; see "Real clicks" below. Older apps: `{ url, title }`). `method` `tap+script` since 0.10.2 |
| `fill` | `id`, `value` (≤ 500), `submit?` (Enter, then the form unless the page handled Enter), `approval?` | `{ url, title, typed, method, submitted? }` (0.10.2: `typed` says the text is really in the field; `method` `insert` · `setter` · `select`; error `no_option` for a `<select>` without that option. Older apps: `{ url, title }`) |
| `scroll` | `direction`: `up` · `down` · `top` · `bottom` | `{ y, max, target, moved, method }` (0.10.2: `target` `page` · `element`, `max` the furthest scroll offset, `method` `swipe` · `script`. Older apps: `{ y, max }`, `max` the page height) |
| `screenshot` | | `{ mime: "image/jpeg", width, height, base64 }` (≤ 480 px wide, ≤ 40 KB, so the ack fits the 64 KB frame) |

New errors: `no_element` (the id is not on the page any more), `page_error` (the script returned nothing),
`no_view`, and `approval_denied`; v0.10.0 adds `secret_field` (the phone refused to fill or click a secret field
and handed the page to the user; `result: { kind }`).

**Real clicks and Saga's pointer (v0.10.1).** Up to 0.10.0 `click` ran `el.click()` in the page and answered at
once with the URL it was already on: an untrusted synthetic click with nothing on screen, which sites that listen
for `pointerdown` / `mousedown` / `touchstart` or check `isTrusted` silently ignore, and an `ok` that said nothing
about whether anything happened. Now (`SagaClicks.kt`, pure parts in `SagaTap.kt`):

1. `tools.js point` refuses a secret field (`secret_field`), scrolls the element to the middle of the page
   (`behavior: "instant"`), and returns its box and centre `cx, cy` as **fractions of the visible viewport**
   (`visualViewport`, so pinch zoom is included), `in_view`, `hit` (is the element what `elementFromPoint` finds
   there), `covered` (the label of whatever lies over it) and `before`, a snapshot of the page (URL, title, text
   hash and length, node count, focus, the element's checked / expanded / pressed / selected / open state). A secret
   field lying over the element is refused too: no tap reaches one.
2. Saga's pointer (`SagaPointer.kt`: a Colon-blue arrow with the brand's two cyan dots) glides to the centre. It is
   a view added last to the browser's `content` frame (over the WebView and the AI shield), not clickable or
   focusable, and answers every touch with `false`, so in **AI + me** the user's fingers reach the page and the
   shield's Take control button as before. It hides at once when Saga loses control or hands a secret to the user.
3. `point` runs again right before the tap (the page may have moved while the pointer glided; a secret field is
   refused here as well), and Saga stops with `manual_control` / `paused` if it lost control meanwhile.
4. **A real tap:** `MotionEvent` `ACTION_DOWN` then `ACTION_UP` 60 ms later (finger, touchscreen source) dispatched
   to the WebView at `cx × width, cy × height` px, with a ripple. When that can't be done (`off_screen`, `covered`,
   no laid-out view) `tools.js click` acts on the element itself: `pointerdown`, `mousedown`, `focus`, `pointerup`,
   `mouseup`, `click()` (still refusing secret fields).
5. After 0.7 s (and once more after 1.2 s when nothing changed yet) `tools.js outcome` compares the page with
   `before`. `ack.result.changed` is `navigated` · `url_changed` (same page, new `#hash` / history state) ·
   `page_changed` · `element_changed` · `focused` · `none` · `unknown` (the page answered nothing and the URL did
   not move); `method` is `tap` or `script`. The server tells the model plainly when a click changed nothing ("the
   click may not have worked… try another element") and keeps the element ids usable after `none`, `focused` and
   `element_changed`; after any other change it asks for `getPageContent` first.

`fill` and `scroll` move the pointer too (`fill` aims with `point`, so a secret form is refused before the pointer
moves).

**Typing, scrolling and a second try (v0.10.2, `assets/saga/act.js`).** The owner's phone showed Saga failing to
type and scroll. Up to 0.10.1 `fill` set the value with the native setter and fired plain `input` / `change`
events (no `inputType`, nothing for `contenteditable` editors beyond `textContent`) and answered `ok` without
checking; `scroll` called `window.scrollBy`, which does nothing on the many sites whose page is one screen with a
scrolling container, and also answered `ok`. Now:

- `act.js` is evaluated with `tools.js` and passed in as its third argument, so it runs only after `tools.js` found
  the element and refused secret fields. `fill` focuses the field, selects what is there and types with
  `document.execCommand('insertText')` (the browser's own editing path: `beforeinput` / `input` with `inputType
  "insertText"`, which React, Vue, Angular and rich editors register); when the page did not take it, the native
  setter (or `textContent`) and an `InputEvent`; then `change`. `<select>` picks the option by value or visible
  text. `typed` reports whether the text is really there; the server tells the model plainly when it is not.
- `scroll` is a real finger swipe (`MotionEvent` DOWN, 12 MOVEs a frame apart, a short hold so it doesn't fling,
  UP) with the pointer riding along; `act.js scrollinfo` before and after says whether the page, or the scrollable
  element under the middle of the view, moved. `top` / `bottom`, or a swipe that moved nothing: `act.js scroll`
  scrolls that element (or the page) by script, instantly even on `scroll-behavior: smooth` pages. `moved: false`
  tells the model it is already at the end.
- A real tap whose outcome is `none` (nothing changed, not even focus) is followed once by the script click
  (`tap+script`), except for a step that needed the user's approval: a payment, purchase, message or form is never
  sent twice.
- Acks are trimmed to the server's 64 KB frame limit (`BridgeProtocol.fitAck`: shorter text with `truncated: true`,
  then the last elements and links), so a long page read is never dropped by the server and left to time out.

**"AI only" locks the page; "AI + me" shows Saga's words (v0.10.2).** While Saga has the browser in AI only
(paused too), the page ignores the user: the shield with Take control covers it, and the tab's WebView
(`TabWebView`) drops the user's touches, mouse wheel and keys (Back and volume still work) and gives the keyboard no
input connection, so nothing can be typed into the page even after Saga's own tap focused a field. Saga's own
gestures go through (`TabWebView.asSaga`). Take control, Stop or the end of the task unlock it; private tabs are
never locked. In AI + me nothing is locked, and Saga's one-line explanation of each step (the command frame's
`say`), its requests to the user (a hand-off: "Your turn: enter the code…") and the server's `notice` frames show as
a pill at the top of the browser that fades by itself (`SagaNotice`: steps 2.6 s, done 4 s, requests 7 s; it never
takes a touch and screen readers announce it).

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

**Control on the phone:** AI mode puts a shield over the page with **Take control** (since 0.10.2 paused too, and
the page itself ignores the user underneath it); the bar under the address
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

**The AI-only browser on the server (v0.10.3, ADR 0006).** The model has `requestUserControl { reason, instructions
}` to hand the browser to the user (it becomes a `handoff` frame; the phone shows "Saga needs you" with Take
control) and `finish` takes a short `result` for the status pill. Take control and Pause no longer end a task: the
step in flight is answered `manual_control` / `paused` and the loop waits (task status `user_control` / `paused`,
up to `SAGA_USER_CONTROL_TIMEOUT_MS`, default 900000) for `return_to_ai` or `resume`; Saga's requests wait up to
`SAGA_HANDOFF_TIMEOUT_MS` (status `handoff`). The user's `note` is folded into the next observation ("The user's
message when they gave it back: …"). Waiting for the user doesn't count against `SAGA_TASK_TIMEOUT_MS`. A wait that
runs out ends the task with `handoff_timeout` / `user_timeout`, and the phone gets `control manual` and a `stopped`
notice; the phone's Stop (consent withdrawn) ends it at once. `GET /browser/agent?conversation_id=` lists one chat's
tasks with `conversation_id` and `result` (the web's cards).

**Continue and reconnect (v0.10.4, ADR 0006 addendum).** `hello` may carry `resumable: "ai" | "shared"` while the
phone is in `manual` (a Saga task waits for the user's Give back): the server keeps consent for the new socket, so
`control return_to_ai` there resumes the task instead of answering `needs_consent`. The app re-sends its latest
`control` frame after the server's bridge `hello` when the old socket couldn't take it or took it less than 90 s
before it died. On the server a task whose socket drops waits up to `SAGA_RECONNECT_GRACE_MS` (default 90000) for
the same user's Colon AI app: on the same worker the new socket takes over (a pending `handoff` is sent again, and a
`control` reason received on it before the re-attach counts); on another worker the sweep adopts it (the task row is
let go, `worker` NULL; workers stamp their tasks every 12 s and a task silent for 40 s is adopted too). A read
command in flight is sent again; any other command is answered to the loop as `reconnected` (the model looks before
acting). `POST /browser/agent { continue_of }` starts a continuation of one of the user's earlier tasks (goal and
conversation default to its own; a live one is stopped first): its first action row is `kind: "continue"` with
`args: { of, summary }`, and the summary of the earlier steps and how it ended opens Saga's prompt. The app's
`browserRetry` event carries `task` and `continue: true` when the card's page is still there (the card's button is
Continue). New page tool: `type` (act.js), one piece of Saga's typing before the exact `fill`; refused on secret
fields like `fill`. Every task end now sends `control manual` and a notice (interrupted too).

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
