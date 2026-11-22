-- 0021 (v0.26.0, Workspace step 2): the Workspace chat, where the user describes the site and Colon edits its files.
-- Additive only. Plan: docs/workspace/plan.md.
--
-- colon_workspace_messages  one row per chat message. role 'user' is what the user asked; role 'assistant' is
--                           Colon's reply with the files it changed (changes: JSON [{ op, path }]) and the version
--                           numbers before and after, so the reply's Undo restores version_before. A failed reply is
--                           an assistant row with error = 1. Deleting the workspace deletes its messages (CASCADE).
CREATE TABLE IF NOT EXISTS colon_workspace_messages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id    VARCHAR(24)     NOT NULL,
  role            VARCHAR(10)     NOT NULL,
  content         TEXT            NOT NULL,
  changes         TEXT            NULL,
  version_before  INT UNSIGNED    NULL,
  version_after   INT UNSIGNED    NULL,
  error           TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      DATETIME(3)     NOT NULL,
  KEY ix_colon_workspace_messages_ws (workspace_id, id),
  CONSTRAINT fk_colon_workspace_messages_ws FOREIGN KEY (workspace_id) REFERENCES colon_workspaces(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (id) VALUES ('0021_workspace_chat');
