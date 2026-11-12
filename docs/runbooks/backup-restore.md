# Runbook: backup and restore

What must survive: the **MariaDB database** (users, sessions, chats, settings, encrypted keys, audit log) and the
**uploads directory** (`UPLOAD_DIR`, `/home/apparatu/colon-uploads`). The code is in Git; secrets are in cPanel
environment variables (keep a copy in the team password manager, never in the repository). Disk is 5 GB, so watch
backup sizes.

## Backups

1. **JetBackup** (host, automatic): full account backups including databases and home files. Restore from cPanel ›
   JetBackup (Database Backups, File Backups). Check its schedule and retention in cPanel; do not rely on it alone.
2. **Nightly mysqldump** (ours, cron). One-time setup over SSH:
   ```sh
   mkdir -p ~/backups/db && chmod 700 ~/backups ~/backups/db
   cat > ~/.my.cnf <<'CNF'
   [client]
   user=<DB_USER>
   password=<DB_PASSWORD>
   CNF
   chmod 600 ~/.my.cnf
   ```
   cPanel › Cron Jobs › add (02:30 every day; keeps 14 days):
   ```sh
   mysqldump --single-transaction --quick --routines <DB_NAME> | gzip > $HOME/backups/db/colon-$(date +\%F).sql.gz && find $HOME/backups/db -name 'colon-*.sql.gz' -mtime +14 -delete
   ```
   `~/backups` is outside every web root. Uploads are covered by JetBackup's file backups.
3. **On demand** (before a migration release or an `APP_SECRET` rotation): run the same `mysqldump` line by hand
   with a descriptive file name.

Off-site: download the latest dump weekly (cPanel File Manager or `scp`) to storage the team controls.

## Restore

1. Put the site in maintenance (Admin › System settings › Maintenance) so nobody writes during the restore.
2. Restore the database, over SSH:
   ```sh
   gunzip -c ~/backups/db/colon-<date>.sql.gz | mysql <DB_NAME>
   ```
   (or cPanel › JetBackup › Database Backups › restore).
3. Uploads, if lost: cPanel › JetBackup › File Backups › restore `colon-uploads`.
4. Setup Node.js App › **Restart**. On boot the API applies any migration newer than the dump (forward-only).
5. Verify `/health`, sign in, open a chat with an attachment; turn maintenance off.

The dump must be restored with the same `APP_SECRET` that was live when it was taken, or 2FA and stored keys are
unreadable (`key-rotation.md`).

## Restore drill (quarterly)

1. cPanel › MySQL Databases: create `apparatu_restoretest` and grant the API user on it.
2. `gunzip -c ~/backups/db/colon-<latest>.sql.gz | mysql apparatu_restoretest`
3. Check: `SELECT id FROM schema_migrations ORDER BY id;` matches production; row counts of `users`,
   `chat_conversations` and `chat_messages` are close to production's.
4. Drop `apparatu_restoretest`. Write the date, dump size and time taken in the team notes.
