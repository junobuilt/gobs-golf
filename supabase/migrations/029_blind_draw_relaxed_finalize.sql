-- 029: Blind draw for relaxed-close formats (Par Competition + Shambles).
-- Applied to prod via Supabase MCP on 2026-06-17 (planning chat), then committed
-- here to close the repo<->prod gap. This is the EXACT body that is live in prod.
--
-- Authored from the DEPLOYED finalize_round_relaxed floor + the DEPLOYED
-- finalize_round_with_blind_draws draw block. Repo migration files (008/020)
-- had drifted from prod, so deployed definitions were the source of truth.
-- The strict function finalize_round_with_blind_draws is intentionally NOT
-- modified (zero risk to the strict path; verified hash-identical post-apply).
--
-- Relaxed divergences from strict:
--   (1) source pool = players who completed all 18 holes (picked-up players
--       excluded as fill sources);
--   (2) insufficient pool -> finalize anyway, no fill (never blocks a close);
--   (3) best-effort -> an empty per-team subpool skips that slot instead of
--       aborting, so a relaxed round always finalizes.
--
-- Down: restore the prior draw-less body (see migration 020 for the original).
CREATE OR REPLACE FUNCTION finalize_round_relaxed(p_round_id bigint)
RETURNS text LANGUAGE plpgsql AS $body$
DECLARE
  v_is_complete boolean; v_max_team_size integer; v_pool bigint[]; v_pool_size integer;
  v_temp_pool bigint[]; v_seed_bigint bigint; v_seed_float double precision;
  v_total_slots integer := 0; v_team RECORD; v_round_start_slots integer;
  v_dropout_holes integer[]; v_pick_idx integer; v_drawn_rp_id bigint;
  v_drawn_player_id bigint; i integer;
BEGIN
  SELECT COALESCE(r.is_complete, false) INTO v_is_complete FROM rounds r WHERE r.id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_is_complete THEN RETURN 'already_complete'; END IF;
  -- Relaxed completion FLOOR (unchanged): every assigned team has >=1 score on every hole 1..18.
  IF EXISTS (
    SELECT 1 FROM (SELECT DISTINCT team_number FROM round_players WHERE round_id = p_round_id AND team_number > 0) teams
    CROSS JOIN generate_series(1,18) AS h(hole)
    WHERE NOT EXISTS (SELECT 1 FROM round_players rp JOIN scores s ON s.round_player_id = rp.id
      WHERE rp.round_id = p_round_id AND rp.team_number = teams.team_number AND s.hole_number = h.hole)
  ) THEN RETURN 'not_yet'; END IF;
  -- ===== Blind draw (NEW for relaxed; mirrors deployed strict draw) =====
  SELECT COALESCE(MAX(c),0) INTO v_max_team_size FROM (SELECT COUNT(*) AS c FROM round_players
    WHERE round_id = p_round_id AND team_number > 0 GROUP BY team_number) t;
  IF v_max_team_size = 0 THEN UPDATE rounds SET is_complete = true WHERE id = p_round_id; RETURN 'finalized'; END IF;
  SELECT COALESCE(SUM(slots),0) INTO v_total_slots FROM (SELECT team_number,
    (v_max_team_size - COUNT(*)) + COUNT(*) FILTER (WHERE dropped_after_hole IS NOT NULL) AS slots
    FROM round_players WHERE round_id = p_round_id AND team_number > 0 GROUP BY team_number) t;
  -- Source pool = full-18 players, not dropouts (Decision 2: picked-up players excluded).
  v_pool := ARRAY(SELECT rp.id FROM round_players rp WHERE rp.round_id = p_round_id AND rp.team_number > 0
    AND rp.dropped_after_hole IS NULL
    AND (SELECT COUNT(*) FROM scores s WHERE s.round_player_id = rp.id AND s.hole_number BETWEEN 1 AND 18) = 18
    ORDER BY rp.id ASC);
  v_pool_size := COALESCE(array_length(v_pool,1),0);
  -- Relaxed divergence: insufficient pool -> finalize anyway, no fill.
  IF v_total_slots = 0 OR v_pool_size < v_total_slots THEN
    UPDATE rounds SET is_complete = true WHERE id = p_round_id; RETURN 'finalized'; END IF;
  v_seed_bigint := floor(random() * 9223372036854775807)::bigint;
  v_seed_float := v_seed_bigint::double precision / 9223372036854775807::double precision;
  PERFORM setseed(v_seed_float);
  FOR v_team IN
    SELECT team_number, (v_max_team_size - COUNT(*))::int AS round_start_slots,
      COALESCE(ARRAY(SELECT dropped_after_hole FROM round_players WHERE round_id = p_round_id
        AND team_number = rp_outer.team_number AND dropped_after_hole IS NOT NULL
        ORDER BY dropped_after_hole ASC), ARRAY[]::int[]) AS dropout_holes
    FROM round_players rp_outer WHERE round_id = p_round_id AND team_number > 0
    GROUP BY team_number ORDER BY team_number ASC
  LOOP
    v_round_start_slots := v_team.round_start_slots; v_dropout_holes := v_team.dropout_holes;
    IF v_round_start_slots > 0 THEN
      FOR i IN 1..v_round_start_slots LOOP
        SELECT ARRAY_AGG(rp_id ORDER BY rp_id ASC) INTO v_temp_pool FROM unnest(v_pool) AS rp_id
          WHERE rp_id NOT IN (SELECT id FROM round_players WHERE round_id = p_round_id AND team_number = v_team.team_number);
        -- Relaxed best-effort: no eligible source left for this team -> skip the slot (play short), do not abort.
        EXIT WHEN v_temp_pool IS NULL OR array_length(v_temp_pool,1) IS NULL;
        v_pick_idx := floor(random() * array_length(v_temp_pool,1))::int + 1;
        v_drawn_rp_id := v_temp_pool[v_pick_idx];
        SELECT player_id INTO v_drawn_player_id FROM round_players WHERE id = v_drawn_rp_id;
        INSERT INTO blind_draws (round_id, short_team_number, drawn_player_id, hole_range_start, hole_range_end, random_seed)
        VALUES (p_round_id, v_team.team_number, v_drawn_player_id, 1, 18, v_seed_bigint);
        SELECT ARRAY_AGG(rp_id ORDER BY rp_id ASC) INTO v_pool FROM unnest(v_pool) AS rp_id WHERE rp_id <> v_drawn_rp_id;
        v_pool := COALESCE(v_pool, ARRAY[]::bigint[]);
      END LOOP;
    END IF;
    IF array_length(v_dropout_holes,1) IS NOT NULL THEN
      FOR i IN 1..array_length(v_dropout_holes,1) LOOP
        SELECT ARRAY_AGG(rp_id ORDER BY rp_id ASC) INTO v_temp_pool FROM unnest(v_pool) AS rp_id
          WHERE rp_id NOT IN (SELECT id FROM round_players WHERE round_id = p_round_id AND team_number = v_team.team_number);
        EXIT WHEN v_temp_pool IS NULL OR array_length(v_temp_pool,1) IS NULL;
        v_pick_idx := floor(random() * array_length(v_temp_pool,1))::int + 1;
        v_drawn_rp_id := v_temp_pool[v_pick_idx];
        SELECT player_id INTO v_drawn_player_id FROM round_players WHERE id = v_drawn_rp_id;
        INSERT INTO blind_draws (round_id, short_team_number, drawn_player_id, hole_range_start, hole_range_end, random_seed)
        VALUES (p_round_id, v_team.team_number, v_drawn_player_id, v_dropout_holes[i] + 1, 18, v_seed_bigint);
        SELECT ARRAY_AGG(rp_id ORDER BY rp_id ASC) INTO v_pool FROM unnest(v_pool) AS rp_id WHERE rp_id <> v_drawn_rp_id;
        v_pool := COALESCE(v_pool, ARRAY[]::bigint[]);
      END LOOP;
    END IF;
  END LOOP;
  UPDATE rounds SET is_complete = true WHERE id = p_round_id; RETURN 'finalized';
END;
$body$;
