# Runbook: rollback

Use when a release breaks production. Rolling back means **deploying the previous good commit again**; there is no
separate rollback mechanism.

## Decide quickly

- **Frontend only broken** (API `/health` is fine): roll back the code; old `/v<version>/` folders are still on disk,
  so the previous `index.html` works immediately.
- **API won't start**: read `services/api/stderr.log` first. A configuration error (missing `DB_USER`/`DB_NAME`, a
  non-numeric number) is fixed in Setup Node.js App › Environment variables and a Restart, not a rollback.
- **Migration problem**: migrations are **forward-only**. A rollback of the code does not undo a migration. Old code
  must keep working on the newer schema (migrations only add tables/columns for this reason). If data was damaged,
  restore from backup (`backup-restore.md`) and accept the loss since the dump, or write a new forward migration
  that repairs it.

## Roll back the code

cPanel Git Version Control deploys whatever is checked out, so put the previous commit on the server's clone:

1. Preferred (keeps history honest): on your machine, `git revert <bad commit>` (or `git revert -m 1 <merge>`),
   push to `main`, then cPanel › Git Version Control › **Update from Remote** › **Deploy HEAD Commit**.
2. Faster, over SSH, when you can't push:
   ```sh
   cd /home/apparatu/repositories/colon-ai
   git log --oneline -5                 # find the last good commit
   git checkout <good-commit>           # detached HEAD on the server clone
   ```
   then cPanel › **Deploy HEAD Commit** (do not press Update from Remote, it would move back to `main`). When `main`
   is fixed, `git checkout main` and deploy normally.
3. Setup Node.js App › **Restart**, then verify `/health` as in `deploy.md`.

`build-docroot.sh` rebuilds `v<old version>/` and copies the old `index.html`, which points at it. The newer
`v*` folder stays on disk until pruned; nothing references it.

## After

- Note the request ids (`X-Request-Id`) from failing requests and search `stderr.log` / the API log for `req_id`.
- Add a CHANGELOG line when the fix ships.
