# Android bridge (v0.7.1, Phase 7)

The Colon AI Android app (`apps/android`) has two bridges:

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
| `openTab(url)` | `url` http(s) or `''` | opens a native Colon Browser tab |
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
`takeShare()`), `bridge` (`{ status }`), `resume` (app back in the foreground).

**Native paths that need no call:** `<input type="file">` opens Android's file picker (accept types and multiple
files honoured); `getUserMedia({ audio })` asks for the microphone permission and is granted only to Colon's
pages; links to other sites open in Colon Browser tabs; `mailto:`, `tel:`, `intent://` and other app links leave
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
| `hello` | `client: "android"`, `app_version`, `version_code`, `device_id` (random per install), `sdk`, `low_ram`, `control` (`manual`·`ai`·`shared`), `capabilities[]` (command names below) | right after connecting |
| `ping` | | every 25 s |
| `page_state` | `tab_id`, `url`, `title`, `loading`, `progress`, `can_go_back`, `can_go_forward`, `tabs`, `mode`, `paused` | **only while Saga has AI or Shared control**, throttled to one per 400 ms. Manual browsing is never reported. |
| `control` | `mode`, `paused`, `reason`: `consent` · `declined` · `take_control` · `return_to_ai` · `pause` · `resume` · `stop` | whenever the user changes who is in control |
| `ack` | `ref` (the command id), `ok`, `result?`, `error?` | answer to every command |

**Backend → app**

| type | Fields | Effect |
|---|---|---|
| `hello` | `service`, `bridge: 1` | `bridge: 1` turns the status to `bridge_ready`. Today's gateway sends `hello` without `bridge`, which the app shows as "connected (the server hasn't switched on Saga commands yet)". |
| `pong` | | keeps the link alive |
| `control` | `mode` (`ai` · `shared` · `manual`), `task` (≤ 200 characters, shown to the user) | `ai`/`shared`: the phone asks the user "Let Saga browse?" and answers with `control` (`consent` or `declined`). `manual`: Saga's task stops. |
| `command` | `id` (≤ 64 chars), `name`, `args`, `tab_id?` | runs on the open Colon Browser; always answered with `ack` |
| `error` | `code`, `message` | logged |

**Commands in v0.7.1:** `open_url {url, new_tab?}`, `new_tab {url?}`, `back`, `forward`, `reload`, `stop`,
`switch_tab {tab_id}`, `close_tab {tab_id}`, `get_page_state`, `get_tabs`. Errors: `manual_control` (the user is in
control or never agreed), `paused`, `browser_not_open`, `bad_url`, `no_tab`, `no_history`, `tab_limit`,
`unsupported` (any other name). Phase 9 adds `get_page_content`, `get_links`, `click`, `fill`, `scroll`,
`screenshot` (injected JavaScript in the tab, with on-phone approval for payments, forms and messages).

**Control on the phone:** AI mode puts a shield over the page with **Take control**; the bar under the address
shows Pause/Resume, Take control / Return to AI and Stop. Commands run only in AI or Shared mode and not paused.

### What the backend must add (not in v0.7.1: `services/api` was not changed)

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
