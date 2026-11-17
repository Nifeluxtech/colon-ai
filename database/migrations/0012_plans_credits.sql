-- 0012 (v0.12.0, Blueprint step A1): plans, entitlements, subscriptions, credit wallets, the credit ledger and
-- usage events. Additive only. Money is in minor units (kobo); credits are whole numbers.
-- The five plans are seeded with the blueprint's draft quotas (editable later from the Admin Dashboard).
-- Prices stay 0 until Korapay (step A5) is wired; nobody can buy a paid plan before then.

CREATE TABLE IF NOT EXISTS plans (
  code          VARCHAR(20)  NOT NULL PRIMARY KEY,
  name          VARCHAR(60)  NOT NULL,
  price_minor   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  currency      CHAR(3)      NOT NULL DEFAULT 'NGN',
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  sort          INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per plan and feature. limit_value NULL = no monthly cap.
-- Features: ai_credits, image_credits, research_tasks, background_jobs, projects, memory (limit = tier 1..5).
CREATE TABLE IF NOT EXISTS plan_entitlements (
  plan_code     VARCHAR(20)  NOT NULL,
  feature       VARCHAR(40)  NOT NULL,
  enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  limit_value   INT          NULL,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (plan_code, feature),
  CONSTRAINT fk_plan_ent_plan FOREIGN KEY (plan_code) REFERENCES plans(code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A user with no active row is on the Free plan.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id       BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  plan_code     VARCHAR(20)  NOT NULL,
  status        ENUM('active','past_due','cancelled','expired') NOT NULL DEFAULT 'active',
  period_start  DATETIME     NULL,
  period_end    DATETIME     NULL,
  provider      VARCHAR(20)  NULL,
  provider_ref  VARCHAR(100) NULL,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_subscriptions_plan (plan_code, status),
  CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- period = the UTC month the balance belongs to (YYYY-MM). A new month resets it to the plan's credits.
CREATE TABLE IF NOT EXISTS credit_wallets (
  user_id       BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  balance       BIGINT       NOT NULL DEFAULT 0,
  period        CHAR(7)      NOT NULL,
  plan_code     VARCHAR(20)  NOT NULL DEFAULT 'free',
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_credit_wallets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Immutable: rows are only ever inserted. SUM(amount) per user and period equals the wallet balance.
-- kind: grant | expire | usage | settle | refund | promo | adjust
CREATE TABLE IF NOT EXISTS credit_ledger (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ref           VARCHAR(120) NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  amount        BIGINT       NOT NULL,
  balance_after BIGINT       NOT NULL,
  kind          VARCHAR(20)  NOT NULL,
  period        CHAR(7)      NOT NULL,
  description   VARCHAR(255) NOT NULL DEFAULT '',
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_credit_ledger_ref (ref),
  KEY ix_credit_ledger_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per billable request. request_id is the idempotency key: a retry never charges twice.
-- status: reserved -> settled | refunded
CREATE TABLE IF NOT EXISTS usage_events (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id       VARCHAR(100) NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  feature          VARCHAR(40)  NOT NULL,
  mode             VARCHAR(16)  NOT NULL DEFAULT '',
  plan_code        VARCHAR(20)  NOT NULL DEFAULT 'free',
  provider         VARCHAR(32)  NOT NULL DEFAULT '',
  model            VARCHAR(128) NOT NULL DEFAULT '',
  input_tokens     INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens    INT UNSIGNED NOT NULL DEFAULT 0,
  credits_reserved INT UNSIGNED NOT NULL DEFAULT 0,
  credits_charged  INT UNSIGNED NOT NULL DEFAULT 0,
  status           VARCHAR(16)  NOT NULL DEFAULT 'reserved',
  enforced         TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  settled_at       DATETIME(3)  NULL,
  UNIQUE KEY ux_usage_events_request (request_id),
  KEY ix_usage_events_user (user_id, created_at),
  KEY ix_usage_events_feature (feature, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO plans (code, name, price_minor, sort) VALUES
  ('free', 'Free', 0, 0), ('startup', 'Startup', 0, 1), ('pro', 'Pro', 0, 2), ('pro_plus', 'Pro Plus', 0, 3),
  ('max', 'Max', 0, 4);

INSERT IGNORE INTO plan_entitlements (plan_code, feature, limit_value) VALUES
  ('free', 'ai_credits', 100), ('free', 'image_credits', 2), ('free', 'research_tasks', 2),
  ('free', 'background_jobs', 5), ('free', 'projects', 2), ('free', 'memory', 1),
  ('startup', 'ai_credits', 600), ('startup', 'image_credits', 10), ('startup', 'research_tasks', 10),
  ('startup', 'background_jobs', 25), ('startup', 'projects', 5), ('startup', 'memory', 2),
  ('pro', 'ai_credits', 2000), ('pro', 'image_credits', 40), ('pro', 'research_tasks', 40),
  ('pro', 'background_jobs', 100), ('pro', 'projects', 15), ('pro', 'memory', 3),
  ('pro_plus', 'ai_credits', 5000), ('pro_plus', 'image_credits', 100), ('pro_plus', 'research_tasks', 100),
  ('pro_plus', 'background_jobs', 300), ('pro_plus', 'projects', 30), ('pro_plus', 'memory', 4),
  ('max', 'ai_credits', 12000), ('max', 'image_credits', 250), ('max', 'research_tasks', 250),
  ('max', 'background_jobs', 1000), ('max', 'projects', 100), ('max', 'memory', 5);

INSERT IGNORE INTO schema_migrations (id) VALUES ('0012_plans_credits');
