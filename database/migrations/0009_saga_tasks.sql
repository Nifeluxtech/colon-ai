-- Colon AI Phase 9: Saga browser automation (services/api/src/modules/saga, docs/android-bridge.md).
-- saga_tasks: one row per browsing task (the user's goal, where it stands, Saga's answer and the pages it cited).
-- saga_actions: every step Saga took, in order: what it said it was doing, the command and its arguments (typed
-- personal data hidden), whether the phone asked for and got the user's approval, and the result. Together they
-- are the audit log and the replay that users (their own tasks) and admins (Admin › Browser) can read. Page text
-- is never stored. New tables only; everything goes with the account (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS saga_tasks (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  device_ref      BIGINT UNSIGNED NULL,
  conversation_id VARCHAR(64)  NULL,
  goal            VARCHAR(1000) NOT NULL,
  language        VARCHAR(8)   NOT NULL DEFAULT 'en',
  status          VARCHAR(16)  NOT NULL DEFAULT 'queued',
  error           VARCHAR(40)  NULL,
  steps           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  answer          TEXT NULL,
  sources         JSON NULL,
  worker          VARCHAR(64)  NULL,
  stop_requested  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      DATETIME(3)  NOT NULL,
  updated_at      DATETIME(3)  NOT NULL,
  finished_at     DATETIME(3)  NULL,
  KEY ix_saga_task_user (user_id, created_at),
  KEY ix_saga_task_status (status, created_at),
  CONSTRAINT fk_saga_task_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_saga_task_device FOREIGN KEY (device_ref) REFERENCES browser_devices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saga_actions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  task_id     BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  seq         SMALLINT UNSIGNED NOT NULL,
  kind        VARCHAR(12)  NOT NULL,
  tool        VARCHAR(20)  NULL,
  command     VARCHAR(20)  NULL,
  say         VARCHAR(300) NULL,
  args        JSON NULL,
  approval    VARCHAR(20)  NULL,
  approved    VARCHAR(10)  NULL,
  ok          TINYINT(1)   NULL,
  error       VARCHAR(40)  NULL,
  url         VARCHAR(2048) NULL,
  title       VARCHAR(200) NULL,
  page        SMALLINT UNSIGNED NULL,
  ms          INT UNSIGNED NULL,
  created_at  DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_saga_action (task_id, seq),
  CONSTRAINT fk_saga_action_task FOREIGN KEY (task_id) REFERENCES saga_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_saga_action_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
