# Frontend data adapters (v0.3.0)

Colon AI and Colon Browser are complete on the frontend, but several screens need API endpoints that
`services/api` does not serve yet. Every such call goes through **one adapter per app**, so the
screens never call `fetch` directly:

| Adapter | File | Used by |
|---|---|---|
| `ColonChatData` | `apps/chat/public/js/chat-data.js` | Colon AI |
| `ColonBrowserData` | `packages/ui/assets/colon-browser-data.js` | Colon Browser **and** the browser panel in Colon AI (one session infrastructure) |

Each adapter has two implementations with the same interface:

- **Local (default today).** IndexedDB in the browser (`colon-store.js`), with a localStorage/memory
  fallback. Chat replies come from an on-device *preview* responder (`chat-responder.js`) and are
  streamed token by token, so stop, regenerate, errors and every UI state behave like the real thing.
  The UI labels this "Preview". Web pages load in *reader preview* from sources that allow
  cross-origin reads (Wikipedia); everything else shows an honest "open in new tab / Android app" state.
- **Remote.** Calls the endpoints below with the existing cookie session and `X-Colon-Client` header
  (so CSRF, CORS and rate limits work as they do for `/auth` and `/account`).

Switch a device to the API once the endpoints exist (no rebuild, no redeploy):

```js
localStorage.setItem('colon.data', 'remote')   // or set window.COLON_DATA = 'remote' before the scripts
```

Existing endpoints already used directly: `GET /auth/me`, `GET /auth/config`, `POST /auth/logout`,
`PATCH /account/profile` (display name and reply language), plus every shared account screen.

## Colon AI endpoints expected

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/models` | | `{ models: [{ id, name, description, available, status, default, capabilities[] }] }` |
| GET | `/conversations` | `?q=&archived=0\|1\|all` | `{ conversations: [{ id, title, mode, model, pinned, archived, preview, created_at, updated_at }] }` |
| POST | `/conversations` | `{ mode, model }` | `{ conversation }` |
| GET | `/conversations/:id` | | `{ conversation, messages: [{ id, role, content, attachments, sources, feedback, status, model, mode, created_at }] }` |
| PATCH | `/conversations/:id` | `{ title?, pinned?, archived?, mode?, model? }` | `{ conversation }` |
| DELETE | `/conversations/:id` · `/conversations` | | `{ ok: true }` |
| GET | `/conversations/export` | | JSON export of every conversation |
| POST | `/conversations/:id/messages` | `{ content, attachment_ids[] }` | `text/event-stream` (below) |
| POST | `/conversations/:id/messages/:mid/regenerate` | | `text/event-stream` |
| POST | `/conversations/:id/notes` | `{ content, sources, origin }` | `{ message }` (AI Browse summaries) |
| POST | `/messages/:id/feedback` | `{ rating: 'up'\|'down', reason?, comment? }` | `{ ok: true }` |
| POST | `/uploads` | multipart `file` | `{ attachment: { id, name, type, size, kind } }` |
| GET / DELETE | `/uploads/:id/file` · `/uploads/:id` · `/uploads` | | file / `{ ok: true }` |
| GET / PATCH | `/chat/settings` | settings object | `{ settings }` |

**Streaming (SSE).** Events, each `event: <name>\ndata: <json>\n\n`:
`start {message}` → `delta {text}` (repeated) → optional `sources {sources:[{n,title,url,snippet}]}` → `done {message}`.
On failure send `error {code, message}`. Codes the UI explains: `no_provider` (no AI provider configured —
"An admin needs to add a provider"), `quota` (daily limit), `provider_down`. Closing the request (Stop) must
cancel the provider call and save the partial reply with `status: 'stopped'`.

**Upload limits** (also enforced in the browser): images (PNG, JPEG, WebP, GIF) 10 MB; PDF and documents
(DOC/DOCX/ODT/RTF/PPT/XLS) 20 MB; text and code files 2 MB; voice notes (from the recorder) 10 MB;
5 files per message. Validate the real file signature server-side, not just the extension.

**Modes** are per conversation (`general`, `study`, `developer`, `research`); switching keeps history.
The model list must come from configuration (`/models`); `apps/chat/public/config/models.json` is the
local stand-in and can be deleted once `/models` exists.

## Colon Browser endpoints expected

| Method | Path | Notes |
|---|---|---|
| GET / PUT | `/browser/session` | `{ session: { tabs:[{ id, url, title, back[], fwd[] }], active_id, control: 'ai'\|'manual'\|'shared', task, started_at } }` — restored on every device |
| GET / POST | `/browser/bookmarks` | `{ bookmarks, folders }` · `{ url, title, folder_id }` |
| PATCH / DELETE | `/browser/bookmarks/:id` | `{ title?, folder_id? }` |
| POST / PATCH / DELETE | `/browser/folders[/:id]` | `{ name }`; deleting a folder moves its bookmarks to Unfiled |
| GET / POST / DELETE | `/browser/history[/:id]` | `?q=&limit=`; `DELETE /browser/history` clears all |
| GET / POST / DELETE | `/browser/downloads[/:id]` | page/file downloads list |
| GET / POST / DELETE | `/browser/uploads[/:id]` | multipart upload, 20 MB |
| GET / PATCH | `/browser/settings` | homepage, engine, privacy, permissions, downloads, sessions |
| GET | `/browser/fetch?url=` | reader/proxy mode → `{ url, final_url, title, html, text, status }` |
| GET | `/browser/search?q=&engine=` | `{ results: [{ title, url, snippet }], provider }` |
| POST | `/browser/plan` | `{ goal }` → `{ steps: [{ kind: 'search'\|'open'\|'summarize', label, query?, url? }] }` (Colon Saga planner) |
| POST | `/browser/data/clear` | `{ history?, downloads?, bookmarks?, session?, settings? }` |

**`/browser/fetch` must be SSRF-safe** (docs/adr/0002 reader mode): http/https only; resolve DNS and refuse
loopback, private (10/8, 172.16/12, 192.168/16, 100.64/10), link-local (169.254/16, incl. cloud metadata),
IPv6 ULA/link-local and mapped addresses; re-check after every redirect (max 5); ports 80/443/8080/8443
only; no credentials in URLs; 2 MB and 10 s caps; strip scripts, styles, iframes, forms and event handlers.
The browser runs the same checks first (`colon-url.js`, unit-tested) and sanitises the HTML again.

**AI Browse** (`colon-saga-browse.js`) runs in the client today: plan → search → open pages → read →
summarise, each step logged and visible. Shared mode asks before every action; *Take control* aborts
the in-flight step at a safe point and re-queues it before handing over; *Stop* cancels for good.

## Testing

```
node scripts/check.js                       # syntax check (CI)
node --test "packages/ui/test/*.test.js"    # markdown, URL/SSRF guard, preview responder, storage
```
