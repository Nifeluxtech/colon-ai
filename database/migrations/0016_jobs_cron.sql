-- Colon AI 0.16.0: background jobs and the cPanel cron dispatcher (Production Blueprint step C, items 11-13).
-- colon_jobs: one row per unit of background work. A runner (the cron CLI services/api/scripts/cron.js, the API worker
--   that holds a user's phone for Saga jobs, or the optional in-process fallback) claims a small batch with
--   UPDATE ... SET lease_token = <random> WHERE (queued or failed and due) OR (running with an expired lease), then
--   reads its rows back by that token, so two runners never get the same job. complete / fail only touch a row that
--   still carries the runner's token. A failure is retried with exponential backoff (status 'failed', run_at = the
--   retry time) and becomes 'dead' after max_attempts. idempotency_key (UNIQUE, nullable) makes enqueue idempotent;
--   ref names what a job belongs to (e.g. 'saga_schedule:12') so it can be found and cancelled.
-- colon_cron_runs: one row per dispatcher run (start, duration, counts), for Admin > Jobs ("cron last ran ...").
-- Existing active Saga schedules get their next run queued as a job, so nothing is lost on upgrade.
-- New tables only; a user's jobs go with the account (ON DELETE CASCADE). System jobs have no user.

CREATE TABLE IF NOT EXISTS colon_jobs (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  type             VARCHAR(40)  NOT NULL,
  user_id          BIGINT UNSIGNED NULL,
  payload          JSON NULL,
  status           VARCHAR(10)  NOT NULL DEFAULT 'queued',
  run_at           DATETIME(3)  NOT NULL,
  attempts         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts     SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  lease_token      CHAR(32)     NULL,
  lease_until      DATETIME(3)  NULL,
  last_error       VARCHAR(500) NULL,
  idempotency_key  VARCHAR(120) NULL,
  ref              VARCHAR(64)  NULL,
  started_at       DATETIME(3)  NULL,
  finished_at      DATETIME(3)  NULL,
  created_at       DATETIME(3)  NOT NULL,
  updated_at       DATETIME(3)  NOT NULL,
  UNIQUE KEY ux_colon_jobs_key (idempotency_key),
  KEY ix_colon_jobs_due (status, run_at),
  KEY ix_colon_jobs_type (type, status),
  KEY ix_colon_jobs_lease (lease_token),
  KEY ix_colon_jobs_ref (ref, status),
  KEY ix_colon_jobs_user (user_id, status),
  CONSTRAINT fk_colon_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS colon_cron_runs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  runner       VARCHAR(16)  NOT NULL DEFAULT 'cli',
  started_at   DATETIME(3)  NOT NULL,
  finished_at  DATETIME(3)  NOT NULL,
  duration_ms  INT UNSIGNED NOT NULL DEFAULT 0,
  claimed      INT UNSIGNED NOT NULL DEFAULT 0,
  done         INT UNSIGNED NOT NULL DEFAULT 0,
  failed       INT UNSIGNED NOT NULL DEFAULT 0,
  dead         INT UNSIGNED NOT NULL DEFAULT 0,
  error        VARCHAR(300) NULL,
  KEY ix_colon_cron_runs_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO colon_jobs (type, user_id, payload, status, run_at, attempts, max_attempts, idempotency_key, ref,
  created_at, updated_at)
SELECT 'saga.schedule', user_id, JSON_OBJECT('schedule_id', id), 'queued', next_run_at, 0, 3,
  CONCAT('saga.schedule:', id, ':', DATE_FORMAT(next_run_at, '%Y-%m-%dT%H:%i:%s.'),
    LPAD(FLOOR(MICROSECOND(next_run_at) / 1000), 3, '0'), 'Z'),
  CONCAT('saga_schedule:', id), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM saga_schedules WHERE status = 'active';
