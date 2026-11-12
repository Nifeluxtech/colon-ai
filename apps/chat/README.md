# Colon AI — Chat
The Colon AI chat web app (Colon Saga). Deployed to chat.apparatus.name.ng.

ES modules loaded directly by the browser (no build step). The deploy copies `public/` to the document root and
`src/` (with the UI kit) to `/v<version>/` (`scripts/deploy/build-docroot.sh`).

| Path | Purpose |
|---|---|
| `public/index.html` | The page: theme before first paint, versioned CSS and `src/main.js` from `/v<version>/` |
| `public/assets/css/` | `chat-layout.css`, `chat-composer.css`, `chat-responsive.css` (workspace, mobile-first) |
| `public/assets/config/models.json` | Offline stand-in for `GET /models` (Preview only) |
| `src/main.js` | Boot only: loads the UI kit and the workspace, registers routes |
| `src/core/` | `state.js` (shared state), `cw.js` (`window.CW` namespace), `data.js` (**the data adapter**: Remote, Guest and Local Preview; endpoints in `docs/frontend-data-adapters.md`), `api-client.js`, `guest-client.js`, `storage.js` (on-device Preview), `sse.js`, `common.js` |
| `src/pages/` | `chat.js` + `chat-events.js` (the workspace), `history.js` (History, Saved), `explore.js`, `help.js`, `settings.js`, `guest.js` (log-in prompt for guests), `shared.js` (read-only shared chats) |
| `src/components/` | `sidebar.js`, `composer.js`, `model-picker.js`, `message.js`, `sources.js` (Research citations), `uploads.js`, `browser-panel.js` |
| `src/actions/` | `send-message.js` (send, stream, regenerate, stop, edit), `rename.js` (rename, pin, archive, share), `delete.js` |
| `src/lib/` | `media.js` (attachments, voice input), `responder.js` (on-device Preview replies) |

Modules in `pages/`, `components/` and `actions/` import each other; that is safe only while no module uses an
import at top level (see `docs/architecture.md`, "Import-cycle caveat").
