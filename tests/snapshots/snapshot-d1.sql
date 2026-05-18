-- snapshot-d1.sql — Phase D.1 engine smoke test (Blind Draw RPC).
--
-- Verifies finalize_round_with_blind_draws() and the
-- scores_reject_on_complete trigger end-to-end against the live schema.
-- Self-contained: creates synthetic test data inside a transaction and
-- ROLLBACKs at the end so production data is untouched.
--
-- How to run:
--   1. Paste this whole file into the Supabase SQL editor and Run.
--      The final RAISE EXCEPTION 'ROLLBACK_OK' is intentional — it rolls
--      back the fixture. If you see ROLLBACK_OK at the end, all 10 tests
--      passed (any failed ASSERT would have raised earlier with its own
--      message). Check the NOTICE log for the test-by-test PASS lines.
--   2. Or via psql: psql "$DATABASE_URL" -f tests/snapshots/snapshot-d1.sql
--
-- Scenarios exercised:
--   - 2/2/2/3 split with one mid-round dropout on team 4 (after hole 8)
--   - Completion check returns 'not_yet' before scores are entered
--   - 4 fills produced (3 round-start + 1 dropout)
--   - No collisions across draws
--   - No own-team draws
--   - Dropouts excluded from the eligible pool
--   - Dropout fill range = holes 9–18 (dropped_after_hole + 1 .. 18)
--   - Second RPC call returns 'already_complete' (single-fire guard)
--   - Post-finalize score insert rejected with 'round_finalized' (P0001)
--   - All draws share the same random_seed (reproducibility property)

DO $$
DECLARE
  v_round_id bigint;
  v_player_ids bigint[];
  v_rp_ids bigint[];
  v_result text;
  v_draws_count integer;
  v_round_start_draws integer;
  v_all_seeds_match boolean;
BEGIN
  -- 9 fake players, marked inactive so a stray commit wouldn't pollute
  -- the active-player list.
  INSERT INTO players (full_name, display_name, handicap_index, is_active)
  SELECT 'SNAPSHOT_D1_' || g, 'T' || g, 10.0, false
    FROM generate_series(1, 9) g;
  SELECT ARRAY(
    SELECT id FROM players WHERE full_name LIKE 'SNAPSHOT_D1_%' ORDER BY id
  ) INTO v_player_ids;

  INSERT INTO rounds (played_on, format, format_config, is_complete)
  VALUES ('2099-12-31', '2_ball',
          '{"basis":"net","best_n":2,"override_holes":[]}'::jsonb,
          false)
  RETURNING id INTO v_round_id;

  -- 2/2/2/3 split.
  INSERT INTO round_players (round_id, player_id, tee_id, team_number, course_handicap)
  VALUES
    (v_round_id, v_player_ids[1], 1, 1, 10),
    (v_round_id, v_player_ids[2], 1, 1, 10),
    (v_round_id, v_player_ids[3], 1, 2, 10),
    (v_round_id, v_player_ids[4], 1, 2, 10),
    (v_round_id, v_player_ids[5], 1, 3, 10),
    (v_round_id, v_player_ids[6], 1, 3, 10),
    (v_round_id, v_player_ids[7], 1, 4, 10),
    (v_round_id, v_player_ids[8], 1, 4, 10),
    (v_round_id, v_player_ids[9], 1, 4, 10);
  SELECT ARRAY(SELECT id FROM round_players WHERE round_id = v_round_id ORDER BY id)
    INTO v_rp_ids;

  -- Test 1: completion check rejects unsaved scores.
  v_result := finalize_round_with_blind_draws(v_round_id);
  ASSERT v_result = 'not_yet', 'expected not_yet, got ' || v_result;
  RAISE NOTICE 'Test 1 PASS: empty round -> %', v_result;

  -- Fill 18 holes for every player, then mark team 4's 3rd player as
  -- dropped after hole 8 and prune their post-drop scores.
  INSERT INTO scores (round_player_id, hole_number, strokes)
  SELECT rp_id, h, 4
    FROM unnest(v_rp_ids) AS rp_id, generate_series(1, 18) h;
  UPDATE round_players SET dropped_after_hole = 8 WHERE id = v_rp_ids[9];
  DELETE FROM scores WHERE round_player_id = v_rp_ids[9] AND hole_number > 8;

  -- Test 2: completion check passes; engine fires.
  v_result := finalize_round_with_blind_draws(v_round_id);
  ASSERT v_result = 'finalized', 'expected finalized, got ' || v_result;
  RAISE NOTICE 'Test 2 PASS: %', v_result;

  -- Test 3: 4 fills (3 round-start + 1 dropout).
  SELECT COUNT(*) INTO v_draws_count FROM blind_draws WHERE round_id = v_round_id;
  ASSERT v_draws_count = 4, format('expected 4 draws, got %s', v_draws_count);
  RAISE NOTICE 'Test 3 PASS: % draws', v_draws_count;

  -- Test 4: no collisions — drawn_player_id appears exactly once.
  ASSERT NOT EXISTS (
    SELECT drawn_player_id FROM blind_draws
      WHERE round_id = v_round_id
      GROUP BY drawn_player_id HAVING COUNT(*) > 1
  ), 'collision detected';
  RAISE NOTICE 'Test 4 PASS: no collisions';

  -- Test 5: drawn player is never from the short team's own roster.
  ASSERT NOT EXISTS (
    SELECT 1 FROM blind_draws bd
      JOIN round_players rp ON rp.player_id = bd.drawn_player_id
        AND rp.round_id = bd.round_id
      WHERE bd.round_id = v_round_id
        AND rp.team_number = bd.short_team_number
  ), 'own-team draw detected';
  RAISE NOTICE 'Test 5 PASS: no own-team draws';

  -- Test 6: dropouts are never drawn (pool excludes incomplete records).
  ASSERT NOT EXISTS (
    SELECT 1 FROM blind_draws bd
      WHERE bd.round_id = v_round_id
        AND bd.drawn_player_id IN (
          SELECT player_id FROM round_players
          WHERE round_id = v_round_id AND dropped_after_hole IS NOT NULL
        )
  ), 'dropout drawn';
  RAISE NOTICE 'Test 6 PASS: dropouts excluded';

  -- Test 7: 3 round-start fills (range 1..18) + dropout fill on team 4
  -- with range 9..18.
  SELECT COUNT(*) INTO v_round_start_draws FROM blind_draws
    WHERE round_id = v_round_id AND hole_range_start = 1;
  ASSERT v_round_start_draws = 3, format('expected 3 round-start fills, got %s', v_round_start_draws);
  ASSERT EXISTS (
    SELECT 1 FROM blind_draws
      WHERE round_id = v_round_id
        AND short_team_number = 4
        AND hole_range_start = 9
        AND hole_range_end = 18
  ), 'dropout fill (team 4, holes 9-18) missing';
  RAISE NOTICE 'Test 7 PASS: 3 round-start + 1 dropout (holes 9-18)';

  -- Test 8: single-fire guard. Second call returns already_complete.
  v_result := finalize_round_with_blind_draws(v_round_id);
  ASSERT v_result = 'already_complete', 'expected already_complete, got ' || v_result;
  RAISE NOTICE 'Test 8 PASS: %', v_result;

  -- Test 9: score-write trigger rejects post-finalize writes with the
  -- specific 'round_finalized' message that the WriteQueue classifier
  -- recognizes.
  BEGIN
    INSERT INTO scores (round_player_id, hole_number, strokes)
      VALUES (v_rp_ids[1], 19, 5);
    RAISE EXCEPTION 'TEST FAIL: insert should have been rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'round_finalized' THEN RAISE; END IF;
    RAISE NOTICE 'Test 9 PASS: %', SQLERRM;
  END;

  -- Test 10: all draws share the same random_seed (reproducibility).
  SELECT (COUNT(DISTINCT random_seed) = 1) INTO v_all_seeds_match
    FROM blind_draws WHERE round_id = v_round_id;
  ASSERT v_all_seeds_match, 'seeds differ across draws';
  RAISE NOTICE 'Test 10 PASS: single seed';

  RAISE EXCEPTION 'ROLLBACK_OK';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'ROLLBACK_OK' THEN
    RAISE NOTICE 'snapshot-d1: all 10 tests passed. Rolling back fixture.';
    RAISE;
  ELSE
    RAISE;
  END IF;
END $$;
