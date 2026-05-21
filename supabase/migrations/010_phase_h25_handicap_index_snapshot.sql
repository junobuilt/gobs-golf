-- Phase H.2.5 — Handicap Index snapshot on round_players.
--
-- Adds `handicap_index_snapshot` to round_players so each row permanently
-- records the HI that was in effect for that player on that round. All
-- course-handicap math switches to read from this column rather than from
-- the live players.handicap_index, making finalized rounds immutable.
--
-- Rollback (reference only — do not run on prod without a backup):
--   ALTER TABLE round_players DROP COLUMN handicap_index_snapshot;

ALTER TABLE round_players
  ADD COLUMN handicap_index_snapshot numeric NULL;

-- Backfill: copy each player's current HI into all existing rows.
-- Safe because no HI has changed since the small number of existing prod
-- rounds were played, so the copy is lossless.
UPDATE round_players
SET handicap_index_snapshot = players.handicap_index
FROM players
WHERE round_players.player_id = players.id
  AND round_players.handicap_index_snapshot IS NULL;
