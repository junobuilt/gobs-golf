-- Phase D.1 — Blind Draw schema + engine.
--
-- Adds:
--   1. `round_players.dropped_after_hole` — NULL means played all 18 (or not
--      dropped yet); 1..17 means the player walked off after that hole. 0 and
--      18 are blocked at the DB layer (drops before hole 1 belong in roster
--      edits; players who finished hole 18 didn't drop).
--   2. `blind_draws` — one row per random fill written by the auto-finalize
--      engine. Logs which short team got which player and which hole range,
--      plus the PRNG seed used (same seed across all draws in a round, so
--      the entire sequence is reproducible given the seed + pool ordering).
--   3. `round_player_actions` — minimal audit trail for mark-dropout /
--      undo-dropout events. No existing pattern in the codebase; Jonathan
--      asked for it for post-hoc accountability. Not surfaced in UI.
--   4. `reject_scores_on_complete_round` trigger — single-fire guard. Since
--      score writes go directly from the client to Supabase (no API layer),
--      the guard has to live at the DB level. Raises P0001 'round_finalized'
--      so the WriteQueue can classify and surface a specific UX message.
--   5. `finalize_round_with_blind_draws(round_id)` RPC — the engine.
--      Atomic: completion check, slot identification, pool composition,
--      randomized draws, blind_draws inserts, and `rounds.is_complete = true`
--      all happen in one transaction. Returns one of:
--        'not_yet' | 'already_complete' | 'finalized' | 'pool_too_small'
--      Locks the rounds row FOR UPDATE so two tabs racing the final score
--      can't both fire.
--
-- PRNG: setseed() + random() inside the function. Pool ordered by
-- round_players.id ASC before each draw, so seed + pool composition uniquely
-- determines the sequence.
--
-- Rollback:
--   BEGIN;
--   DROP FUNCTION IF EXISTS finalize_round_with_blind_draws(bigint);
--   DROP TRIGGER IF EXISTS scores_reject_on_complete ON scores;
--   DROP FUNCTION IF EXISTS reject_scores_on_complete_round();
--   DROP TABLE IF EXISTS round_player_actions;
--   DROP TABLE IF EXISTS blind_draws;
--   ALTER TABLE round_players DROP COLUMN IF EXISTS dropped_after_hole;
--   COMMIT;

BEGIN;

-- 1. dropped_after_hole
ALTER TABLE round_players
  ADD COLUMN dropped_after_hole integer NULL
  CHECK (dropped_after_hole BETWEEN 1 AND 17);

-- 2. blind_draws
CREATE TABLE blind_draws (
  id                bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  round_id          bigint NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  short_team_number integer NOT NULL,
  drawn_player_id   bigint NOT NULL REFERENCES players(id),
  hole_range_start  integer NOT NULL CHECK (hole_range_start BETWEEN 1 AND 18),
  hole_range_end    integer NOT NULL DEFAULT 18 CHECK (hole_range_end = 18),
  random_seed       bigint NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blind_draws_round_team_idx ON blind_draws(round_id, short_team_number);

-- 3. round_player_actions (audit log)
CREATE TABLE round_player_actions (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  round_player_id bigint NOT NULL REFERENCES round_players(id) ON DELETE CASCADE,
  action          text NOT NULL CHECK (action IN ('mark_dropout', 'undo_dropout')),
  hole            integer NULL,
  surface         text NULL CHECK (surface IN ('admin', 'scorecard') OR surface IS NULL),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX round_player_actions_rp_idx ON round_player_actions(round_player_id, created_at);

-- 4. Single-fire guard. Rejects any score insert/update when its parent
-- round is already finalized. Custom message 'round_finalized' so the
-- WriteQueue can match on it and show specific UX copy.
CREATE OR REPLACE FUNCTION reject_scores_on_complete_round()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_complete boolean;
BEGIN
  SELECT r.is_complete INTO v_is_complete
    FROM round_players rp
    JOIN rounds r ON r.id = rp.round_id
    WHERE rp.id = NEW.round_player_id;
  IF v_is_complete THEN
    RAISE EXCEPTION 'round_finalized'
      USING ERRCODE = 'P0001',
            HINT = 'Round is finalized; score writes are rejected.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER scores_reject_on_complete
  BEFORE INSERT OR UPDATE ON scores
  FOR EACH ROW
  EXECUTE FUNCTION reject_scores_on_complete_round();

-- 5. Engine RPC.
CREATE OR REPLACE FUNCTION finalize_round_with_blind_draws(p_round_id bigint)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_complete       boolean;
  v_max_team_size     integer;
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

  -- Completion check: every assigned (team_number > 0) round_player has
  -- scores from hole 1 through COALESCE(dropped_after_hole, 18). Anything
  -- missing → round is not yet ready to finalize.
  IF EXISTS (
    SELECT 1
    FROM round_players rp
    WHERE rp.round_id = p_round_id
      AND rp.team_number > 0
      AND (
        SELECT COUNT(*) FROM scores s
        WHERE s.round_player_id = rp.id
          AND s.hole_number BETWEEN 1 AND COALESCE(rp.dropped_after_hole, 18)
      ) < COALESCE(rp.dropped_after_hole, 18)
  ) THEN
    RETURN 'not_yet';
  END IF;

  -- max_team_size = MAX roster size across all assigned teams. roster size
  -- counts every round_players row on the team, including dropouts (a
  -- dropped player is still "on the team," just stopped scoring).
  SELECT COALESCE(MAX(c), 0) INTO v_max_team_size
    FROM (
      SELECT COUNT(*) AS c
        FROM round_players
        WHERE round_id = p_round_id AND team_number > 0
        GROUP BY team_number
    ) t;

  -- No teams assigned → nothing to draw; just flip is_complete.
  IF v_max_team_size = 0 THEN
    UPDATE rounds SET is_complete = true WHERE id = p_round_id;
    RETURN 'finalized';
  END IF;

  -- Discrete slot count per team:
  --   (max_team_size - roster_size)  → round-start short slots
  --   + count of dropouts on team    → mid-round dropout slots
  -- Each slot is one draw, regardless of hole range covered.
  SELECT COALESCE(SUM(slots), 0) INTO v_total_slots
    FROM (
      SELECT
        team_number,
        (v_max_team_size - COUNT(*))
          + COUNT(*) FILTER (WHERE dropped_after_hole IS NOT NULL) AS slots
      FROM round_players
      WHERE round_id = p_round_id AND team_number > 0
      GROUP BY team_number
    ) t;

  -- Build the eligible-fill pool: every assigned player who completed all
  -- 18 holes. Ordered by id ASC so the seed alone (plus current pool
  -- composition) reproduces the draw sequence.
  v_pool := ARRAY(
    SELECT id FROM round_players
      WHERE round_id = p_round_id
        AND team_number > 0
        AND dropped_after_hole IS NULL
      ORDER BY id ASC
  );
  v_pool_size := COALESCE(array_length(v_pool, 1), 0);

  -- Defensive pre-check (no writes yet).
  IF v_pool_size < v_total_slots THEN
    RETURN 'pool_too_small';
  END IF;

  -- All teams equal size + no dropouts → nothing to draw.
  IF v_total_slots = 0 THEN
    UPDATE rounds SET is_complete = true WHERE id = p_round_id;
    RETURN 'finalized';
  END IF;

  -- Seed PRNG once for the round. Same seed stamped on every blind_draws
  -- row written below. Reproducibility: setseed(seed_bigint / max_bigint)
  -- + identical pool ordering = identical draw sequence.
  v_seed_bigint := floor(random() * 9223372036854775807)::bigint;
  v_seed_float  := v_seed_bigint::double precision / 9223372036854775807::double precision;
  PERFORM setseed(v_seed_float);

  -- Iterate teams in ascending team_number order. Within each team:
  -- round-start slots first, then dropout slots in ascending dropout-hole
  -- order. This matches the spec's S4 "Draw order" rule and is the same
  -- order assumed by the reproducibility property.
  FOR v_team IN
    SELECT
      team_number,
      (v_max_team_size - COUNT(*))::int AS round_start_slots,
      COALESCE(
        ARRAY(
          SELECT dropped_after_hole
            FROM round_players
            WHERE round_id = p_round_id
              AND team_number = rp_outer.team_number
              AND dropped_after_hole IS NOT NULL
            ORDER BY dropped_after_hole ASC
        ),
        ARRAY[]::int[]
      ) AS dropout_holes
    FROM round_players rp_outer
    WHERE round_id = p_round_id AND team_number > 0
    GROUP BY team_number
    ORDER BY team_number ASC
  LOOP
    v_round_start_slots := v_team.round_start_slots;
    v_dropout_holes := v_team.dropout_holes;

    -- Round-start fills (hole_range_start = 1, hole_range_end = 18)
    IF v_round_start_slots > 0 THEN
      FOR i IN 1..v_round_start_slots LOOP
        -- Subpool = current pool MINUS this team's roster.
        SELECT ARRAY_AGG(rp_id ORDER BY rp_id ASC) INTO v_temp_pool
          FROM unnest(v_pool) AS rp_id
          WHERE rp_id NOT IN (
            SELECT id FROM round_players
              WHERE round_id = p_round_id
                AND team_number = v_team.team_number
          );

        IF v_temp_pool IS NULL OR array_length(v_temp_pool, 1) IS NULL THEN
          -- Pre-check passed but a per-team subpool is empty (e.g., entire
          -- pool was on this team). Rare but possible; bail with rollback.
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
           1, 18, v_seed_bigint);

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
