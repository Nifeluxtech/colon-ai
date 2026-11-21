-- 0018 (v0.24.0): project repositories and archived projects. Additive only.
--
-- colon_projects.archived_at   set when the user archives a project (it leaves the main list; nothing is deleted).
-- colon_projects.repo_*        the code repository connected to a project (modules/repos): the provider (github,
--                              gitlab, bitbucket or git for any https Git URL), owner/name, the clean https URL (never
--                              with credentials), the branch, the commit sha of the last sync and when it ran, how
--                              many files the stored snapshot lists, and the snapshot itself: a chat_attachments row
--                              in the project (meta.format 'zip', meta.source 'repo'), stored like a project .zip.
-- colon_projects.repo_token    the user's read-only access token, encrypted at rest (shared/crypto.js, AES-256-GCM
--                              keyed from APP_SECRET). Never sent to the app, the model or the logs; disconnecting
--                              the repository sets it back to NULL.
ALTER TABLE colon_projects
  ADD COLUMN archived_at        DATETIME(3)  NULL AFTER instructions,
  ADD COLUMN repo_provider      VARCHAR(16)  NULL AFTER archived_at,
  ADD COLUMN repo_owner         VARCHAR(190) NULL AFTER repo_provider,
  ADD COLUMN repo_name          VARCHAR(190) NULL AFTER repo_owner,
  ADD COLUMN repo_url           VARCHAR(500) NULL AFTER repo_name,
  ADD COLUMN repo_branch        VARCHAR(255) NULL AFTER repo_url,
  ADD COLUMN repo_sha           VARCHAR(64)  NULL AFTER repo_branch,
  ADD COLUMN repo_synced_at     DATETIME(3)  NULL AFTER repo_sha,
  ADD COLUMN repo_files         INT UNSIGNED NULL AFTER repo_synced_at,
  ADD COLUMN repo_attachment_id VARCHAR(24)  NULL AFTER repo_files,
  ADD COLUMN repo_token         TEXT         NULL AFTER repo_attachment_id;

INSERT IGNORE INTO schema_migrations (id) VALUES ('0019_project_repos');
