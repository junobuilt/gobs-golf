-- Phase A.1: Rebalance the rounds.format CHECK constraint to the new format set.
-- See ROADMAP.md Phase A.1 (A1.2, A1.4) and the May 9/10 feedback sessions.
--
-- New enum (post-2026-05-10):
--   - 2_ball
--   - 3_ball
--   - best_ball                  (new, A1.2)
--   - stableford_standard
--   - gobs_stableford            (renamed from stableford_modified, A1.1)
--
-- Dropped enum values:
--   - gobs_house                 (A1.4 — feature retired)
--   - stableford_modified        (renamed to gobs_stableford, A1.1)
--
-- Pre-migration safety check performed 2026-05-10: the rounds table contained
-- zero rows with format in ('gobs_house', 'stableford_modified'). Only 2 rows
-- existed, both '2_ball'. No data migration is required, just the constraint
-- swap and an UPDATE to catch any stableford_modified row that might land
-- between this comment being written and the migration being applied.
--
-- Rollback (if pre-2026-05-10 enum needed):
--   BEGIN;
--   ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_format_check;
--   UPDATE rounds SET format = 'stableford_modified' WHERE format = 'gobs_stableford';
--   ALTER TABLE rounds ADD CONSTRAINT rounds_format_check
--     CHECK (format IN ('2_ball', '3_ball', 'stableford_standard', 'stableford_modified', 'gobs_house'));
--   COMMIT;

BEGIN;

-- Drop the old CHECK so the rename UPDATE can proceed without tripping it.
ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_format_check;

-- Rename any existing stableford_modified rows to gobs_stableford. No rows are
-- expected (verified 2026-05-10), but the statement is idempotent and cheap.
UPDATE rounds SET format = 'gobs_stableford' WHERE format = 'stableford_modified';

-- Re-add the CHECK with the new enum set.
ALTER TABLE rounds
  ADD CONSTRAINT rounds_format_check
  CHECK (format IN ('2_ball', '3_ball', 'best_ball', 'stableford_standard', 'gobs_stableford'));

COMMIT;
