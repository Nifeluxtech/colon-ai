-- Colon AI 0.17.0: deep research as a metered background job (Production Blueprint step D, item 16).
-- colon_research_runs: one row per deep research task. The work runs as 'research.step' jobs on colon_jobs (the cPanel
--   cron dispatcher), one bounded step per job run (plan the searches, one search, a few pages read, write the
--   report); after each step the row is saved and the next step's job is queued. The row is the resumable state, so
--   a task survives API restarts and a crashed step is simply run again (hop: the step counter the next job carries;
--   a job whose hop is not the row's is a stale duplicate and does nothing). request_id is the credit reservation
--   (usage_events / credit_ledger) made when the task started, settled when the report is posted and refunded when it
--   fails or is cancelled. message_id is the assistant message the progress and the report are written to.
-- The tool registry (D14) and image generation (D15) need no tables: images are chat_attachments rows, image credits
--   are usage_events under the 'image_credits' feature (the plans' existing image_credits allowance).
-- New table only; a user's runs go with the account (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS colon_research_runs (
  id               VARCHAR(24)  NOT NULL PRIMARY KEY,
  user_id          BIGINT UNSIGNED NOT NULL,
  conversation_id  VARCHAR(24)  NOT NULL,
  message_id       VARCHAR(24)  NOT NULL,
  question         TEXT         NOT NULL,
  language         VARCHAR(8)   NOT NULL DEFAULT 'en',
  status           VARCHAR(12)  NOT NULL DEFAULT 'queued',
  stage            VARCHAR(12)  NOT NULL DEFAULT 'plan',
  steps            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  hop              INT UNSIGNED NOT NULL DEFAULT 0,
  state            JSON NULL,
  request_id       VARCHAR(100) NULL,
  error            VARCHAR(300) NULL,
  created_at       DATETIME(3)  NOT NULL,
  updated_at       DATETIME(3)  NOT NULL,
  finished_at      DATETIME(3)  NULL,
  KEY ix_research_runs_user (user_id, created_at),
  KEY ix_research_runs_conv (conversation_id, created_at),
  KEY ix_research_runs_status (status, updated_at),
  CONSTRAINT fk_research_runs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (id) VALUES ('0017_tools_research');
