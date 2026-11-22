# Workspace step 4 — Publish (v0.28.0)

Puts a workspace's current files live at `https://apparatus.name.ng/<name>/`. No DNS, subdomain or SSL work: the
main domain's document root already serves HTTPS.

## How it works
- `services/api/src/modules/workspace/publish.js` (createPublisher): `check`, `publish`, `unpublish`, `removeSite`.
- Root: `WORKSPACE_PUBLISH_ROOT` env var, else `~/public_html` (on cPanel `/home/apparatu/public_html`). If the
  folder does not exist the API answers 503 `not_set_up`.
- Names: `^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$`, no `--`, not in RESERVED (chat, api, admin, assets, cgi-bin, …), not
  an existing file or folder in the root unless its `.colon-site` marker holds this workspace's id, and not another
  workspace's `slug` (unique in the database).
- Writing: files go to `<root>/.colon-tmp-<random>/`, then one rename swaps the folder in (the old copy is moved
  aside and deleted). Hidden files are skipped. Each site gets a Colon `.htaccess` (`Options -Indexes -ExecCGI`,
  script handlers removed, `php_flag engine off`, dotfiles denied) and a `.colon-site` marker.
- Each `.html` page gets a small fixed "Made with Colon · Report" badge before `</body>`; Report is a mailto to
  contact@nifelux.com naming the site.
- The workspace row keeps `slug`, `published_version`, `published_at` (columns from migration 0020).
- Renaming a published site (Republish with a new name) removes the old folder. Deleting a workspace removes its
  site.

## API
- `GET /workspaces/:id/publish/check?name=` → `{ name, ok, reason?, url }`
- `POST /workspaces/:id/publish { name }` → `{ name, url, version, at }` (audit `workspace.published`)
- `DELETE /workspaces/:id/publish` → `{ ok }` (audit `workspace.unpublished`)

## App
`apps/chat/src/components/workspace-publish.js`: address field with live check, Publish / Republish, Open, Copy
link, "Changes not live yet" when `version > published_version`, Take down (confirm).

## Device checklist
1. Workspace › Publish: the suggested name is checked ("Available"); a taken/reserved name shows why.
2. Publish → toast "Live at apparatus.name.ng/<name>/"; Open shows the site with the badge at the bottom right.
3. Change something in Chat → Publish tab says "Changes not live yet"; Republish updates the live site.
4. Take down → the link stops working; the files stay in the workspace.
5. A workspace without index.html cannot be published.

## Later (step 5 or after)
Admin take-down from the Admin Dashboard, deploy history, custom domains, preview under the same sub-path.
