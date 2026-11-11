-- 0001_init: migration bookkeeping table
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  applied_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (id) VALUES ('0001_init');
