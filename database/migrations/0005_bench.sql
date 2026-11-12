-- Colon AI Phase 5: the Colon benchmark. Benchmark runs are stored in eval_runs (the Admin › Evaluation page)
-- with the provider, the suite version, headline numbers and the per-set results, so the model-change gate can
-- check that a model was benchmarked before it goes into routing. New columns and index only.

ALTER TABLE eval_runs
  ADD COLUMN kind           VARCHAR(24)  NOT NULL DEFAULT 'manual',
  ADD COLUMN provider       VARCHAR(32)  NOT NULL DEFAULT '',
  ADD COLUMN suite          VARCHAR(32)  NULL,
  ADD COLUMN items          INT UNSIGNED NULL,
  ADD COLUMN error_rate     DECIMAL(5,3) NULL,
  ADD COLUMN first_token_ms INT UNSIGNED NULL,
  ADD COLUMN details        JSON NULL;

CREATE INDEX eval_runs_model ON eval_runs (provider, model, kind, created_at);
