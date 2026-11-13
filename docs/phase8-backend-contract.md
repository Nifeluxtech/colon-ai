# Phase 8 backend contract (v0.8.0)

v0.8.0 ships the **client side** of Phase 8 (Colon Browser standalone). Two server pieces are not built yet and
`services/api` was not changed (only its version number). The clients already call or are ready to call the
endpoints below, and fall back gracefully while they are missing. This file is the contract the API has to meet.

| Piece | Client today | Until the server exists |
|---|---|---|
| Server-side reader / proxy (web light mode) | `packages/ui/js/browser/reader-proxy.js` calls `GET /browser/fetch` after the browser's own fetch fails with `needs_proxy` | A `404`/`501` marks it unavailable for the session; the page shows "Can't open this site in reader preview" with the **Open in the app for full browsing** prompt. `localStorage['colon.reader'] = 'mock'` shows a labelled **Preview** page instead, for UI testing. |
| Browser session manager (tabs, URLs, history, control owner per user and device) | Web: `RemoteBrowserData` (`/browser/session`, `/browser/history`, …) behind `localStorage['colon.data'] = 'remote'`. Android: `page_state` / `control` frames on the existing bridge (`docs/android-bridge.md`). | Web keeps its session in IndexedDB on the device; Android keeps tabs and history on the phone only (never sent). |

Everything below is JSON over HTTPS on `https://api.apparatus.name.ng`, with the cookie session (`colon_sid`) and
the `X-Colon-Client` header the web apps already send (`web`, `browser`, `android`). Errors use the API's usual
shape: `{ "error": "<code>", "message": "<text>" }`.

---

## 1. Server-side reader: `GET /browser/fetch?url=<absolute http(s) URL>`

Reads one public page on the server and returns it as clean, script-free reader HTML. It powers "light mode" on
`browser.apparatus.name.ng` and the browser panel of `chat.apparatus.name.ng` on the web. (The same path is already
listed in `packages/ui/js/browser/data.js`; this section is the full contract.)

**Response `200`:**

```json
{
  "url": "https://punchng.com/x",          // as requested
  "final_url": "https://punchng.com/x/",   // after redirects
  "status": 200,                           // upstream status
  "title": "Fuel price news",
  "byline": "Punch Newspapers",            // optional
  "lang": "en",                            // optional
  "html": "<p>…</p>",                      // sanitised reader HTML (rules below)
  "text": "…",                             // plain text, at most 200 000 characters
  "fetched_at": "2026-11-13T17:00:00Z",
  "cached": false
}
```

The client sanitises `html` again (defence in depth), so the server may be conservative rather than perfect.

**Errors:** `400 bad_url` (not absolute http/https, or credentials in the URL) · `403 blocked_private` (resolves to
a private, loopback, link-local, CGNAT or cloud-metadata address) · `413 too_large` · `415 not_html` (with
`content_type`) · `422 needs_login` (a sign-in wall was detected) · `429 rate_limited` (with `retry_after` seconds) ·
`502 upstream_error` (with `upstream_status`) · `504 timeout` · `501 not_enabled` (feature switched off).
The client treats `404` and `501` as "this server has no reader yet".

**Rules the server must follow:**

1. **SSRF:** http and https only, ports 80 and 443 only. Resolve DNS on the server and refuse private (RFC 1918),
   loopback, link-local, CGNAT (100.64/10), multicast, IPv6 ULA/link-local and metadata addresses
   (169.254.169.254, `metadata.google.internal`). Connect to the resolved IP (no second lookup), and re-check
   after **every** redirect (at most 5).
2. **Limits:** 10 s total, 2 MB body (stop reading after that), `text/html` and `text/plain` only, no cookies or
   auth headers sent upstream, a neutral user agent (`ColonReader/1.0 (+https://chat.apparatus.name.ng)`).
3. **Sanitise:** strip `script`, `style`, `iframe`, `object`, `embed`, `form` and its controls, `svg`, `math`,
   `canvas`, media, `nav`, `aside`, every `on*` attribute, `javascript:`/`data:` URLs (except small `data:image`),
   `srcset` that points off-site to non-https; make links and images absolute. Keep the same tag allow-list as
   `packages/ui/js/browser/sanitize.js`.
4. **Privacy:** never log page contents; log only `user_id`, host, status, bytes and duration. Pages fetched for a
   signed-in user are not shared with other users.
5. **Rate limits and cache:** per user 30 requests per minute and 500 per day, per IP 60 per minute for guests (if
   guests are allowed at all); cache successful responses per URL for 10 minutes (shared cache only for
   responses without `Set-Cookie` and with `Cache-Control` that allows it). cPanel/LiteSpeed: keep it a normal
   Node route; no headless browser (that is Phase 12).
6. **Robots and abuse:** honour `robots.txt` `Disallow` for the reader's user agent; refuse hosts on a block list
   (malware, adult content per the safety layer, `docs/decisions/0003-safety-layer.md`).

---

## 2. Browser session manager

One **session per user and device**: the open tabs, their URLs and titles, the active tab, and who is in control
(the user or Saga). It lets Saga (Phase 9) see what the user's phone or web browser has open, and lets Colon AI
and Colon Browser on the same phone share one session (Phase 10 "open a page in Colon Browser, then ask Saga about
it").

### Data (MySQL; needs a migration, for example `0008_browser_sessions.sql`)

- `browser_devices`: `id`, `user_id`, `device_id` (random per install, sent in the bridge `hello`), `app`
  (`colonai` · `colonbrowser` · `web-chat` · `web-browser`), `app_version`, `last_seen_at`. Unique
  `(user_id, device_id, app)`.
- `browser_sessions`: `id`, `user_id`, `device_ref` → `browser_devices.id`, `active_tab_id`, `control`
  (`manual` · `ai` · `shared`), `control_owner` (`user` · `saga`), `paused` (bool), `task` (≤ 200 chars),
  `updated_at`, `version` (int, optimistic concurrency).
- `browser_tabs`: `session_id`, `tab_id` (client id, ≤ 40 chars), `url` (≤ 2048), `title` (≤ 200), `position`,
  `updated_at`. **Private (incognito) tabs are never sent and never stored.**
- `browser_history`: `user_id`, `url`, `title`, `visited_at`, `device_ref`, only for clients that opt in (web
  `RemoteBrowserData`). The Android apps keep history on the phone and do not upload it.

### REST (web clients; matches `RemoteBrowserData`)

| Method and path | Body / query | Response |
|---|---|---|
| `GET /browser/session` | `?device_id=` (web: a random id kept in localStorage) | `{ session: { tabs: [{ id, url, title, back: [], fwd: [] }], active_id, control, paused, task, version } }` or `{ session: null }` |
| `PUT /browser/session` | `{ session, version }` | `{ session }`; `409 conflict` with the current session when `version` is stale |
| `GET /browser/sessions` | | every session of the user: `[{ device: { device_id, app, app_version, last_seen_at }, active: { url, title }, tabs: n, control }]` (for "continue on this device") |
| `DELETE /browser/session` | `?device_id=` | `{ ok: true }` (also called by "Clear browsing data › session") |
| `GET /browser/history` · `POST` · `DELETE /:id` · `DELETE` | as listed in `packages/ui/js/browser/data.js` | |

### WebSocket (Android apps; extends `docs/android-bridge.md` protocol v1)

The phone already sends `hello` (with `device_id`, `control`, `capabilities`), `page_state` (only while Saga has AI
or Shared control) and `control` frames. Phase 8 adds:

**App → backend**

| type | Fields | When |
|---|---|---|
| `hello` | existing fields **plus** `app`: `colonai` · `colonbrowser` | on connect. Each app has its own `device_id` (separate installs, separate storage); the server links the two apps on one phone through the signed-in user. |
| `session_sync` | `tabs: [{ tab_id, url, title, active }]`, `active_tab_id`, `control`, `paused` | only when the user turned on "Sync my tabs with Colon" (setting not built yet) **or** while Saga has AI/Shared control; throttled to one per 2 s; never includes private tabs |
| `page_state` | unchanged | unchanged |

**Backend → app**

| type | Fields | Effect |
|---|---|---|
| `hello` | `service`, `bridge: 1`, **`session: 1`** | `session: 1` tells the app the session manager is on (the app may then send `session_sync`) |
| `session_request` | `id` | the app answers with `ack` `{ ref: id, ok: true, result: { tabs, active_tab_id, control, paused } }` (the same data as `session_sync`, on demand, subject to the same rules) |
| `control` | unchanged (`mode`, `task`) | the phone still asks the user for consent; the result updates `control_owner` |

**Control owner rules (server):** exactly one owner per session. `manual` → owner `user`. `ai`/`shared` only after
the phone's `control` frame with `reason: consent`; any `take_control`, `pause`, `stop` or `declined` from the phone
wins immediately and cancels pending Saga commands (answer them with `ack` `error: manual_control`). Store every
change in the audit log (Phase 9).

**Limits:** 64 KB per frame, 30 tabs per session (10 on low-RAM phones; the phone enforces it too), URLs over 2048
characters dropped, sessions idle for 30 days deleted.

---

## 3. Update manifest (already live as a static file, listed here for completeness)

`https://chat.apparatus.name.ng/android/version.json` (`apps/chat/public/android/version.json`). The top-level
fields are Colon AI (unchanged since v0.7.1, so older apps keep updating); `browser` is Colon Browser. Each app
reads only its own entry and only accepts an APK named for itself (`colon-ai-<v>.apk` / `colon-browser-<v>.apk`, or
the fixed names). `scripts/deploy/android-version.test.js` keeps it in step with `package.json` and the workflow.
