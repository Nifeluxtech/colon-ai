-- 0024 (v0.29.0, Workspace step 5): secrets and a built-in database for each workspace. Additive only.
--
-- colon_workspace_secrets      the site's keys (API keys, tokens), AES-256-GCM encrypted with APP_SECRET
--                              (shared/crypto.js). Never returned to anyone after saving, never written into the
--                              site's files. A published page uses one only through Colon's proxy
--                              (POST /sites/:key/call/:name), which adds it to a request to `host`, sent `as`
--                              'bearer', 'header:<Name>' or 'query:<param>'.
-- colon_workspace_collections  the site's tables. read/add: 'public' (anyone visiting the site) or 'owner'
--                              (only the owner, inside Colon). Changing and deleting records is owner-only.
-- colon_workspace_records      one JSON object per row, up to 8 KB each.
CREATE TABLE IF NOT EXISTS colon_workspace_secrets (
  workspace_id  VARCHAR(24)   NOT NULL,
  name          VARCHAR(64)   NOT NULL,
  value_enc     TEXT          NOT NULL,
  host          VARCHAR(253)  NULL,
  send_as       VARCHAR(80)   NOT NULL DEFAULT 'bearer',
  updated_at    DATETIME(3)   NOT NULL,
  PRIMARY KEY (workspace_id, name),
  CONSTRAINT fk_colon_ws_secrets_ws FOREIGN KEY (workspace_id) REFERENCES colon_workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS colon_workspace_collections (
  workspace_id  VARCHAR(24)   NOT NULL,
  name          VARCHAR(48)   NOT NULL,
  read_rule     VARCHAR(10)   NOT NULL DEFAULT 'owner',
  add_rule      VARCHAR(10)   NOT NULL DEFAULT 'owner',
  created_at    DATETIME(3)   NOT NULL,
  PRIMARY KEY (workspace_id, name),
  CONSTRAINT fk_colon_ws_coll_ws FOREIGN KEY (workspace_id) REFERENCES colon_workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS colon_workspace_records (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id  VARCHAR(24)     NOT NULL,
  collection    VARCHAR(48)     NOT NULL,
  data          MEDIUMTEXT      NOT NULL,
  created_at    DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  KEY ix_colon_ws_records (workspace_id, collection, id),
  CONSTRAINT fk_colon_ws_records_ws FOREIGN KEY (workspace_id) REFERENCES colon_workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (id) VALUES ('0024_workspace_data');
