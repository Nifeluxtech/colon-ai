-- Colon AI Phase 5: safety layer (services/api/src/modules/safety, docs/decisions/0003-safety-layer.md).
-- One row per thing the safety layer did: an input refused or answered with care, a reply stopped or replaced,
-- an injection attempt neutralised in a web page or file. Never the conversation itself: text_hash (keyed HMAC)
-- or excerpt (first 80 characters) only when SAFETY_LOG_TEXT asks for it. Shown read-only in Admin › Safety.
-- New table only. user_id is cleared when the account is deleted.

CREATE TABLE IF NOT EXISTS safety_events (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id  VARCHAR(128) NOT NULL DEFAULT '',
  stage       VARCHAR(16)  NOT NULL DEFAULT 'input',
  category    VARCHAR(32)  NOT NULL,
  action      VARCHAR(24)  NOT NULL,
  rule        VARCHAR(64)  NULL,
  source      VARCHAR(16)  NOT NULL DEFAULT 'rules',
  route       VARCHAR(64)  NOT NULL DEFAULT '',
  mode        VARCHAR(16)  NOT NULL DEFAULT '',
  language    VARCHAR(8)   NOT NULL DEFAULT '',
  user_id     BIGINT UNSIGNED NULL,
  guest       TINYINT(1)   NOT NULL DEFAULT 0,
  text_hash   CHAR(64)     NULL,
  excerpt     VARCHAR(400) NULL,
  created_at  DATETIME(3)  NOT NULL,
  KEY ix_safety_created (created_at),
  KEY ix_safety_category (category, created_at),
  KEY ix_safety_action (action, created_at),
  CONSTRAINT fk_safety_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
