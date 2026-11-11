-- 0003_chat: Colon AI chat (conversations, messages, uploads, feedback, chat settings, daily usage)
CREATE TABLE IF NOT EXISTS chat_conversations (
  id           VARCHAR(24)  NOT NULL PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  title        VARCHAR(120) NOT NULL DEFAULT 'New chat',
  mode         ENUM('general','study','developer','research') NOT NULL DEFAULT 'general',
  model        VARCHAR(64)  NULL,
  pinned       TINYINT(1)   NOT NULL DEFAULT 0,
  archived     TINYINT(1)   NOT NULL DEFAULT 0,
  preview      VARCHAR(160) NOT NULL DEFAULT '',
  share_token  CHAR(32)     NULL,
  shared_at    DATETIME     NULL,
  created_at   DATETIME(3)  NOT NULL,
  updated_at   DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_chat_conv_share (share_token),
  KEY ix_chat_conv_user (user_id, archived, updated_at),
  CONSTRAINT fk_chat_conv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id              VARCHAR(24) NOT NULL PRIMARY KEY,
  seq             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id VARCHAR(24) NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  role            ENUM('user','assistant','event') NOT NULL,
  content         MEDIUMTEXT NOT NULL,
  attachments     JSON NULL,
  sources         JSON NULL,
  status          ENUM('complete','streaming','stopped','error') NOT NULL DEFAULT 'complete',
  error           JSON NULL,
  mode            VARCHAR(16) NULL,
  model           VARCHAR(64) NULL,
  provider        VARCHAR(32) NULL,
  provider_model  VARCHAR(128) NULL,
  origin          VARCHAR(16) NULL,
  version         INT NOT NULL DEFAULT 1,
  created_at      DATETIME(3) NOT NULL,
  completed_at    DATETIME(3) NULL,
  UNIQUE KEY uq_chat_msg_seq (seq),
  KEY ix_chat_msg_conv (conversation_id, seq),
  CONSTRAINT fk_chat_msg_conv FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_attachments (
  id              VARCHAR(24) NOT NULL PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  conversation_id VARCHAR(24) NULL,
  message_id      VARCHAR(24) NULL,
  name            VARCHAR(190) NOT NULL,
  mime            VARCHAR(120) NOT NULL,
  size            INT UNSIGNED NOT NULL,
  kind            ENUM('image','pdf','doc','text','audio') NOT NULL,
  path            VARCHAR(255) NOT NULL,
  text            MEDIUMTEXT NULL,
  meta            JSON NULL,
  created_at      DATETIME(3) NOT NULL,
  KEY ix_chat_att_user (user_id, created_at),
  KEY ix_chat_att_msg (message_id),
  CONSTRAINT fk_chat_att_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_feedback (
  message_id      VARCHAR(24) NOT NULL PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  conversation_id VARCHAR(24) NOT NULL,
  rating          ENUM('up','down') NOT NULL,
  reason          VARCHAR(64) NULL,
  comment         VARCHAR(1000) NULL,
  mode            VARCHAR(16) NULL,
  provider        VARCHAR(32) NULL,
  provider_model  VARCHAR(128) NULL,
  shareable       TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME(3) NOT NULL,
  updated_at      DATETIME(3) NOT NULL,
  KEY ix_chat_fb_rating (rating, created_at),
  CONSTRAINT fk_chat_fb_msg FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_settings (
  user_id    BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  settings   JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_usage (
  subject  VARCHAR(80) NOT NULL,
  day      DATE NOT NULL,
  requests INT NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, day),
  KEY ix_chat_usage_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (id) VALUES ('0003_chat');
