-- Par Competition — new net match-play-vs-course format.
--
-- Additive + reversible. Three parts in one transaction:
--   1. Widen rounds_format_check to allow 'par_competition' (mirrors 021).
--   2. Widen flights_format_check to allow 'par_competition' (mirrors 022).
--   3. CREATE OR REPLACE finalize_round_flights so its per-flight family
--      classifier treats 'par_competition' as the RELAXED family alongside
--      'shambles' (≥1 score/hole/team floor; short teams play short; generates
--      ZERO blind-draw receive-slots; its players are valid non-team-card draw
--      SOURCES). Body otherwise BYTE-IDENTICAL to migration 024 — only the four
--      `fam` CTE CASE arms change. The single-flight relaxed RPC
--      (finalize_round_relaxed, migration 020) is format-AGNOSTIC (its floor is
--      every team ≥1 score per hole, no format string) so it needs NO change;
--      the client routes single-flight par_competition rounds to it via
--      allowsIncompleteClose() in app code.
--
-- Backup assessment: ADDITIVE (two CHECK widenings + a CREATE OR REPLACE of a
-- pure function — no table/column/data change, no row read-modified) and
-- REVERSIBLE. The CHECK widenings only ADD an allowed value, so no existing row
-- can violate the new constraint. No backup strictly required; per migration
-- discipline a fresh db:backup is still taken and schema.sql regenerated +
-- committed post-apply.
--
-- Rollback:
--   BEGIN;
--   -- Restore the pre-027 finalize_round_flights (migration 024 body).
--   -- (Re-apply 024_flights_finalize.sql's CREATE OR REPLACE FUNCTION block.)
--   ALTER TABLE public.rounds DROP CONSTRAINT IF EXISTS rounds_format_check;
--   ALTER TABLE public.rounds ADD CONSTRAINT rounds_format_check
--     CHECK (format = ANY (ARRAY['2_ball','3_ball','best_ball',
--       'stableford_standard','gobs_stableford','shambles',
--       'texas_scramble','alternate_shot']));
--   ALTER TABLE public.flights DROP CONSTRAINT IF EXISTS flights_format_check;
--   ALTER TABLE public.flights ADD CONSTRAINT flights_format_check
--     CHECK (format IS NULL OR format = ANY (ARRAY['2_ball','3_ball','best_ball',
--       'stableford_standard','gobs_stableford','shambles',
--       'texas_scramble','alternate_shot']));
--   COMMIT;

BEGIN;

-- ── 1. rounds.format CHECK ───────────────────────────────────────────────────
ALTER TABLE public.rounds DROP CONSTRAINT IF EXISTS rounds_format_check;
ALTER TABLE public.rounds ADD CONSTRAINT rounds_format_check
  CHECK (format = ANY (ARRAY[
    '2_ball'::text,
    '3_ball'::text,
    'best_ball'::text,
    'stableford_standard'::text,
    'gobs_stableford'::text,
    'shambles'::text,
    'texas_scramble'::text,
    'alternate_shot'::text,
    'par_competition'::text
  ]));

-- ── 2. flights.format CHECK ──────────────────────────────────────────────────
ALTER TABLE public.flights DROP CONSTRAINT IF EXISTS flights_format_check;
ALTER TABLE public.flights ADD CONSTRAINT flights_format_check
  CHECK (
    format IS NULL OR format = ANY (ARRAY[
      '2_ball'::text,
      '3_ball'::text,
      'best_ball'::text,
      'stableford_standard'::text,
      'gobs_stableford'::text,
      'shambles'::text,
      'texas_scramble'::text,
      'alternate_shot'::text,
      'par_competition'::text
    ])
  );

-- ── 3. finalize_round_flights — par_competition joins the RELAXED family ──────
-- Verbatim copy of migration 024's function with the ONLY change being the four
-- `fam` CTE CASE arms: `WHEN f.format = 'shambles'` →
-- `WHEN f.format IN ('shambles','par_competition')`.
CREATE OR REPLACE FUNCTION finalize_round_flights(p_round_id bigint)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_complete       boolean;
  v_not_ready         boolean;
  v_pool              bigint[];
  v_pool_size         integer;
  v_temp_pool         bigint[];
  v_seed_bigint       bigint;
  v_seed_float        double precision;
  v_total_slots       integer := 0;
  v_team              RECORD;
  v_round_start_slots integer;
  v_dropout_holes     integer[];
  v_pick_idx          integer;
  v_drawn_rp_id       bigint;
  v_drawn_player_id   bigint;
  i                   integer;
BEGIN
  -- Serialize concurrent finalize attempts on the same round.
  SELECT COALESCE(r.is_complete, false) INTO v_is_complete
    FROM rounds r
    WHERE r.id = p_round_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_is_complete THEN
    RETURN 'already_complete';
  END IF;

  -- ── Per-flight completion floor ───────────────────────────────────────────
  WITH tf AS (
    SELECT DISTINCT rp.team_number,
           COALESCE(ft.flight_id,
                    (SELECT id FROM flights WHERE round_id = p_round_id
                     ORDER BY sort_order ASC LIMIT 1)) AS flight_id
    FROM round_players rp
    LEFT JOIN flight_teams ft
      ON ft.round_id = p_round_id AND ft.team_number = rp.team_number
    WHERE rp.round_id = p_round_id AND rp.team_number > 0
  ),
  fam AS (
    SELECT f.id AS flight_id,
      CASE WHEN f.format IN ('texas_scramble','alternate_shot') THEN 'team_card'
           WHEN f.format IN ('shambles','par_competition') THEN 'relaxed'
           ELSE 'strict' END AS family
    FROM flights f WHERE f.round_id = p_round_id
  ),
  tff AS (
    SELECT tf.team_number, tf.flight_id, fam.family
    FROM tf JOIN fam ON fam.flight_id = tf.flight_id
  )
  SELECT
    EXISTS (
      SELECT 1
      FROM round_players rp
      JOIN tff ON tff.team_number = rp.team_number
      WHERE rp.round_id = p_round_id AND rp.team_number > 0 AND tff.family = 'strict'
        AND (
          SELECT COUNT(*) FROM scores s
          WHERE s.round_player_id = rp.id
            AND s.hole_number BETWEEN 1 AND COALESCE(rp.dropped_after_hole, 18)
        ) < COALESCE(rp.dropped_after_hole, 18)
    )
    OR EXISTS (
      SELECT 1
      FROM tff
      CROSS JOIN generate_series(1, 18) AS h(hole)
      WHERE tff.family = 'relaxed'
        AND NOT EXISTS (
          SELECT 1 FROM round_players rp
          JOIN scores s ON s.round_player_id = rp.id
          WHERE rp.round_id = p_round_id
            AND rp.team_number = tff.team_number
            AND s.hole_number = h.hole
        )
    )
    OR EXISTS (
      SELECT 1
      FROM tff
      CROSS JOIN generate_series(1, 18) AS h(hole)
      WHERE tff.family = 'team_card'
        AND NOT EXISTS (
          SELECT 1 FROM team_scores ts
          WHERE ts.round_id = p_round_id
            AND ts.team_number = tff.team_number
            AND ts.hole_number = h.hole
        )
    )
  INTO v_not_ready;

  IF v_not_ready THEN
    RETURN 'not_yet';
  END IF;

  -- ── Total draw slots (STRICT flights only; per-flight max benchmark) ───────
  WITH tf AS (
    SELECT DISTINCT rp.team_number,
           COALESCE(ft.flight_id,
                    (SELECT id FROM flights WHERE round_id = p_round_id
                     ORDER BY sort_order ASC LIMIT 1)) AS flight_id
    FROM round_players rp
    LEFT JOIN flight_teams ft
      ON ft.round_id = p_round_id AND ft.team_number = rp.team_number
    WHERE rp.round_id = p_round_id AND rp.team_number > 0
  ),
  fam AS (
    SELECT f.id AS flight_id,
      CASE WHEN f.format IN ('texas_scramble','alternate_shot') THEN 'team_card'
           WHEN f.format IN ('shambles','par_competition') THEN 'relaxed'
           ELSE 'strict' END AS family
    FROM flights f WHERE f.round_id = p_round_id
  ),
  tff AS (
    SELECT tf.team_number, tf.flight_id, fam.family
    FROM tf JOIN fam ON fam.flight_id = tf.flight_id
  ),
  team_roster AS (
    SELECT rp.team_number,
           COUNT(*) AS roster,
           COUNT(*) FILTER (WHERE rp.dropped_after_hole IS NOT NULL) AS dropouts
    FROM round_players rp
    WHERE rp.round_id = p_round_id AND rp.team_number > 0
    GROUP BY rp.team_number
  ),
  flight_max AS (
    SELECT tff.flight_id, MAX(tr.roster) AS fmax
    FROM tff JOIN team_roster tr ON tr.team_number = tff.team_number
    WHERE tff.family = 'strict'
    GROUP BY tff.flight_id
  )
  SELECT COALESCE(SUM((fm.fmax - tr.roster) + tr.dropouts), 0)
    INTO v_total_slots
    FROM tff
    JOIN team_roster tr ON tr.team_number = tff.team_number
    JOIN flight_max fm ON fm.flight_id = tff.flight_id
    WHERE tff.family = 'strict';

  IF v_total_slots = 0 THEN
    UPDATE rounds SET is_complete = true WHERE id = p_round_id;
    RETURN 'finalized';
  END IF;

  -- ── Round-wide eligible pool ───────────────────────────────────────────────
  WITH tf AS (
    SELECT DISTINCT rp.team_number,
           COALESCE(ft.flight_id,
                    (SELECT id FROM flights WHERE round_id = p_round_id
                     ORDER BY sort_order ASC LIMIT 1)) AS flight_id
    FROM round_players rp
    LEFT JOIN flight_teams ft
      ON ft.round_id = p_round_id AND ft.team_number = rp.team_number
    WHERE rp.round_id = p_round_id AND rp.team_number > 0
  ),
  fam AS (
    SELECT f.id AS flight_id,
      CASE WHEN f.format IN ('texas_scramble','alternate_shot') THEN 'team_card'
           WHEN f.format IN ('shambles','par_competition') THEN 'relaxed'
           ELSE 'strict' END AS family
    FROM flights f WHERE f.round_id = p_round_id
  ),
  tff AS (
    SELECT tf.team_number, tf.flight_id, fam.family
    FROM tf JOIN fam ON fam.flight_id = tf.flight_id
  )
  SELECT ARRAY(
    SELECT rp.id
    FROM round_players rp
    JOIN tff ON tff.team_number = rp.team_number
    WHERE rp.round_id = p_round_id AND rp.team_number > 0
      AND tff.family <> 'team_card'
      AND rp.dropped_after_hole IS NULL
      AND (
        SELECT COUNT(DISTINCT s.hole_number) FROM scores s
        WHERE s.round_player_id = rp.id AND s.hole_number BETWEEN 1 AND 18
      ) = 18
    ORDER BY rp.id ASC
  ) INTO v_pool;
  v_pool_size := COALESCE(array_length(v_pool, 1), 0);

  IF v_pool_size < v_total_slots THEN
    RETURN 'pool_too_small';
  END IF;

  v_seed_bigint := floor(random() * 9223372036854775807)::bigint;
  v_seed_float  := v_seed_bigint::double precision / 9223372036854775807::double precision;
  PERFORM setseed(v_seed_float);

  -- ── Draw loop: STRICT-flight teams with slots, flight sort_order then team ──
  FOR v_team IN
    WITH tf AS (
      SELECT DISTINCT rp.team_number,
             COALESCE(ft.flight_id,
                      (SELECT id FROM flights WHERE round_id = p_round_id
                       ORDER BY sort_order ASC LIMIT 1)) AS flight_id
      FROM round_players rp
      LEFT JOIN flight_teams ft
        ON ft.round_id = p_round_id AND ft.team_number = rp.team_number
      WHERE rp.round_id = p_round_id AND rp.team_number > 0
    ),
    fam AS (
      SELECT f.id AS flight_id, f.sort_order,
        CASE WHEN f.format IN ('texas_scramble','alternate_shot') THEN 'team_card'
             WHEN f.format IN ('shambles','par_competition') THEN 'relaxed'
             ELSE 'strict' END AS family
      FROM flights f WHERE f.round_id = p_round_id
    ),
    tff AS (
      SELECT tf.team_number, tf.flight_id, fam.family, fam.sort_order
      FROM tf JOIN fam ON fam.flight_id = tf.flight_id
    ),
    team_roster AS (
      SELECT rp.team_number, COUNT(*) AS roster
      FROM round_players rp
      WHERE rp.round_id = p_round_id AND rp.team_number > 0
      GROUP BY rp.team_number
    ),
    flight_max AS (
      SELECT tff.flight_id, MAX(tr.roster) AS fmax
      FROM tff JOIN team_roster tr ON tr.team_number = tff.team_number
      WHERE tff.family = 'strict'
      GROUP BY tff.flight_id
    )
    SELECT
      tff.team_number,
      tff.sort_order,
      (fm.fmax - tr.roster)::int AS round_start_slots,
      COALESCE(
        ARRAY(
          SELECT dropped_after_hole
            FROM round_players
            WHERE round_id = p_round_id
              AND team_number = tff.team_number
              AND dropped_after_hole IS NOT NULL
            ORDER BY dropped_after_hole ASC
        ),
        ARRAY[]::int[]
      ) AS dropout_holes
    FROM tff
    JOIN team_roster tr ON tr.team_number = tff.team_number
    JOIN flight_max fm ON fm.flight_id = tff.flight_id
    WHERE tff.family = 'strict'
      AND ((fm.fmax - tr.roster) > 0
           OR EXISTS (SELECT 1 FROM round_players rp2
                      WHERE rp2.round_id = p_round_id
                        AND rp2.team_number = tff.team_number
                        AND rp2.dropped_after_hole IS NOT NULL))
    ORDER BY tff.sort_order ASC, tff.team_number ASC
  LOOP
    v_round_start_slots := v_team.round_start_slots;
    v_dropout_holes := v_team.dropout_holes;

    -- Round-start fills (hole_range_start = 1)
    IF v_round_start_slots > 0 THEN
      FOR i IN 1..v_round_start_slots LOOP
        SELECT ARRAY_AGG(rp_id ORDER BY rp_id ASC) INTO v_temp_pool
          FROM unnest(v_pool) AS rp_id
          WHERE rp_id NOT IN (
            SELECT id FROM round_players
              WHERE round_id = p_round_id
                AND team_number = v_team.team_number
          );

        IF v_temp_pool IS NULL OR array_length(v_temp_pool, 1) IS NULL THEN
          RAISE EXCEPTION 'pool_too_small_runtime'
            USING ERRCODE = 'P0001',
                  HINT = 'Per-team eligible pool is empty mid-draw.';
        END IF;

        v_pick_idx := floor(random() * array_length(v_temp_pool, 1))::int + 1;
        v_drawn_rp_id := v_temp_pool[v_pick_idx];

        SELECT player_id INTO v_drawn_player_id
          FROM round_players WHERE id = v_drawn_rp_id;

        INSERT INTO blind_draws
          (round_id, short_team_number, drawn_player_id,
           hole_range_start, hole_range_end, random_seed)
        VALUES
          (p_round_id, v_team.team_number, v_drawn_player_id, 1, 18, v_seed_bigint);

        SELECT ARRAY_AGG(rp_id ORDER BY rp_id ASC) INTO v_pool
          FROM unnest(v_pool) AS rp_id
          WHERE rp_id <> v_drawn_rp_id;
        v_pool := COALESCE(v_pool, ARRAY[]::bigint[]);
      END LOOP;
    END IF;

    -- Dropout fills (hole_range_start = dropped_after_hole + 1)
    IF array_length(v_dropout_holes, 1) IS NOT NULL THEN
      FOR i IN 1..array_length(v_dropout_holes, 1) LOOP
        SELECT ARRAY_AGG(rp_id ORDER BY rp_id ASC) INTO v_temp_pool
          FROM unnest(v_pool) AS rp_id
          WHERE rp_id NOT IN (
            SELECT id FROM round_players
              WHERE round_id = p_round_id
                AND team_number = v_team.team_number
          );

        IF v_temp_pool IS NULL OR array_length(v_temp_pool, 1) IS NULL THEN
          RAISE EXCEPTION 'pool_too_small_runtime'
            USING ERRCODE = 'P0001',
                  HINT = 'Per-team eligible pool is empty mid-draw.';
        END IF;

        v_pick_idx := floor(random() * array_length(v_temp_pool, 1))::int + 1;
        v_drawn_rp_id := v_temp_pool[v_pick_idx];

        SELECT player_id INTO v_drawn_player_id
          FROM round_players WHERE id = v_drawn_rp_id;

        INSERT INTO blind_draws
          (round_id, short_team_number, drawn_player_id,
           hole_range_start, hole_range_end, random_seed)
        VALUES
          (p_round_id, v_team.team_number, v_drawn_player_id,
           v_dropout_holes[i] + 1, 18, v_seed_bigint);

        SELECT ARRAY_AGG(rp_id ORDER BY rp_id ASC) INTO v_pool
          FROM unnest(v_pool) AS rp_id
          WHERE rp_id <> v_drawn_rp_id;
        v_pool := COALESCE(v_pool, ARRAY[]::bigint[]);
      END LOOP;
    END IF;
  END LOOP;

  UPDATE rounds SET is_complete = true WHERE id = p_round_id;
  RETURN 'finalized';
END;
$$;

COMMIT;
