-- Flights Track, Session 4 — flight-aware finalize.
--
-- ONE finalize moment per round, fired once every team across ALL flights has
-- submitted. This RPC replaces the three round-wide finalize RPCs (008 / 020 /
-- 021) FOR MULTI-FLIGHT ROUNDS ONLY — single-flight rounds keep using their
-- existing per-format RPC (so single-flight behavior is byte-identical and the
-- old RPCs stay frozen legacy, pending a later cleanup migration). The client
-- routes a round to THIS function only when it has 2+ non-empty flights.
--
-- What it does, in one transaction (FOR UPDATE on the round, like 008/020/021):
--   1. 'already_complete' if already finalized; 'round_not_found' (P0002) if no
--      such round.
--   2. Resolves each assigned team to its flight via the CANONICAL DEFAULT RULE
--      (no flight_teams row → the round's lowest-sort_order flight). This rule
--      MIRRORS src/lib/flights/resolve.ts getFlightForTeam — the single source
--      of truth in app code. Kept in lockstep by: this header, the relay
--      dry-run (resolution counts checked on prod), and the JS default-rule test
--      (tests/lib/flights/resolve.test.ts). There is no Postgres test container,
--      so there is no literal cross-language assertion — these three are the
--      lockstep guarantee.
--   3. PER-FLIGHT completion FLOOR by format family (each flight checks only ITS
--      teams): strict best-N → every assigned player scored 1..COALESCE(dropped,
--      18); relaxed (Shambles) → every team ≥1 score per hole 1..18; team-card
--      (Texas Scramble / Alternate Shot) → a team_scores row per hole 1..18.
--      ANY flight failing → 'not_yet'.
--   4. SHORT teams are PER-FLIGHT: a team is short only vs the MAX roster IN ITS
--      OWN FLIGHT (never vs other flights). Only STRICT best-N flights generate
--      draw slots; Shambles + team-card flights generate ZERO (Shambles short
--      teams play short; team-card is never unbalanced). slots per team =
--      (flight_max − roster) round-start + one per dropout.
--   5. Draw POOL is ROUND-WIDE: players in NON-team-card flights, not dropped,
--      WITH a full 1..18 score set (the last clause excludes picked-up Shambles
--      players — they aren't valid fill sources). Team-card-flight players are
--      excluded as both sources and receivers.
--   6. Draws with the migration-008 seed/subpool/no-collision pattern, in a
--      DETERMINISTIC order: flight sort_order ASC → team_number ASC → round-start
--      fills then dropout fills (ascending dropout hole). NO COLLISIONS anywhere:
--      one player fills at most one team across the whole round (drawn players
--      are removed from the pool); the per-draw subpool excludes the receiving
--      team's own roster.
--   7. Flips rounds.is_complete = true. Returns one of:
--        'not_yet' | 'already_complete' | 'finalized' | 'pool_too_small'
--      (round-wide pool_too_small: total eligible pool < total slots). Raises
--      'pool_too_small_runtime' (P0001) if a per-team subpool empties mid-draw.
--
-- Fill SCORING (under the receiving flight's format + allowance) is NOT done
-- here — this RPC only records which team drew which player for which hole range
-- in blind_draws. results.ts scores each fill under the receiving flight's
-- config (Session 3 + the Session-4 cross-flight display fix).
--
-- Payout persistence stays client-side (persistPayoutsAfterFinalize →
-- computeAndPersistRoundPayouts, the Session-3 per-flight run) after this returns
-- 'finalized'/'already_complete' — identical to the other finalize paths.
--
-- Invoker-rights (like 008/020/021): rounds/scores/blind_draws RLS is allow-all,
-- and this writes only blind_draws + rounds.is_complete (never scores, so the
-- score-reject trigger never fires). No temp tables (the team→flight resolution
-- is an inline CTE repeated per query), so no TEMP privilege requirement.
--
-- Backup assessment: ADDITIVE (CREATE FUNCTION only — no table/column/data/
-- constraint change) and REVERSIBLE (DROP FUNCTION). No data is read-modified.
-- No backup needed.
--
-- Rollback:
--   BEGIN;
--   DROP FUNCTION IF EXISTS finalize_round_flights(bigint);
--   COMMIT;

BEGIN;

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
  -- tff resolves each team to (flight_id, family) via the canonical default
  -- rule. Three family-scoped violation checks; any → 'not_yet'.
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
           WHEN f.format = 'shambles' THEN 'relaxed'
           ELSE 'strict' END AS family
    FROM flights f WHERE f.round_id = p_round_id
  ),
  tff AS (
    SELECT tf.team_number, tf.flight_id, fam.family
    FROM tf JOIN fam ON fam.flight_id = tf.flight_id
  )
  SELECT
    -- strict best-N: an assigned player missing any score 1..COALESCE(dropped,18)
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
      -- relaxed (Shambles): a team-hole with zero scores
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
      -- team-card: a team-hole with no team_scores row
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
           WHEN f.format = 'shambles' THEN 'relaxed'
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

  -- No draws needed → just finalize. (Covers the even-flights case: a 4-man
  -- flight beside a 3-man flight, both internally even, yields ZERO slots.)
  IF v_total_slots = 0 THEN
    UPDATE rounds SET is_complete = true WHERE id = p_round_id;
    RETURN 'finalized';
  END IF;

  -- ── Round-wide eligible pool ───────────────────────────────────────────────
  -- Non-team-card flights, not dropped, with a FULL 1..18 score set (excludes
  -- picked-up Shambles players). Ordered by id so seed + pool composition
  -- reproduce the sequence.
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
           WHEN f.format = 'shambles' THEN 'relaxed'
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

  -- Defensive pre-check (no writes yet). Round-wide pool vs round-wide slots.
  IF v_pool_size < v_total_slots THEN
    RETURN 'pool_too_small';
  END IF;

  -- Seed PRNG once for the round (stamped on every blind_draws row).
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
             WHEN f.format = 'shambles' THEN 'relaxed'
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
