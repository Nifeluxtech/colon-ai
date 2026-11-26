-- Colon AI 0.40.0: send-only Gmail. One connection per user; the refresh token is encrypted with APP_SECRET
-- (AES-256-GCM, shared/crypto.js). Colon never reads the mailbox (scope gmail.send only).

CREATE TABLE IF NOT EXISTS colon_gmail (
  user_id     BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  email       VARCHAR(190)    NULL,
  token       TEXT            NOT NULL,
  created_at  DATETIME(3)     NOT NULL,
  CONSTRAINT fk_colon_gmail_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
