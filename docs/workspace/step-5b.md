# Workspace step 5b: sign-in services and per-user links (v0.30.0)

## What shipped
- **Links**: `https://apparatus.name.ng/<username>/<site>/`. `colon_site_owners` holds one publishing name per
  user (same rules as site names, not reserved, not an existing folder). Folder layout under the publish root:
  `<username>/.colon-user` (owner id), `<username>/<site>/.colon-site` (workspace id). Changing the username
  renames the folder. A pre-0.30.0 site at `<root>/<site>/` turns into a 301 redirect folder on republish and is
  removed on unpublish or delete.
- **Connections**: Data tab › Sign-in & services. Providers and their public fields live in
  `services/api/src/modules/workspace/connect.js` (`PROVIDERS`); private keys (Supabase service_role / sb_secret_,
  `sk_…`, PEM) are refused. The chat prompt gets `recipe()` with CDN imports and auth calls for each connected
  service; a site needing sign-in with nothing connected gets `=== NEEDS: connection <provider>`.
- **Preview**: the bridge script defines in-memory `localStorage`/`sessionStorage` when the sandbox blocks them.
  Firebase Auth may still refuse inside Preview (null origin); test it on the published link.

## Device checklist
1. Publish tab on a new workspace asks for **Your publishing name**; the address preview shows
   `apparatus.name.ng/<name>/…/`. Publish and open the link.
2. A second account can publish a site with the same site name.
3. Republish an older site (published at `/<site>/`): the old link forwards to the new one.
4. Data tab › Sign-in & services › Connect › Supabase: paste URL + anon key. A service_role key is refused.
5. Ask Colon "add login and register pages". It writes them with Supabase; sign up in Preview, then on the live
   link (add the live link to Supabase › Authentication › URL Configuration first).
6. On a workspace with nothing connected, ask for login: a **Connect Supabase** (or similar) card appears.
