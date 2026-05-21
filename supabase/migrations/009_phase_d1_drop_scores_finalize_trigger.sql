-- Phase D.1 follow-up: replace DB-level finalize lock with UI-level lock.
--
-- The trigger added in migration 008 (scores_reject_on_complete) is too
-- blunt — it blocks legitimate admin score corrections after blind-draw
-- firing. Score-write locking moves entirely to the scorecard UI:
-- finalized rounds are read-only by default; admin unlocks edit mode via
-- the ?admin=1 URL flag + DangerModal confirm.
--
-- Rollback: re-create from migration 008 lines 75-98 (function
-- reject_scores_on_complete_round + trigger scores_reject_on_complete).

DROP TRIGGER IF EXISTS scores_reject_on_complete ON scores;
DROP FUNCTION IF EXISTS reject_scores_on_complete_round();
