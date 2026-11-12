# Frontend data adapters (v0.4.0)

Every data call in Colon AI and Colon Browser goes through **one adapter per app**, so the screens
never call `fetch` directly:

| Adapter | File | Used by |
|---|---|---|
| `ColonChatData` | `apps/chat/src/core/data.js` | Colon AI |
| `ColonBrowserData` | `packages/ui/js/browser/data.js` | Colon Browser **and** the browser panel in Colon AI (one session infrastructure) |

## Colon AI: which implementation runs (v0.4.0)

`ColonChatData.get()` picks one implementation when the app starts. All three have the same interface.

| Implementation | When | What it does |
|---|---|---|
| **Remote** (default) | signed in and the API is reachable | Calls the endpoints below with the cookie session and `X-Colon-Client` header. Chats, files, feedback and settings sync to the account across devices. |
| **Guest** | signed out, API reachable | Streams replies from `POST /chat/guest`. The conversation lives only in this tab's memory: no history list, no Saved, no Settings. Documents are read once by `POST /chat/guest/extract` and not stored; images need an account. Also used inside Remote for temporary chats when "Save chat history" is off. |
| **Local** (Preview) | the API can't be reached | IndexedDB in the browser (`colon-store.js`) and the on-device preview responder (`chat-responder.js`), streamed token by token. The UI labels it "Preview". |

"Reachable" means `GET /auth/config` answered when the app started (`Colon.online`). Signing in or out
reloads the app, so it restarts in the right mode. To force a mode on one device (no rebuild, no redeploy):

```js
localStorage.setItem('colon.data', 'local')    // always the on-device Preview
localStorage.setItem('colon.data', 'remote')   // never fall back to Preview (signed out still means Guest)
localStorage.removeItem('colon.data')          // back to automatic
```

Endpoints the shared account screens use directly: `GET /auth/me`, `GET /auth/config`, `POST /auth/login`,
`POST /auth/register`, `POST /auth/google`, `POST /auth/logout`, `POST /auth/forgot`, `PATCH /account/profile`
(display name and reply language), and the rest of `/account/*`. The sign-in flow (`Colon.authFlow`, opened as a
dialog by `Colon.authModal()` in Colon AI) never asks whether an email has an account: it follows the button you
pressed (Log in or Sign up) and offers a link to switch.

## Colon AI endpoints (served by `services/api` since v0.4.0)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/models` | | `{ models: [{ id, name, description, available, status, default, capabilities[] }] }` (from `src/modules/ai/routing.js`; `available` is false until a provider key is set) |
| GET | `/conversations` | `?q=&archived=0\|1\|all` | `{ conversations: [{ id, title, mode, model, pinned, archived, preview, shared, created_at, updated_at }] }` (search covers titles and messages) |
| POST | `/conversations` | `{ mode, model }` | `{ conversation }` |
| GET | `/conversations/:id` | | `{ conversation, messages: [{ id, role, content, attachments, sources, feedback, status, model, mode, version, error?, created_at }] }` |
| PATCH | `/conversations/:id` | `{ title?, pinned?, archived?, mode?, model? }` | `{ conversation }` (a mode change in a started chat saves a "Switched to … mode" event) |
| DELETE | `/conversations/:id` · `/conversations` | | `{ ok: true }` (deletes the chat's files too) |
| GET | `/conversations/export` | | JSON export of every conversation with its messages |
| POST | `/conversations/:id/messages` | `{ content, attachment_ids[] }` | `text/event-stream` (below) |
| POST | `/conversations/:id/messages/:mid/regenerate` | | `text/event-stream` (replaces that reply, `version` + 1; an unknown id retries the latest question) |
| POST | `/conversations/:id/messages/:mid/edit` | `{ content }` | `text/event-stream` (rewrites a user message, removes everything after it, answers again) |
| POST | `/conversations/:id/messages/:mid/stop` | | `{ ok: true }` (the app also just closes the stream) |
| POST · DELETE | `/conversations/:id/share` | | `{ share: { token, url } }` · `{ ok: true }` (turns the link off) |
| GET | `/shared/:token` | | `{ conversation: { title, mode, created_at, shared_at, owner }, messages }` (public, read-only, no files; the app shows it at `#/share/:token`) |
| POST | `/conversations/:id/notes` | `{ content, sources, origin, title }` | `{ message }` (AI Browse summaries) |
| POST | `/messages/:id/feedback` | `{ rating: 'up'\|'down', reason?, comment? }` or `{}` to clear | `{ ok: true, feedback }` |
| POST | `/uploads` | multipart `file` (+ `recorder=1`, `duration` for voice notes) | `{ attachment: { id, name, type, size, kind, width?, height?, pages?, words?, note? } }` |
| GET · DELETE | `/uploads/:id/file` · `/uploads/:id` · `/uploads` | | file · `{ ok: true }` |
| GET · PATCH | `/chat/settings` | settings object (validated keys only) | `{ settings }` |
| GET | `/chat/stats` · `/chat/usage` | | counts and storage · `{ used, limit, remaining, guest, provider_configured }` |
| POST | `/chat/guest` (sets an anonymous `colon_gid` cookie for the guest daily limit) | `{ messages: [{ role, content, attachments: [{ name, kind, text }] }], mode, model, language }` (signed-in temporary chats may send `attachment_ids`) | `text/event-stream`, nothing saved |
| POST | `/chat/guest/extract` | multipart `file` | `{ attachment: { id, name, kind, text, pages?, note? } }` (read once, not stored; images → `login_required`) |

**Streaming (SSE).** Events, each `event: <name>\ndata: <json>\n\n`:
`user {message, conversation}` (send and edit only) → `start {message}` → `delta {text}` (repeated) → optional
`sources {sources:[{n,title,url,snippet}]}` → `done {message}`. **Research mode (v0.5.3)** searches the web first and
sends, before the first delta: `status {stage:'searching'}` → `status {stage:'reading', count}` →
`sources {sources:[{n,title,url,site,snippet}]}` → `status {stage:'writing'}`; when search fails:
`status {stage:'unavailable'}` and a one-line notice as the first `delta`. The saved message carries `sources` and
`web {ok, provider}` (also in shared chats). See `docs/phases/phase-5-research.md`. On failure the server sends `error {code, message}` and
saves the reply with `status: 'error'`. Codes the UI explains: `no_provider` (no AI provider key set: "An admin needs to
add a provider"), `quota` (daily limit; guests get a Log in button), `provider_down` (every provider failed, or the
connection dropped mid-answer), `no_vision` (an image was attached but no vision model is configured). Closing the
request (Stop) cancels the provider call and saves the partial reply with `status: 'stopped'`. The stream starts with a
2 KB comment and sends `: ping` every 15 s, with `X-Accel-Buffering: no`, so proxies don't buffer it.

**Upload limits** (also enforced in the browser): images (PNG, JPEG, WebP, GIF) 10 MB; PDF and documents
(DOC/DOCX/ODT/RTF/PPT/PPTX/XLS/XLSX) 20 MB; text and code files 2 MB; voice notes (from the recorder) 10 MB;
5 files per message; `UPLOAD_QUOTA_MB` per user. The server checks the real file signature, not the extension.

**Modes** are per conversation (`general`, `study`, `developer`, `research`); switching keeps history.

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

**`/browser/fetch` must be SSRF-safe** (docs/decisions/0002 reader mode): http/https only; resolve DNS and refuse
loopback, private (10/8, 172.16/12, 192.168/16, 100.64/10), link-local (169.254/16, incl. cloud metadata),
IPv6 ULA/link-local and mapped addresses; re-check after every redirect (max 5); ports 80/443/8080/8443
only; no credentials in URLs; 2 MB and 10 s caps; strip scripts, styles, iframes, forms and event handlers.
The browser runs the same checks first (`colon-url.js`, unit-tested) and sanitises the HTML again.

**AI Browse** (`colon-saga-browse.js`) runs in the client today: plan → search → open pages → read →
summarise, each step logged and visible. Shared mode asks before every action; *Take control* aborts
the in-flight step at a safe point and re-queues it before handing over; *Stop* cancels for good.

## Testing

```
node scripts/check.js       # syntax, size, API layers, app imports, versions, config (CI)
npm test                    # UI modules + API model router and chat helpers (no database, no network)
```

End-to-end against a real database with the mock AI provider in every model slot (env: `config/e2e.env.example`;
run from `services/api`):

```
node tests/helpers/mock-provider.js 4010 &
set -a; . ../../config/e2e.env.example; set +a; PORT=3100 node app.js &
API=http://localhost:3100 ORIGIN=http://localhost:8080 node tests/e2e/smoke.js
```
