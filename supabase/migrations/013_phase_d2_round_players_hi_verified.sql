-- Phase D.2: Admin Edit Round — HI verification chip
--
-- Adds round_players.hi_verified_at — a per-row timestamp that the HI
-- verification chip on the scorecard uses to know whether the admin has
-- explicitly confirmed the snapshot HI for this round_player.
--
-- Chip render predicate:
--   hi_verified_at IS NULL
--   AND round_players.created_at > rounds.played_on + 1 day
--
-- The "+ 1 day" clause separates rows created on round day (normal flow,
-- snapshot HI was the player's actual HI at round time) from rows
-- back-filled later (newly added to a historical round in admin edit mode,
-- OR back-filled by the H.5 historical import). For H.5 rows the snapshot
-- HI is an approximation, so a chip flood on first edit-mode open of any
-- historical round is the intended behavior — admin verifies, taps Save
-- or Verify, the timestamp is set, the chip clears.
--
-- No backfill: NULL is the correct default for every existing row. Rows
-- created on round day have created_at = round day so the chip predicate
-- never fires for them. H.5-imported rows have created_at = import date,
-- so they correctly surface the chip.
--
-- Rollback:
--   ALTER TABLE round_players DROP COLUMN hi_verified_at;

ALTER TABLE round_players
  ADD COLUMN hi_verified_at timestamp with time zone DEFAULT NULL;
