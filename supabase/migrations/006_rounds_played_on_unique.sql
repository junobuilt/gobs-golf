-- Phase TD: Enforce one round per league-day at the DB level.
--
-- The May 11, 2026 duplicate-rounds incident (see migration 005) was made
-- possible by the absence of a unique constraint on rounds.played_on. Without
-- it, two near-simultaneous insert paths (admin RoundSetup.ensureRoundShell
-- and player-side /round/new) could each create a fresh `rounds` row for
-- the same calendar day. With it, the second insert hard-fails with code
-- 23505 — both code paths now handle that error by re-SELECTing the
-- canonical row.
--
-- Pre-migration safety check (Track A SQL, 2026-05-13):
--   SELECT played_on, COUNT(*) FROM rounds GROUP BY played_on HAVING COUNT(*) > 1;
--   → returned only ('2026-05-11', 2). After migration 005, this is empty.
--
-- Apply order: this migration MUST run AFTER migration 005
-- (fix_may11_duplicate_rounds_cleanup) — adding the constraint while two
-- rows still exist for 2026-05-11 would fail.
--
-- League rule alignment: the GOBS season plays one round per scheduled day.
-- The constraint codifies this rule. If a future tournament needs a morning
-- + afternoon flight on the same date, this constraint would need a
-- multi-column rewrite (e.g., (played_on, round_label)).
--
-- Rollback:
--   BEGIN;
--   ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_played_on_unique;
--   COMMIT;

BEGIN;

ALTER TABLE rounds
  ADD CONSTRAINT rounds_played_on_unique UNIQUE (played_on);

COMMIT;
