-- Colon AI Phase 8: browser session manager (docs/phase8-backend-contract.md §2).
-- One session per user and device: open tabs (never private ones), the active tab and who is in control.
-- browser_devices links each app install (Colon AI, Colon Browser, the two web apps) to the signed-in user;
-- browser_history holds visits only for clients that opt in (web RemoteBrowserData; the phones never upload it).
-- New tables only. Everything goes with the account (ON DELETE CASCADE); idle sessions are pruned after 30 days.

CREATE TABLE IF NOT EXISTS browser_devices (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  device_id    VARCHAR(64)  NOT NULL,
  app          VARCHAR(16)  NOT NULL,
  app_version  VARCHAR(32)  NOT NULL DEFAULT '',
  last_seen_at DATETIME(3)  NOT NULL,
  created_at   DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_browser_device (user_id, device_id, app),
  KEY ix_browser_device_seen (last_seen_at),
  CONSTRAINT fk_browser_device_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS browser_sessions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  device_ref    BIGINT UNSIGNED NOT NULL,
  active_tab_id VARCHAR(40)  NULL,
  control       VARCHAR(8)   NOT NULL DEFAULT 'manual',
  control_owner VARCHAR(8)   NOT NULL DEFAULT 'user',
  paused        TINYINT(1)   NOT NULL DEFAULT 0,
  task          VARCHAR(200) NOT NULL DEFAULT '',
  version       INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at    DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_browser_session_device (device_ref),
  KEY ix_browser_session_user (user_id, updated_at),
  KEY ix_browser_session_updated (updated_at),
  CONSTRAINT fk_browser_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_browser_session_device FOREIGN KEY (device_ref) REFERENCES browser_devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS browser_tabs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  tab_id     VARCHAR(40)   NOT NULL,
  url        VARCHAR(2048) NOT NULL,
  title      VARCHAR(200)  NOT NULL DEFAULT '',
  position   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  nav        JSON NULL,
  updated_at DATETIME(3)   NOT NULL,
  UNIQUE KEY uq_browser_tab (session_id, tab_id),
  CONSTRAINT fk_browser_tab_session FOREIGN KEY (session_id) REFERENCES browser_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS browser_history (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  device_ref BIGINT UNSIGNED NULL,
  url        VARCHAR(2048) NOT NULL,
  title      VARCHAR(200)  NOT NULL DEFAULT '',
  visited_at DATETIME(3)   NOT NULL,
  KEY ix_browser_history_user (user_id, visited_at),
  CONSTRAINT fk_browser_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_browser_history_device FOREIGN KEY (device_ref) REFERENCES browser_devices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
