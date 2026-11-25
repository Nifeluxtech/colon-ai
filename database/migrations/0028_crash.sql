-- 0028 (v0.33.0, Crash Predictor step 1): JetX companion accounts and dashboard. Additive only.
-- Plan and rules: docs/crash-predictor/HANDOFF.md. Every table is per user; deleting a user deletes their rows.
--
-- crash_settings  one row per user: target auto cash-out (default 1.30x), stake, currency, demo mode (ON by default),
--                 guardrails (stake cap, per-session stop-loss, daily loss limit, max bets per session, kill switch)
--                 and the betting site the user opens and signs in to themselves (never their gaming password).
-- crash_sessions  a betting session (demo or real money); ended_at NULL while it is open.
-- crash_rounds    finished rounds seen by the feed, the in-browser collector or a CSV import. game keeps JetX apart
--                 from other games; one row per user + game + round id (duplicates are ignored).
-- crash_bets      every bet the user or the auto-bet placed: stake, target, outcome, payout, demo flag.
-- crash_audit     every settings change and guardrail event, with its details as JSON.
CREATE TABLE IF NOT EXISTS crash_settings (
  user_id               BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  target_cashout        DECIMAL(6,2)    NOT NULL DEFAULT 1.30,
  stake                 DECIMAL(12,2)   NOT NULL DEFAULT 100.00,
  currency              CHAR(3)         NOT NULL DEFAULT 'NGN',
  demo_mode             TINYINT(1)      NOT NULL DEFAULT 1,
  stake_cap             DECIMAL(12,2)   NOT NULL DEFAULT 1000.00,
  stop_loss             DECIMAL(12,2)   NOT NULL DEFAULT 2000.00,
  daily_loss_limit      DECIMAL(12,2)   NOT NULL DEFAULT 5000.00,
  max_bets_per_session  INT UNSIGNED    NOT NULL DEFAULT 20,
  kill_switch           TINYINT(1)      NOT NULL DEFAULT 0,
  site_url              VARCHAR(500)    NULL,
  real_money_ack_at     DATETIME(3)     NULL,
  created_at            DATETIME(3)     NOT NULL,
  updated_at            DATETIME(3)     NOT NULL,
  CONSTRAINT fk_crash_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crash_sessions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  game        VARCHAR(16)     NOT NULL DEFAULT 'jetx',
  demo        TINYINT(1)      NOT NULL DEFAULT 1,
  started_at  DATETIME(3)     NOT NULL,
  ended_at    DATETIME(3)     NULL,
  end_reason  VARCHAR(40)     NULL,
  KEY ix_crash_sessions_user (user_id, game, started_at),
  CONSTRAINT fk_crash_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crash_rounds (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  game         VARCHAR(16)     NOT NULL DEFAULT 'jetx',
  round_id     VARCHAR(64)     NOT NULL,
  multiplier   DECIMAL(10,2)   NOT NULL,
  observed_at  DATETIME(3)     NOT NULL,
  source       VARCHAR(16)     NOT NULL DEFAULT 'collector',
  created_at   DATETIME(3)     NOT NULL,
  UNIQUE KEY ux_crash_rounds_round (user_id, game, round_id),
  KEY ix_crash_rounds_time (user_id, game, observed_at),
  CONSTRAINT fk_crash_rounds_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crash_bets (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  session_id  BIGINT UNSIGNED NULL,
  round_id    BIGINT UNSIGNED NULL,
  game        VARCHAR(16)     NOT NULL DEFAULT 'jetx',
  stake       DECIMAL(12,2)   NOT NULL,
  target      DECIMAL(6,2)    NOT NULL,
  outcome     VARCHAR(8)      NOT NULL DEFAULT 'pending',
  payout      DECIMAL(14,2)   NOT NULL DEFAULT 0.00,
  demo        TINYINT(1)      NOT NULL DEFAULT 1,
  placed_at   DATETIME(3)     NOT NULL,
  settled_at  DATETIME(3)     NULL,
  KEY ix_crash_bets_user (user_id, game, placed_at),
  KEY ix_crash_bets_session (session_id),
  CONSTRAINT fk_crash_bets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_crash_bets_session FOREIGN KEY (session_id) REFERENCES crash_sessions(id) ON DELETE SET NULL,
  CONSTRAINT fk_crash_bets_round FOREIGN KEY (round_id) REFERENCES crash_rounds(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crash_audit (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  event       VARCHAR(48)     NOT NULL,
  details     JSON            NULL,
  ip          VARCHAR(64)     NOT NULL DEFAULT '',
  created_at  DATETIME(3)     NOT NULL,
  KEY ix_crash_audit_user (user_id, created_at),
  CONSTRAINT fk_crash_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
