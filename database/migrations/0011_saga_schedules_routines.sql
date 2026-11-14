-- Colon AI 0.11.0: Saga's scheduled browsing, saved routines and mid-task guidance (modules/saga; ADR 0007).
-- saga_schedules: "check yolotask every morning and tell me about new tasks". The server keeps the schedule; at run
--   time it asks the user's phone (over the WebSocket bridge) to run it in that chat's browser. A phone that is not
--   connected runs it when it next connects (late_since). last_items keeps what the last run found, for "new since
--   last run". Nothing about the user's logins is stored here (logins never leave the phone).
-- saga_routines: a task recorded once (its goal and the steps it took, typed personal data hidden) and replayed by
--   name ("post my daily update"); replay re-plans when the page changed and risky steps still need approval.
-- saga_guidance: messages the user sends while a task runs ("use the cheaper one"), read by the worker that runs
--   the task before Saga's next decision.
-- saga_tasks gains schedule_id / routine_id (where a task came from) and speed (speed mode for slow networks).
-- New tables and nullable columns only; everything goes with the account (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS saga_schedules (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  conversation_id VARCHAR(64)  NULL,
  name            VARCHAR(80)  NOT NULL,
  goal            VARCHAR(1000) NOT NULL,
  language        VARCHAR(8)   NOT NULL DEFAULT 'en',
  cadence         VARCHAR(10)  NOT NULL DEFAULT 'daily',
  at_minute       SMALLINT UNSIGNED NOT NULL DEFAULT 480,
  weekday         TINYINT UNSIGNED NULL,
  tz_offset       SMALLINT     NOT NULL DEFAULT 60,
  status          VARCHAR(10)  NOT NULL DEFAULT 'active',
  next_run_at     DATETIME(3)  NOT NULL,
  late_since      DATETIME(3)  NULL,
  last_run_at     DATETIME(3)  NULL,
  last_task_id    BIGINT UNSIGNED NULL,
  last_items      JSON NULL,
  runs            INT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME(3)  NOT NULL,
  updated_at      DATETIME(3)  NOT NULL,
  KEY ix_saga_sched_user (user_id, created_at),
  KEY ix_saga_sched_due (status, next_run_at),
  CONSTRAINT fk_saga_sched_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saga_routines (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(80)  NOT NULL,
  goal        VARCHAR(1000) NOT NULL,
  steps       JSON NULL,
  from_task   BIGINT UNSIGNED NULL,
  runs        INT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_saga_routine_name (user_id, name),
  CONSTRAINT fk_saga_routine_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saga_guidance (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  task_id     BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  text        VARCHAR(500) NOT NULL,
  created_at  DATETIME(3)  NOT NULL,
  taken_at    DATETIME(3)  NULL,
  KEY ix_saga_guidance_task (task_id, id),
  CONSTRAINT fk_saga_guidance_task FOREIGN KEY (task_id) REFERENCES saga_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_saga_guidance_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE saga_tasks
  ADD COLUMN schedule_id BIGINT UNSIGNED NULL AFTER mode,
  ADD COLUMN routine_id  BIGINT UNSIGNED NULL AFTER schedule_id,
  ADD COLUMN speed       TINYINT(1) NOT NULL DEFAULT 0 AFTER routine_id,
  ADD KEY ix_saga_task_schedule (schedule_id);
