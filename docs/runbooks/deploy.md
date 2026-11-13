# Runbook: deploy

Production is one cPanel account (AfeesHost cPanel 138, CloudLinux: 1 GB RAM, 20 entry processes, 5 GB disk, SSH,
Git Version Control, cron, JetBackup; no browser terminal). The repository is cloned at
`/home/apparatu/repositories/colon-ai`. The API runs in place from `services/api` under Setup Node.js App
(Passenger); each web app is built into its subdomain document root by `scripts/deploy/build-docroot.sh`.

## Before you deploy

1. `main` is green in CI (`node scripts/check.js`, `npm test`).
2. The version in the root `package.json` was bumped if any frontend file changed (check.js keeps `index.html`,
   `Colon.version` and every `package.json` on the same version). A new version means a new `/v<version>/` folder,
   so phones never mix old and new modules.
3. Read the new migrations in `database/migrations/`. They run by themselves when the API starts and are
   **forward-only**: there is no down migration (see `rollback.md`).
4. New environment variables are in `config/api.env.example` and `config/README.md`. Add them in cPanel **before**
   restarting: the API refuses to start in production without `DB_USER`/`DB_NAME` or with a non-numeric value in a
   numeric key.
5. For a release with migrations, take a database dump first (`backup-restore.md`, "On demand").

## Deploy

1. cPanel › **Git Version Control** › Manage (colon-ai) › **Pull or Deploy** › **Update from Remote**.
   Check that "HEAD Commit" shows the commit you expect.
2. **Deploy HEAD Commit**. `.cpanel.yml` runs, for chat, browser and admin:
   `/bin/sh scripts/deploy/build-docroot.sh <repo> <app> /home/apparatu/<app>.apparatus.name.ng`.
   It copies the versioned modules to `<docroot>/v<version>/` first (built beside the live folder and swapped in),
   refreshes the `/brand/` and `/ui/fonts/` mirrors, and copies `index.html` and `assets/` **last**. It never
   writes `.htaccess`. It then touches `services/api/tmp/restart.txt`.
3. cPanel › **Setup Node.js App** › the API app › **Restart**. Press "Run NPM Install" only when
   `services/api/package.json` dependencies changed.
4. **Verify**:
   - `https://api.apparatus.name.ng/health` returns `status: ok`, `database.ok: true`, `database.migrations` ending
     with the newest migration, `ai.configured: true` with the expected providers, `two_factor: true`.
   - The response has an `X-Request-Id` header.
   - If the API does not come up, read `services/api/stderr.log` (a configuration error lists every bad variable).
   - Open chat, browser and admin on a phone: the page source loads from `/v<new version>/`; send one guest message
     and one Research-mode message; sign in to admin (2FA).
5. **Prune** old frontend versions once the new one has been live for a day (keep the previous one for rollback):
   ```sh
   # over SSH; lists, then removes, every v* folder except the two newest
   for d in chat browser admin; do
     cd /home/apparatu/$d.apparatus.name.ng && ls -d v*/ | sort -V | head -n -2 | xargs -r rm -rf
   done
   ```
   Disk is 5 GB: each version folder is a few MB per app, so prune at least every few releases.

## Release notes

### 0.10.0 (Phase 10: one browser per chat)

- **Migration `0010_chat_browser_sessions.sql` runs by itself when the API starts** (adds
  `browser_sessions.conversation_id` and moves its unique key to device + conversation, `chat_conversations.
  browser_mode`, `saga_tasks.mode`). Existing sessions become the device-wide session (`conversation_id = ''`), so
  Colon Browser and older apps keep working. Take a database dump first (step 5 above). After the restart,
  `/health` `database.migrations` should end with `0010_chat_browser_sessions`.
- **Optional env key `SAGA_HANDOFF_TIMEOUT_MS`** (default `600000`, 10 minutes): how long Saga waits for the user to
  type a password, code or card details and tap Return to AI. Nothing to add unless you want another value.
- New APKs for both apps (versionCode 1000); `apps/chat/public/android/version.json` points at the `v0.10.0`
  GitHub release, so publish the release (Android workflow) before or together with this deploy.

## The `.htaccess` file

Each document root has a server-only `.htaccess` (gitignored; the deploy refuses a repo copy and never overwrites
it). It must send `Cache-Control: no-cache` for `index.html`, so phones always fetch the page that names the newest
`/v<version>/` folder; versioned files can be cached for a long time. Minimal content:

```apache
<Files "index.html">
  Header set Cache-Control "no-cache"
</Files>
```

Merge it with anything cPanel already wrote there (HTTPS redirects, PHP handlers). Do not enable `mod_deflate` for
`text/event-stream` on the API subdomain, or chat replies arrive all at once.
