-- 0014 (v0.14.0, Blueprint step A6): cost visibility. Additive only.
-- Every AI provider attempt in ai_calls now records who asked (user_id, NULL for guests), the plan they were on
-- (plan_code, '' when unknown or staff), the tokens the provider reported and the cost in KOBO.
-- cost_minor is DECIMAL(14,4): one call usually costs a fraction of a kobo. Prices come from AI_MODEL_COSTS
-- (kobo per 1M tokens), and are 0 for every model until configured (the free tiers in use today).
-- Older rows keep the defaults (no user, 0 tokens, 0 cost). One statement, so a failed run leaves nothing half done.
ALTER TABLE ai_calls
  ADD COLUMN user_id       BIGINT UNSIGNED NULL AFTER guest,
  ADD COLUMN plan_code     VARCHAR(20)   NOT NULL DEFAULT '' AFTER user_id,
  ADD COLUMN input_tokens  INT UNSIGNED  NOT NULL DEFAULT 0 AFTER plan_code,
  ADD COLUMN output_tokens INT UNSIGNED  NOT NULL DEFAULT 0 AFTER input_tokens,
  ADD COLUMN cost_minor    DECIMAL(14,4) NOT NULL DEFAULT 0 AFTER output_tokens,
  ADD KEY ix_ai_calls_user (user_id, created_at);

-- credit_ledger kinds now also include 'revoke' (manual removal from Admin > Credits). created_by = the admin.

INSERT IGNORE INTO schema_migrations (id) VALUES ('0014_admin_billing');
