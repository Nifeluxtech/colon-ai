-- 0029 (v0.37.0, Crash Predictor step 5): auto-bet and the user's own manual bets in crash_bets. Additive only.
-- Plan and rules: docs/crash-predictor/HANDOFF.md. crash_audit (0028) already takes every decision and bet.
--
-- source      who placed the bet: 'auto' (Colon JetX's auto-bet, after POST /crash/autobet allowed it) or 'manual'
--             (the user's own Bet press, seen read-only in the game pane). Existing rows are 'auto'.
-- target      now NULL-able: a manual bet without an auto cash-out has no target, only a cash-out or a loss.
-- cashout     the multiplier a manual bet was cashed out at, when the app saw it.
-- multiplier  the round's crash multiplier the bet was settled against (the next collected round).
-- client_ref  the app's id for the bet, so a retried POST never records it twice (unique per user + game).
ALTER TABLE crash_bets
  ADD COLUMN source VARCHAR(8) NOT NULL DEFAULT 'auto' AFTER game;

ALTER TABLE crash_bets
  MODIFY COLUMN target DECIMAL(6,2) NULL;

ALTER TABLE crash_bets
  ADD COLUMN cashout DECIMAL(10,2) NULL AFTER target;

ALTER TABLE crash_bets
  ADD COLUMN multiplier DECIMAL(10,2) NULL AFTER payout;

ALTER TABLE crash_bets
  ADD COLUMN client_ref VARCHAR(64) NULL AFTER multiplier;

ALTER TABLE crash_bets
  ADD UNIQUE KEY ux_crash_bets_ref (user_id, game, client_ref);

ALTER TABLE crash_bets
  ADD KEY ix_crash_bets_pending (user_id, game, outcome, placed_at);
