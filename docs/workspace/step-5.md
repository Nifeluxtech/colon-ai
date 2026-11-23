# Workspace step 5 — Database and secret keys (v0.29.0, Nov 23, 2026)

Asked for by the user: "Colon should request for database connect for database. Colon should have place for
secret env vars." Sites stay static: no user code runs on the server. Colon's API holds the data and the keys.

## What's in it
- **Data tab** (`apps/chat/src/components/workspace-data.js`, forms in `workspace-data-forms.js`), between Terminal
  and Publish:
  - **Database**: tables of JSON records. "Visitors can read it" / "Visitors can add to it" per table. Tap a table
    to see its records (newest first, Load more, Delete). ⋯ → Who can use it / Delete table.
  - **Secret keys**: name (UPPER_CASE), value (password field, never shown again), API host, sent as Bearer token,
    a header or a URL parameter. ⋯ → Replace or edit / Delete key.
  - **Use in your site**: the `<script>` tag with Copy.
- **Chat**: the model sees table names/rules and key names (never values) plus how to use them
  (`services/api/src/modules/workspace/prompt.js` dataRules). If a build needs something missing it adds
  `=== NEEDS: table <name> read=… add=… -- why` or `=== NEEDS: secret <NAME> host=… as=… -- why`; the chat
  (`apps/chat/src/lib/ws-needs.js`) hides those lines and shows a card (Create / Add key → Done).
- **Site script** `GET /sites/<workspace id>/colon.js` (`modules/workspace/sdk.js`):
  `Colon.data('t').add(obj)`, `.list({limit, before})`, `.page()`, `Colon.call('KEY', '/path', {method, query, body})`.
- **Preview fix**: template code (`${x}`, `{{x}}`, `' + x + '`) and `url(%23id)` are no longer "missing files".

## Server
- Migration `0024_workspace_data` (secrets, collections, records; cascade on workspace delete).
- `modules/workspace/data.js` (engine), `data-store.js` (SQL + memory), `data-handlers.js`, routes in
  `http/routes/workspace.js` (owner) and `http/routes/sites.js` (public).
- Public routes: CORS `*`, no cookies or session read, no CSRF header, per-IP limits (read 600/h, add 60/h,
  call 120/h). `Cross-Origin-Resource-Policy: cross-origin` so the preview iframe (origin null) can load them.
- Limits: 30 keys, 20 tables, 5000 records, 8 KB per record, proxy answer 1 MB, 15 s timeout.
- Proxy safety: https only, the key's own host only (a path can't change it), DNS checked against private,
  loopback, link-local and CGNAT ranges, redirects refused, the key's value masked (••••) in the answer.

## Device checklist
1. Open a workspace → Data tab shows Database, Secret keys, Use in your site.
2. + Table "messages", tick "Visitors can add" → it shows "0 records · Private · visitors add".
3. Chat: "Add a contact form that saves to the messages table" → Preview, submit the form → Data → messages shows
   the record; delete it.
4. Chat: "Show today's weather in Lagos from OpenWeather" → a card "Add the OPENWEATHER_KEY key" appears → Add key
   (host api.openweathermap.org, URL parameter appid) → card shows Done → the preview shows the weather.
5. Publish → the live site's form and weather work the same.
6. ⋯ on the key → Replace or edit: the value field is empty (the key is never shown).
