-- Phase B1: Add format columns to the rounds table.
-- Supports the Game Format Engine (5 formats, locked-at-first-score lifecycle).
-- See ROADMAP.md Phase B (B4.1–B4.4) and GOBS_Game_Rules_v1.pdf §1, §4.
--
-- Rollback:
--   BEGIN;
--   ALTER TABLE rounds
--     DROP CONSTRAINT IF EXISTS rounds_format_check,
--     DROP COLUMN IF EXISTS format_locked_at,
--     DROP COLUMN IF EXISTS format_config,
--     DROP COLUMN IF EXISTS format;
--   COMMIT;

BEGIN;

ALTER TABLE rounds
  ADD COLUMN format           text        NOT NULL DEFAULT '2_ball',
  ADD COLUMN format_config    jsonb       NOT NULL DEFAULT '{"basis":"net","best_n":2,"override_holes":[]}'::jsonb,
  ADD COLUMN format_locked_at timestamptz NULL;

ALTER TABLE rounds
  ADD CONSTRAINT rounds_format_check
  CHECK (format IN ('2_ball', '3_ball', 'stableford_standard', 'stableford_modified', 'gobs_house'));

COMMIT;
