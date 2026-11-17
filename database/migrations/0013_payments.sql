-- 0013 (v0.13.0, Blueprint step A5): Korapay payments for plan upgrades. Additive only.
-- One row per checkout. reference is ours (sent to Korapay) and is the idempotency key: a payment is applied once,
-- whether the webhook, the return page or both confirm it. Money is in minor units (kobo).
-- status: pending -> success | failed | abandoned
CREATE TABLE IF NOT EXISTS payments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reference     VARCHAR(64)  NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  plan_code     VARCHAR(20)  NOT NULL,
  amount_minor  BIGINT UNSIGNED NOT NULL,
  currency      CHAR(3)      NOT NULL DEFAULT 'NGN',
  provider      VARCHAR(20)  NOT NULL DEFAULT 'korapay',
  status        VARCHAR(16)  NOT NULL DEFAULT 'pending',
  checkout_url  VARCHAR(500) NULL,
  method        VARCHAR(32)  NULL,
  fee_minor     BIGINT UNSIGNED NULL,
  failure       VARCHAR(255) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  paid_at       DATETIME(3)  NULL,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_payments_reference (reference),
  KEY ix_payments_user (user_id, created_at),
  KEY ix_payments_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every webhook Korapay sends, signature-checked or not, for audit and replay protection.
CREATE TABLE IF NOT EXISTS payment_events (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider      VARCHAR(20)  NOT NULL DEFAULT 'korapay',
  event         VARCHAR(40)  NOT NULL,
  reference     VARCHAR(64)  NOT NULL DEFAULT '',
  signature_ok  TINYINT(1)   NOT NULL DEFAULT 0,
  outcome       VARCHAR(40)  NOT NULL DEFAULT '',
  payload       TEXT         NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_payment_events_ref (reference, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Monthly prices in kobo (user, 2026-11-17). Only fills plans still at 0, so later admin edits stay.
UPDATE plans SET price_minor = 700000    WHERE code = 'startup'  AND price_minor = 0;
UPDATE plans SET price_minor = 2100000   WHERE code = 'pro'      AND price_minor = 0;
UPDATE plans SET price_minor = 5300000   WHERE code = 'pro_plus' AND price_minor = 0;
UPDATE plans SET price_minor = 12500000  WHERE code = 'max'      AND price_minor = 0;

INSERT IGNORE INTO schema_migrations (id) VALUES ('0013_payments');
