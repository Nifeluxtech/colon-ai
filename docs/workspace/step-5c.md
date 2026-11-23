# Workspace step 5c (v0.31.0): one Code tab, server access to databases, GitHub and Bitbucket

User's requests (Nov 23, 2026): Colon should work in the connected database and save changes; connect GitHub and
Bitbucket so Colon can save files, commit, push and merge; merge Files, Code and Terminal into one IDE-style tab
with real folders; fix Preview's "Please refresh". Decisions: connections are per workspace; Colon may push and
merge; Supabase uses the service_role key (schema changes only with an optional personal access token); Colon may
change data but never drops a table or deletes every row unless the user's message asks.

## Code tab (apps/chat)
- `components/workspace-ide.js` (layout, toolbar: Files, Save, Run, Shell), `workspace-ide-tree.js` (tree, file
  and folder actions, History), `workspace-ide-editor.js` (tabs, Monaco or textarea), `workspace-term.js` (Shell).
- `lib/ws-tree.js`: pure tree helpers (tested). Empty folders are `<folder>/.gitkeep` (paths.js allows that name
  only as the last part of a path inside a folder).
- API: `POST /workspaces/:id/folder/move { from, to }`, `DELETE /workspaces/:id/folder?path=` (one version each).
- ≥900px: Files | editor | Shell columns. Phones: editor full height, Files drawer (82%, max 300px), Shell
  bottom panel (42%). The Shell's open/closed state is remembered (localStorage `colon.ide`).

## Server access (services/api/src/modules/workspace)
- `connect.js`: each provider has `kind` (db, auth, git) and optional `server` fields; `cleanServer()` validates
  them and keeps saved values when a field is left empty. `data.js` encrypts them (APP_SECRET, AES-256-GCM) into
  `colon_workspace_connections.secret_enc` and exposes only `server: true|false`.
- `remote/`: `http.js` (https only, DNS-checked public hosts, no redirects, 20 s, 5 MB), `supabase.js` (PostgREST +
  Management API SQL), `firebase.js` (service-account JWT + Firestore REST), `appwrite.js`, `pocketbase.js`,
  `index.js` (ops + destructive guard).
- `git/`: `github.js` (Git Data API, pulls, merges), `bitbucket.js` (src multipart, pull requests), `index.js`
  (folder prefix, deletions from the last push's path list in `state`).
- Routes: `GET /workspaces/:id/remote/:provider/tables|rows?table=`, `GET /workspaces/:id/git/:provider/pulls`,
  `POST /workspaces/:id/git/:provider/commit|pulls|merge`.
- `tools.js`: `=== DB / SQL / COMMIT / PR / MERGE` blocks, ≤3 extra model rounds for read-only replies; writes and
  Git run after the file changes are saved; outcomes become build steps and lines in Colon's reply.

## Preview
- `lib/ws-site.js`: non-file references are blanked (a srcdoc page would load them from Colon's own address),
  relative module imports become data: modules, and a copy of Colon's app page shows a notice instead of "Please
  refresh".

## Device checklist (Infinix SMART 20, 360 px)
- [ ] Code tab: open Files drawer, create a folder and a file inside it, rename and move the folder, delete it,
      restore from History.
- [ ] Open three files as tabs, edit, unsaved dot, Save; Run opens Preview on the current page.
- [ ] Shell opens at the bottom, `ls`, `node -e "console.log(1)"`, keyboard doesn't hide the input.
- [ ] Data → Connect → GitHub with a fine-grained token; Push; see the commit on GitHub; open a PR; Merge.
- [ ] Bitbucket with an API token + email; Push; Merge a branch.
- [ ] Supabase with service_role key: tables listed with row counts; browse rows; ask Chat "add a product row".
- [ ] Ask Chat "delete all orders" vs "delete order 5": only the explicit one may clear the table.
- [ ] A workspace whose index.html is Colon's own page: Preview shows the notice, not "Please refresh".
