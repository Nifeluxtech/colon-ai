# Workspace step 1 — shell + storage (v0.25.0, Nov 22, 2026)

## What shipped
- **App** (`apps/chat`): `pages/workspace.js` — list `#/workspace` (search, rows, "New workspace" sheet with
  template cards) and one workspace `#/w/:id` with tabs Chat · Preview · Code · Files · Publish. Files tab: open any
  file (text in a read-only viewer, images shown), History with Restore. Publish tab shows the future address
  `apparatus.name.ng/<name>/`. Chat/Preview/Code are placeholders for steps 2–3. Nav link "Workspace" right after
  Projects (`pages/chat.js`), Settings row after Projects, routes in `main.js`, styles `chat-workspace.css`
  (reuses `px-*` from chat-projects.css), API calls in `core/api-client.js` (`listWorkspaces` … `restoreWorkspace`).
- **API** (`services/api`): `modules/workspace/` — `paths.js` (path/type rules + LIMITS), `templates.js` +
  `starters/<id>/` (blank, portfolio, business, landing; `{{TITLE}}` filled in, HTML-escaped), `store.js` (MySQL +
  in-memory twin), `index.js` (engine), `handlers.js`; routes `http/routes/workspace.js`.
- **DB**: `database/migrations/0020_workspaces.sql` (applied automatically on API boot).
- **Tests**: `services/api/tests/unit/workspace.test.js` (6 tests: paths, templates, CRUD + versions, restore,
  limits, ownership).

## Endpoints (all signed-in, scoped to the user)
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | /workspaces | | workspaces[], templates[], limits |
| POST | /workspaces | { title, template? } | workspace, files[] |
| GET/PATCH/DELETE | /workspaces/:id | PATCH { title } | workspace (+ files[] on GET) |
| GET | /workspaces/:id/bundle | | workspace, files[] with content |
| GET/DELETE | /workspaces/:id/file | ?path= | file with content / { version } |
| PUT | /workspaces/:id/file | { path, content, encoding?, note? } | file, version |
| POST | /workspaces/:id/file/move | { from, to } | version |
| GET | /workspaces/:id/versions | | current, versions[] |
| POST | /workspaces/:id/versions/:n/restore | | version, files[] |

Text files come back `encoding: 'utf8'`, images/fonts `encoding: 'base64'`. Every change adds a version.

## Device test checklist
1. Sidebar shows **Workspace** under Projects (signed in only).
2. New workspace → name + Portfolio → opens on the Chat tab; title shows in the bar.
3. Files tab lists index.html, script.js, style.css; tapping index.html shows the code with your title in it.
4. History shows "Started from the portfolio template" as Current.
5. Rename and Delete from the ⋯ menu work; the list updates.
6. Publish tab shows `apparatus.name.ng/<your-name>/` and "Not published yet".

## For step 2
Use `engine.bundle()` / `writeFile()` / `restore()`; add a workspace chat endpoint that sends the file tree +
relevant files (reuse `modules/developer` relevance) and applies the model's edits through `writeFile` (one version
per reply: add a batch write so one reply = one version).
