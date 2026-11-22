-- 0020 (v0.25.0, Workspace step 1): chat-first website workspaces. Additive only. Plan: docs/workspace/plan.md.
--
-- colon_workspaces          a user's website workspace: a title, the template it started from, the current version
--                           number and, from step 4, its published name (apparatus.name.ng/<slug>/) and version.
-- colon_workspace_files     the workspace's current files: one row per path (text as UTF-8, images and fonts as
--                           bytes). Paths and types are checked in modules/workspace/paths.js.
-- colon_workspace_versions  a snapshot of every file after each change (create, save, rename, delete, restore), so
--                           any version can be restored. Only the newest 20 per workspace are kept.
-- Deleting a user deletes their workspaces, and deleting a workspace deletes its files and versions (CASCADE).
CREATE TABLE IF NOT EXISTS colon_workspaces (
  id                 VARCHAR(24)     NOT NULL PRIMARY KEY,
  user_id            BIGINT UNSIGNED NOT NULL,
  title              VARCHAR(80)     NOT NULL,
  template           VARCHAR(24)     NOT NULL DEFAULT 'blank',
  version            INT UNSIGNED    NOT NULL DEFAULT 0,
  slug               VARCHAR(30)     NULL,
  published_version  INT UNSIGNED    NULL,
  published_at       DATETIME(3)     NULL,
  created_at         DATETIME(3)     NOT NULL,
  updated_at         DATETIME(3)     NOT NULL,
  UNIQUE KEY ux_colon_workspaces_slug (slug),
  KEY ix_colon_workspaces_user (user_id, updated_at),
  CONSTRAINT fk_colon_workspaces_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS colon_workspace_files (
  workspace_id  VARCHAR(24)   NOT NULL,
  path          VARCHAR(200)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mime          VARCHAR(80)   NOT NULL,
  size          INT UNSIGNED  NOT NULL,
  content       MEDIUMBLOB    NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  PRIMARY KEY (workspace_id, path),
  CONSTRAINT fk_colon_ws_files_ws FOREIGN KEY (workspace_id) REFERENCES colon_workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS colon_workspace_versions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id  VARCHAR(24)     NOT NULL,
  n             INT UNSIGNED    NOT NULL,
  note          VARCHAR(200)    NOT NULL,
  files         LONGTEXT        NOT NULL,
  created_at    DATETIME(3)     NOT NULL,
  UNIQUE KEY ux_colon_ws_versions (workspace_id, n),
  CONSTRAINT fk_colon_ws_versions_ws FOREIGN KEY (workspace_id) REFERENCES colon_workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (id) VALUES ('0020_workspaces');
