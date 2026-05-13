-- Phase TD: Cleanup the May 11, 2026 duplicate-rounds incident.
--
-- Two `rounds` rows existed for played_on = '2026-05-11' (ids 90 and 91), both
-- fully scored with disjoint player sets. Round 91 (created 31 min after
-- round 90, 4 players, 72 scores) was minted by either an admin "Edit Teams"
-- race condition or a stale `/round/new` tab — see investigation in the
-- Track A report (2026-05-13 session).
--
-- This migration moves round 91's round_players into round 90 with their
-- team_number shifted by +3 (so round 91 T1 → round 90 T4, T2 → T5), then
-- deletes round 91. After application, round 90 should contain 10 players
-- across 5 teams (T1..T5) and 180 scores (10 players × 18 holes).
--
-- Safety verified pre-migration (Track A SQL queries, 2026-05-13):
--   - No player appears in both round 90 and round 91 → no UNIQUE
--     (round_id, player_id) violation when reparenting.
--   - No UNIQUE (round_id, team_number) constraint → renumbering is safe.
--   - Scores FK round_player_id, not round_id → scores ride along
--     automatically when round_players.round_id is updated.
--
-- Apply order: this migration MUST run before migration 006
-- (rounds_played_on_unique) — adding the unique constraint while two
-- rows still exist for 2026-05-11 would fail.
--
-- Rollback (split round 90 back into 90 + 91, reverse team renumbering):
--   BEGIN;
--   INSERT INTO rounds (id, played_on, course_id, format, format_config,
--                       format_locked_at, is_complete, created_at)
--   VALUES (91, '2026-05-11', 1, 'best_ball',
--           '{"basis":"net","best_n":2,"override_holes":[]}'::jsonb,
--           '2026-05-11 17:43:57.369+00', true,
--           '2026-05-11 17:28:56.77969+00');
--   UPDATE round_players SET round_id = 91, team_number = team_number - 3
--   WHERE round_id = 90 AND team_number > 3;
--   COMMIT;

BEGIN;

UPDATE round_players
SET round_id = 90,
    team_number = team_number + 3
WHERE round_id = 91;

DELETE FROM rounds WHERE id = 91;

-- Post-apply verification (run these manually after COMMIT — expected values
-- in comments). The DO block fails the migration if any expectation is off,
-- so a botched cleanup rolls the whole thing back.
DO $$
DECLARE
  v_player_count int;
  v_team_count   int;
  v_score_count  int;
  v_stray_91     int;
BEGIN
  SELECT COUNT(*) INTO v_player_count
    FROM round_players WHERE round_id = 90;
  SELECT COUNT(DISTINCT team_number) INTO v_team_count
    FROM round_players WHERE round_id = 90;
  SELECT COUNT(*) INTO v_score_count
    FROM scores s JOIN round_players rp ON rp.id = s.round_player_id
    WHERE rp.round_id = 90;
  SELECT COUNT(*) INTO v_stray_91
    FROM rounds WHERE id = 91;

  IF v_player_count <> 10 THEN
    RAISE EXCEPTION 'Expected 10 round_players on round 90, got %', v_player_count;
  END IF;
  IF v_team_count <> 5 THEN
    RAISE EXCEPTION 'Expected 5 distinct teams on round 90, got %', v_team_count;
  END IF;
  IF v_score_count <> 180 THEN
    RAISE EXCEPTION 'Expected 180 scores on round 90, got %', v_score_count;
  END IF;
  IF v_stray_91 <> 0 THEN
    RAISE EXCEPTION 'Round 91 still exists after cleanup, found % row(s)', v_stray_91;
  END IF;
END $$;

COMMIT;
