-- Phase A: Per-player tee preference.
--
-- White/Yellow Combo (tees.id = 4) is the league de-facto standard;
-- application-level default lives in src/lib/tees.ts as DEFAULT_TEE_ID.
-- `preferred_tee_id` is the per-player override — null means "use the
-- app-level default." Wayne Vincent (players.id = 55) always plays White
-- (tees.id = 2); seeded explicitly here.
--
-- ON DELETE SET NULL because tee rows are essentially immutable — but
-- preserving FK integrity costs nothing.
--
-- Rollback:
--   BEGIN;
--   ALTER TABLE players DROP COLUMN IF EXISTS preferred_tee_id;
--   COMMIT;

BEGIN;

ALTER TABLE players
  ADD COLUMN preferred_tee_id integer NULL
  REFERENCES tees(id) ON DELETE SET NULL;

UPDATE players SET preferred_tee_id = 2 WHERE id = 55;

COMMIT;
