-- Phase B1.5: Drop DEFAULT and NOT NULL on rounds.format.
-- Every round must now start blank. The format-picker UI writes it
-- once the admin chooses one. See ROADMAP.md B1.5 and
-- GOBS_Game_Rules_v1.pdf §4.
--
-- Existing rounds were backfilled to '2_ball' in B4.4, so DROP NOT NULL
-- is non-destructive. The CHECK constraint stays untouched: Postgres
-- treats NULL CHECK results as unknown, so it passes.
--
-- Rollback:
--   BEGIN;
--   UPDATE rounds SET format = '2_ball' WHERE format IS NULL;
--   ALTER TABLE rounds
--     ALTER COLUMN format SET NOT NULL,
--     ALTER COLUMN format SET DEFAULT '2_ball';
--   COMMIT;

BEGIN;

ALTER TABLE rounds
  ALTER COLUMN format DROP DEFAULT,
  ALTER COLUMN format DROP NOT NULL;

COMMIT;
