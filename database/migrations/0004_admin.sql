-- 0004_admin: Admin Dashboard (Phase 4). Live platform settings, providers and models with encrypted keys,
-- AI call log for the overview, per-user limits, suspensions, moderation queue, evaluation runs and the
-- African AI registry. New tables only (no ALTER), so a half-applied run can simply be re-run.
CREATE TABLE IF NOT EXISTS app_settings (
  k          VARCHAR(64) NOT NULL PRIMARY KEY,
  v          MEDIUMTEXT NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_providers (
  id          VARCHAR(32)  NOT NULL PRIMARY KEY,
  name        VARCHAR(80)  NOT NULL,
  base_url    VARCHAR(255) NOT NULL DEFAULT '',
  native      VARCHAR(16)  NOT NULL DEFAULT '',
  api_key_enc TEXT NULL,
  key_last4   VARCHAR(4) NULL,
  enabled     TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_models (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  target      VARCHAR(32)  NOT NULL,
  provider_id VARCHAR(32)  NOT NULL,
  model       VARCHAR(128) NOT NULL,
  vision      TINYINT(1) NOT NULL DEFAULT 0,
  body        TEXT NULL,
  enabled     TINYINT(1) NOT NULL DEFAULT 1,
  priority    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_ai_models_target (target, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_calls (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id  CHAR(16)     NOT NULL,
  mode        VARCHAR(16)  NOT NULL DEFAULT '',
  route       VARCHAR(16)  NOT NULL DEFAULT '',
  provider    VARCHAR(32)  NOT NULL DEFAULT '',
  model       VARCHAR(128) NOT NULL DEFAULT '',
  ok          TINYINT(1)   NOT NULL DEFAULT 0,
  code        VARCHAR(32)  NULL,
  http_status SMALLINT     NULL,
  ms          INT          NOT NULL DEFAULT 0,
  guest       TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL,
  KEY ix_ai_calls_created (created_at),
  KEY ix_ai_calls_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_limits (
  user_id     BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  daily_limit INT NOT NULL,
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_limits_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_suspensions (
  user_id      BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  reason       VARCHAR(500) NOT NULL DEFAULT '',
  suspended_by BIGINT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_susp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS moderation_reports (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind            ENUM('feedback','share') NOT NULL,
  source_id       VARCHAR(64) NOT NULL,
  conversation_id VARCHAR(24) NULL,
  reporter_id     BIGINT UNSIGNED NULL,
  reason          VARCHAR(64) NULL,
  comment         VARCHAR(1000) NULL,
  status          ENUM('open','resolved','dismissed') NOT NULL DEFAULT 'open',
  note            VARCHAR(500) NULL,
  resolved_by     BIGINT UNSIGNED NULL,
  resolved_at     DATETIME NULL,
  created_at      DATETIME(3) NOT NULL,
  UNIQUE KEY uq_mod_source (kind, source_id),
  KEY ix_mod_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eval_runs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  model      VARCHAR(128) NOT NULL DEFAULT '',
  status     ENUM('planned','running','done','failed') NOT NULL DEFAULT 'planned',
  score      DECIMAL(6,2) NULL,
  notes      VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS african_registry (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind        ENUM('model','dataset') NOT NULL,
  name        VARCHAR(120) NOT NULL,
  languages   VARCHAR(200) NOT NULL DEFAULT '',
  licence     VARCHAR(80)  NOT NULL DEFAULT '',
  licence_url VARCHAR(500) NOT NULL DEFAULT '',
  source_url  VARCHAR(500) NOT NULL DEFAULT '',
  commercial  ENUM('yes','no','unknown') NOT NULL DEFAULT 'unknown',
  status      ENUM('candidate','approved','in_use','rejected') NOT NULL DEFAULT 'candidate',
  notes       VARCHAR(1000) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (id) VALUES ('0004_admin');
