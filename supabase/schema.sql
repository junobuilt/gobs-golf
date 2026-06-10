--
-- PostgreSQL database dump
--

\restrict yondieXvwNzBzJSkmmT6fLEAmf0Fo2ehH0IsK7aWn2sqpvTynfgdzbgXF1ki3Rv

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: create_team_with_players(integer, integer[], numeric[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_team_with_players(p_round_id integer, p_player_ids integer[], p_handicap_snapshots numeric[]) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_next_team_number integer;
  v_index integer;
BEGIN
  -- Lock the round to serialize concurrent team creation.
  PERFORM 1 FROM rounds WHERE id = p_round_id FOR UPDATE;

  -- Compute next team number inside the lock.
  SELECT COALESCE(MAX(team_number), 0) + 1
  INTO v_next_team_number
  FROM round_players
  WHERE round_id = p_round_id;

  -- Insert all player rows with the locked team number.
  FOR v_index IN 1..array_length(p_player_ids, 1) LOOP
    INSERT INTO round_players
      (round_id, player_id, team_number, handicap_index_snapshot)
    VALUES
      (p_round_id, p_player_ids[v_index], v_next_team_number,
       p_handicap_snapshots[v_index])
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN v_next_team_number;
END;
$$;


--
-- Name: finalize_round_relaxed(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_round_relaxed(p_round_id bigint) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_is_complete boolean;
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

  -- Relaxed completion FLOOR: every assigned team must have at least one score
  -- on every hole 1..18. A team-hole with zero scores blocks finalize.
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT team_number
        FROM round_players
        WHERE round_id = p_round_id AND team_number > 0
    ) teams
    CROSS JOIN generate_series(1, 18) AS h(hole)
    WHERE NOT EXISTS (
      SELECT 1
        FROM round_players rp
        JOIN scores s ON s.round_player_id = rp.id
        WHERE rp.round_id = p_round_id
          AND rp.team_number = teams.team_number
          AND s.hole_number = h.hole
    )
  ) THEN
    RETURN 'not_yet';
  END IF;

  -- No blind draw for relaxed close — short teams play short.
  UPDATE rounds SET is_complete = true WHERE id = p_round_id;
  RETURN 'finalized';
END;
$$;


--
-- Name: finalize_round_team_card(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_round_team_card(p_round_id bigint) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_is_complete boolean;
BEGIN
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

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT team_number
        FROM round_players
        WHERE round_id = p_round_id AND team_number > 0
    ) teams
    CROSS JOIN generate_series(1, 18) AS h(hole)
    WHERE NOT EXISTS (
      SELECT 1
        FROM team_scores ts
        WHERE ts.round_id = p_round_id
          AND ts.team_number = teams.team_number
          AND ts.hole_number = h.hole
    )
  ) THEN
    RETURN 'not_yet';
  END IF;

  UPDATE rounds SET is_complete = true WHERE id = p_round_id;
  RETURN 'finalized';
END;
$$;


--
-- Name: finalize_round_with_blind_draws(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_round_with_blind_draws(p_round_id bigint) RETURNS text
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

  SELECT COALESCE(MAX(c), 0) INTO v_max_team_size
    FROM (
      SELECT COUNT(*) AS c
        FROM round_players
        WHERE round_id = p_round_id AND team_number > 0
        GROUP BY team_number
    ) t;

  IF v_max_team_size = 0 THEN
    UPDATE rounds SET is_complete = true WHERE id = p_round_id;
    RETURN 'finalized';
  END IF;

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

  v_pool := ARRAY(
    SELECT id FROM round_players
      WHERE round_id = p_round_id
        AND team_number > 0
        AND dropped_after_hole IS NULL
      ORDER BY id ASC
  );
  v_pool_size := COALESCE(array_length(v_pool, 1), 0);

  IF v_pool_size < v_total_slots THEN
    RETURN 'pool_too_small';
  END IF;

  IF v_total_slots = 0 THEN
    UPDATE rounds SET is_complete = true WHERE id = p_round_id;
    RETURN 'finalized';
  END IF;

  v_seed_bigint := floor(random() * 9223372036854775807)::bigint;
  v_seed_float  := v_seed_bigint::double precision / 9223372036854775807::double precision;
  PERFORM setseed(v_seed_float);

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
          (p_round_id, v_team.team_number, v_drawn_player_id,
           1, 18, v_seed_bigint);

        SELECT ARRAY_AGG(rp_id ORDER BY rp_id ASC) INTO v_pool
          FROM unnest(v_pool) AS rp_id
          WHERE rp_id <> v_drawn_rp_id;
        v_pool := COALESCE(v_pool, ARRAY[]::bigint[]);
      END LOOP;
    END IF;

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


--
-- Name: override_round_payout(bigint, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.override_round_payout(p_round_id bigint, p_team_number integer, p_new_per_player integer, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_team_size integer;
  v_was       boolean;
  v_per       integer;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'override_round_payout: reason is required';
  END IF;
  IF p_new_per_player IS NULL OR p_new_per_player < 0 THEN
    RAISE EXCEPTION 'override_round_payout: per_player must be >= 0';
  END IF;

  SELECT team_size, was_overridden, per_player
    INTO v_team_size, v_was, v_per
    FROM round_payouts
    WHERE round_id = p_round_id AND team_number = p_team_number
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'override_round_payout: no row for round % team %',
      p_round_id, p_team_number;
  END IF;

  UPDATE round_payouts SET
    per_player      = p_new_per_player,
    total_for_team  = p_new_per_player * v_team_size,
    original_amount = CASE WHEN v_was THEN original_amount ELSE v_per END,
    was_overridden  = true,
    admin_override  = true,
    override_reason = btrim(p_reason)
  WHERE round_id = p_round_id AND team_number = p_team_number;
END;
$$;


--
-- Name: persist_round_payouts(bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.persist_round_payouts(p_round_id bigint, p_payload jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_season_id integer;
BEGIN
  SELECT season_id INTO v_season_id FROM rounds WHERE id = p_round_id;
  DELETE FROM round_payouts WHERE round_id = p_round_id;
  INSERT INTO round_payouts
    (round_id, season_id, team_number, place, per_player, team_size, total_for_team, is_tied, below_floor)
  SELECT p_round_id, v_season_id, x.team_number, x.place, x.per_player, x.team_size, x.total_for_team, x.is_tied, x.below_floor
  FROM jsonb_to_recordset(p_payload -> 'payouts') AS x(
    team_number integer, place integer, per_player integer, team_size integer,
    total_for_team integer, is_tied boolean, below_floor boolean);
  IF NOT EXISTS (
    SELECT 1 FROM fund_transactions WHERE round_id = p_round_id GROUP BY fund HAVING SUM(amount) <> 0
  ) THEN
    INSERT INTO fund_transactions (fund, amount, reason, round_id, source)
    SELECT f.fund, f.amount, f.reason, p_round_id, 'finalize'
    FROM jsonb_to_recordset(p_payload -> 'funds') AS f(fund text, amount integer, reason text);
  END IF;
END; $$;


--
-- Name: reset_fund(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_fund(p_fund text, p_reason text, p_created_by text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_balance integer;
BEGIN
  IF p_fund NOT IN ('hio','bfb') THEN
    RAISE EXCEPTION 'reset_fund: invalid fund %', p_fund;
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reset_fund: reason is required';
  END IF;

  -- Recompute the live balance inside this transaction to avoid a stale-read
  -- race; the balancing entry brings the running total to exactly 0.
  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM fund_transactions WHERE fund = p_fund;

  INSERT INTO fund_transactions (fund, amount, reason, round_id, source, created_by, note)
  VALUES (p_fund, -v_balance, 'reset', NULL, 'reset',
          COALESCE(NULLIF(btrim(p_created_by), ''), 'admin'), btrim(p_reason));
END;
$$;


--
-- Name: reverse_round_payouts(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reverse_round_payouts(p_round_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO fund_transactions (fund, amount, reason, round_id, source)
  SELECT fund, -SUM(amount), 'reopen_reversal', p_round_id, 'reopen_reversal'
  FROM fund_transactions WHERE round_id = p_round_id GROUP BY fund HAVING SUM(amount) <> 0;
  DELETE FROM round_payouts WHERE round_id = p_round_id;
END; $$;


--
-- Name: revert_round_payout(bigint, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revert_round_payout(p_round_id bigint, p_team_number integer, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_team_size integer;
  v_was       boolean;
  v_orig      integer;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'revert_round_payout: reason is required';
  END IF;

  SELECT team_size, was_overridden, original_amount
    INTO v_team_size, v_was, v_orig
    FROM round_payouts
    WHERE round_id = p_round_id AND team_number = p_team_number
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revert_round_payout: no row for round % team %',
      p_round_id, p_team_number;
  END IF;
  IF NOT v_was THEN
    RAISE EXCEPTION 'revert_round_payout: row is not overridden';
  END IF;
  IF v_orig IS NULL THEN
    RAISE EXCEPTION 'revert_round_payout: original_amount missing';
  END IF;

  UPDATE round_payouts SET
    per_player      = v_orig,
    total_for_team  = v_orig * v_team_size,
    was_overridden  = false,
    admin_override  = false,
    original_amount = NULL,
    override_reason = btrim(p_reason)
  WHERE round_id = p_round_id AND team_number = p_team_number;
END;
$$;


--
-- Name: rounds_was_finalized_latch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rounds_was_finalized_latch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_complete = true AND COALESCE(OLD.is_complete, false) = false THEN
    NEW.was_finalized := true;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: set_updated_at_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: blind_draws; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blind_draws (
    id bigint NOT NULL,
    round_id bigint NOT NULL,
    short_team_number integer NOT NULL,
    drawn_player_id bigint NOT NULL,
    hole_range_start integer NOT NULL,
    hole_range_end integer DEFAULT 18 NOT NULL,
    random_seed bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blind_draws_hole_range_end_check CHECK ((hole_range_end = 18)),
    CONSTRAINT blind_draws_hole_range_start_check CHECK (((hole_range_start >= 1) AND (hole_range_start <= 18)))
);


--
-- Name: blind_draws_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.blind_draws ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.blind_draws_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    id bigint NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    state text,
    num_holes integer DEFAULT 18,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: courses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.courses ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.courses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fund_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_transactions (
    id bigint NOT NULL,
    fund text NOT NULL,
    amount integer NOT NULL,
    reason text NOT NULL,
    round_id bigint,
    source text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    note text,
    CONSTRAINT fund_transactions_fund_check CHECK ((fund = ANY (ARRAY['hio'::text, 'bfb'::text]))),
    CONSTRAINT fund_transactions_source_check CHECK ((source = ANY (ARRAY['finalize'::text, 'reopen_reversal'::text, 'reset'::text, 'import'::text])))
);


--
-- Name: fund_balances; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.fund_balances AS
 SELECT f.fund,
    (COALESCE(sum(t.amount), (0)::bigint))::integer AS balance,
    max(t.created_at) AS last_movement
   FROM (( VALUES ('hio'::text), ('bfb'::text)) f(fund)
     LEFT JOIN public.fund_transactions t ON ((t.fund = f.fund)))
  GROUP BY f.fund;


--
-- Name: fund_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.fund_transactions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.fund_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: holes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holes (
    id bigint NOT NULL,
    tee_id bigint,
    hole_number integer NOT NULL,
    par integer NOT NULL,
    yardage integer,
    stroke_index integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT holes_hole_number_check CHECK (((hole_number >= 1) AND (hole_number <= 18))),
    CONSTRAINT holes_par_check CHECK (((par >= 3) AND (par <= 6))),
    CONSTRAINT holes_stroke_index_check CHECK (((stroke_index >= 1) AND (stroke_index <= 18)))
);


--
-- Name: holes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.holes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.holes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: league_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    id bigint NOT NULL,
    full_name text NOT NULL,
    display_name text,
    handicap_index numeric(4,1),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    preferred_tee_id integer
);


--
-- Name: tees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tees (
    id bigint NOT NULL,
    course_id bigint,
    color text NOT NULL,
    total_yards integer,
    course_rating numeric(4,1),
    slope_rating integer,
    par integer DEFAULT 72,
    gender text DEFAULT 'M'::text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    color_code text
);


--
-- Name: player_course_handicaps; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.player_course_handicaps AS
 SELECT p.id AS player_id,
    p.full_name,
    p.display_name,
    p.handicap_index,
    t.id AS tee_id,
    t.color AS tee_color,
    t.course_rating,
    t.slope_rating,
    t.par,
        CASE
            WHEN (p.handicap_index IS NOT NULL) THEN (round((((p.handicap_index * (t.slope_rating)::numeric) / 113.0) + (t.course_rating - (t.par)::numeric))))::integer
            ELSE NULL::integer
        END AS course_handicap
   FROM (public.players p
     CROSS JOIN public.tees t)
  WHERE (p.is_active = true);


--
-- Name: players_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.players ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.players_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: round_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.round_payouts (
    id bigint NOT NULL,
    round_id bigint NOT NULL,
    season_id integer,
    team_number integer NOT NULL,
    place integer NOT NULL,
    per_player integer NOT NULL,
    team_size integer NOT NULL,
    total_for_team integer NOT NULL,
    is_tied boolean DEFAULT false NOT NULL,
    below_floor boolean DEFAULT false NOT NULL,
    admin_override boolean DEFAULT false NOT NULL,
    was_overridden boolean DEFAULT false NOT NULL,
    original_amount integer,
    import_source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    override_reason text,
    CONSTRAINT round_payouts_per_player_check CHECK ((per_player >= 0)),
    CONSTRAINT round_payouts_place_check CHECK (((place >= 1) AND (place <= 4))),
    CONSTRAINT round_payouts_team_number_check CHECK ((team_number > 0)),
    CONSTRAINT round_payouts_team_size_check CHECK (((team_size >= 2) AND (team_size <= 4))),
    CONSTRAINT round_payouts_total_for_team_check CHECK ((total_for_team >= 0))
);


--
-- Name: round_payouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.round_payouts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.round_payouts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: round_player_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.round_player_actions (
    id bigint NOT NULL,
    round_player_id bigint NOT NULL,
    action text NOT NULL,
    hole integer,
    surface text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT round_player_actions_action_check CHECK ((action = ANY (ARRAY['mark_dropout'::text, 'undo_dropout'::text]))),
    CONSTRAINT round_player_actions_surface_check CHECK (((surface = ANY (ARRAY['admin'::text, 'scorecard'::text])) OR (surface IS NULL)))
);


--
-- Name: round_player_actions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.round_player_actions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.round_player_actions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: round_players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.round_players (
    id bigint NOT NULL,
    round_id bigint,
    player_id bigint,
    tee_id bigint,
    team_number integer,
    course_handicap integer,
    created_at timestamp with time zone DEFAULT now(),
    tee_order_priority integer DEFAULT 0,
    payout_amount numeric(6,2) DEFAULT 0.00,
    buy_in_amount numeric(6,2) DEFAULT 10.00,
    dropped_after_hole integer,
    handicap_index_snapshot numeric,
    hi_verified_at timestamp with time zone,
    CONSTRAINT round_players_dropped_after_hole_check CHECK (((dropped_after_hole >= 1) AND (dropped_after_hole <= 17)))
);


--
-- Name: round_players_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.round_players ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.round_players_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: rounds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rounds (
    id bigint NOT NULL,
    course_id bigint,
    played_on date NOT NULL,
    notes text,
    is_complete boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    format text,
    format_config jsonb DEFAULT '{"basis": "net", "best_n": 2, "override_holes": []}'::jsonb NOT NULL,
    format_locked_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    was_finalized boolean DEFAULT false NOT NULL,
    season_id integer,
    CONSTRAINT rounds_format_check CHECK ((format = ANY (ARRAY['2_ball'::text, '3_ball'::text, 'best_ball'::text, 'stableford_standard'::text, 'gobs_stableford'::text, 'shambles'::text, 'texas_scramble'::text, 'alternate_shot'::text])))
);


--
-- Name: rounds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.rounds ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.rounds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scores (
    id bigint NOT NULL,
    round_player_id bigint,
    hole_number integer NOT NULL,
    strokes integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT scores_hole_number_check CHECK (((hole_number >= 1) AND (hole_number <= 18))),
    CONSTRAINT scores_strokes_check CHECK (((strokes >= 1) AND (strokes <= 20)))
);


--
-- Name: scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scores ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: season_financials; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.season_financials AS
 SELECT p.full_name,
    count(rp.id) AS rounds_played,
    sum((rp.payout_amount - rp.buy_in_amount)) AS total_net_winnings,
    round(avg((rp.payout_amount - rp.buy_in_amount)), 2) AS avg_per_round
   FROM (public.players p
     JOIN public.round_players rp ON ((p.id = rp.player_id)))
  GROUP BY p.full_name;


--
-- Name: seasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seasons (
    id integer NOT NULL,
    name text NOT NULL,
    started_on date NOT NULL,
    ended_on date,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: seasons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seasons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seasons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.seasons_id_seq OWNED BY public.seasons.id;


--
-- Name: team_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_scores (
    id bigint NOT NULL,
    round_id bigint NOT NULL,
    team_number integer NOT NULL,
    hole_number integer NOT NULL,
    ball_index integer DEFAULT 1 NOT NULL,
    strokes integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT team_scores_ball_index_check CHECK (((ball_index >= 1) AND (ball_index <= 2))),
    CONSTRAINT team_scores_hole_number_check CHECK (((hole_number >= 1) AND (hole_number <= 18))),
    CONSTRAINT team_scores_strokes_check CHECK (((strokes >= 1) AND (strokes <= 20))),
    CONSTRAINT team_scores_team_number_check CHECK ((team_number > 0))
);


--
-- Name: team_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.team_scores ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.team_scores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tees ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.tees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: seasons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons ALTER COLUMN id SET DEFAULT nextval('public.seasons_id_seq'::regclass);


--
-- Name: blind_draws blind_draws_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_draws
    ADD CONSTRAINT blind_draws_pkey PRIMARY KEY (id);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);


--
-- Name: fund_transactions fund_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transactions
    ADD CONSTRAINT fund_transactions_pkey PRIMARY KEY (id);


--
-- Name: holes holes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holes
    ADD CONSTRAINT holes_pkey PRIMARY KEY (id);


--
-- Name: holes holes_tee_id_hole_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holes
    ADD CONSTRAINT holes_tee_id_hole_number_key UNIQUE (tee_id, hole_number);


--
-- Name: league_settings league_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_settings
    ADD CONSTRAINT league_settings_pkey PRIMARY KEY (key);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: round_payouts round_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_payouts
    ADD CONSTRAINT round_payouts_pkey PRIMARY KEY (id);


--
-- Name: round_player_actions round_player_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_player_actions
    ADD CONSTRAINT round_player_actions_pkey PRIMARY KEY (id);


--
-- Name: round_players round_players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_players
    ADD CONSTRAINT round_players_pkey PRIMARY KEY (id);


--
-- Name: round_players round_players_round_id_player_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_players
    ADD CONSTRAINT round_players_round_id_player_id_key UNIQUE (round_id, player_id);


--
-- Name: rounds rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rounds
    ADD CONSTRAINT rounds_pkey PRIMARY KEY (id);


--
-- Name: rounds rounds_played_on_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rounds
    ADD CONSTRAINT rounds_played_on_unique UNIQUE (played_on);


--
-- Name: scores scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_pkey PRIMARY KEY (id);


--
-- Name: scores scores_round_player_id_hole_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_round_player_id_hole_number_key UNIQUE (round_player_id, hole_number);


--
-- Name: seasons seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);


--
-- Name: team_scores team_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_scores
    ADD CONSTRAINT team_scores_pkey PRIMARY KEY (id);


--
-- Name: team_scores team_scores_round_team_hole_ball_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_scores
    ADD CONSTRAINT team_scores_round_team_hole_ball_key UNIQUE (round_id, team_number, hole_number, ball_index);


--
-- Name: tees tees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tees
    ADD CONSTRAINT tees_pkey PRIMARY KEY (id);


--
-- Name: blind_draws_round_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blind_draws_round_team_idx ON public.blind_draws USING btree (round_id, short_team_number);


--
-- Name: fund_transactions_fund_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_transactions_fund_idx ON public.fund_transactions USING btree (fund);


--
-- Name: fund_transactions_round_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_transactions_round_idx ON public.fund_transactions USING btree (round_id);


--
-- Name: idx_holes_tee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_holes_tee ON public.holes USING btree (tee_id);


--
-- Name: idx_round_players_player; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_round_players_player ON public.round_players USING btree (player_id);


--
-- Name: idx_round_players_round; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_round_players_round ON public.round_players USING btree (round_id);


--
-- Name: idx_rounds_played_on; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rounds_played_on ON public.rounds USING btree (played_on);


--
-- Name: idx_scores_round_player; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_round_player ON public.scores USING btree (round_player_id);


--
-- Name: round_payouts_round_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX round_payouts_round_idx ON public.round_payouts USING btree (round_id);


--
-- Name: round_payouts_round_team_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX round_payouts_round_team_uniq ON public.round_payouts USING btree (round_id, team_number);


--
-- Name: round_payouts_season_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX round_payouts_season_idx ON public.round_payouts USING btree (season_id);


--
-- Name: round_player_actions_rp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX round_player_actions_rp_idx ON public.round_player_actions USING btree (round_player_id, created_at);


--
-- Name: seasons_only_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX seasons_only_one_active ON public.seasons USING btree (is_active) WHERE (is_active = true);


--
-- Name: team_scores_round_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_scores_round_team_idx ON public.team_scores USING btree (round_id, team_number);


--
-- Name: rounds rounds_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER rounds_set_updated_at BEFORE UPDATE ON public.rounds FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();


--
-- Name: rounds trg_rounds_was_finalized_latch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rounds_was_finalized_latch BEFORE UPDATE OF is_complete ON public.rounds FOR EACH ROW EXECUTE FUNCTION public.rounds_was_finalized_latch();


--
-- Name: blind_draws blind_draws_drawn_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_draws
    ADD CONSTRAINT blind_draws_drawn_player_id_fkey FOREIGN KEY (drawn_player_id) REFERENCES public.players(id);


--
-- Name: blind_draws blind_draws_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_draws
    ADD CONSTRAINT blind_draws_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE;


--
-- Name: fund_transactions fund_transactions_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transactions
    ADD CONSTRAINT fund_transactions_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE SET NULL;


--
-- Name: holes holes_tee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holes
    ADD CONSTRAINT holes_tee_id_fkey FOREIGN KEY (tee_id) REFERENCES public.tees(id) ON DELETE CASCADE;


--
-- Name: players players_preferred_tee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_preferred_tee_id_fkey FOREIGN KEY (preferred_tee_id) REFERENCES public.tees(id) ON DELETE SET NULL;


--
-- Name: round_payouts round_payouts_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_payouts
    ADD CONSTRAINT round_payouts_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE;


--
-- Name: round_payouts round_payouts_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_payouts
    ADD CONSTRAINT round_payouts_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);


--
-- Name: round_player_actions round_player_actions_round_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_player_actions
    ADD CONSTRAINT round_player_actions_round_player_id_fkey FOREIGN KEY (round_player_id) REFERENCES public.round_players(id) ON DELETE CASCADE;


--
-- Name: round_players round_players_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_players
    ADD CONSTRAINT round_players_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: round_players round_players_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_players
    ADD CONSTRAINT round_players_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE;


--
-- Name: round_players round_players_tee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.round_players
    ADD CONSTRAINT round_players_tee_id_fkey FOREIGN KEY (tee_id) REFERENCES public.tees(id);


--
-- Name: rounds rounds_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rounds
    ADD CONSTRAINT rounds_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id);


--
-- Name: rounds rounds_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rounds
    ADD CONSTRAINT rounds_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);


--
-- Name: scores scores_round_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_round_player_id_fkey FOREIGN KEY (round_player_id) REFERENCES public.round_players(id) ON DELETE CASCADE;


--
-- Name: team_scores team_scores_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_scores
    ADD CONSTRAINT team_scores_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE;


--
-- Name: tees tees_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tees
    ADD CONSTRAINT tees_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: courses Allow all on courses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all on courses" ON public.courses USING (true) WITH CHECK (true);


--
-- Name: holes Allow all on holes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all on holes" ON public.holes USING (true) WITH CHECK (true);


--
-- Name: players Allow all on players; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all on players" ON public.players USING (true) WITH CHECK (true);


--
-- Name: round_players Allow all on round_players; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all on round_players" ON public.round_players USING (true) WITH CHECK (true);


--
-- Name: rounds Allow all on rounds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all on rounds" ON public.rounds USING (true) WITH CHECK (true);


--
-- Name: scores Allow all on scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all on scores" ON public.scores USING (true) WITH CHECK (true);


--
-- Name: team_scores Allow all on team_scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all on team_scores" ON public.team_scores USING (true) WITH CHECK (true);


--
-- Name: tees Allow all on tees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all on tees" ON public.tees USING (true) WITH CHECK (true);


--
-- Name: league_settings Anyone can read settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read settings" ON public.league_settings FOR SELECT USING (true);


--
-- Name: league_settings Anyone can update settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can update settings" ON public.league_settings FOR UPDATE USING (true);


--
-- Name: courses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

--
-- Name: fund_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fund_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: fund_transactions fund_transactions public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "fund_transactions public read" ON public.fund_transactions FOR SELECT USING (true);


--
-- Name: holes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.holes ENABLE ROW LEVEL SECURITY;

--
-- Name: league_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

--
-- Name: round_payouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.round_payouts ENABLE ROW LEVEL SECURITY;

--
-- Name: round_payouts round_payouts public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "round_payouts public read" ON public.round_payouts FOR SELECT USING (true);


--
-- Name: round_players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.round_players ENABLE ROW LEVEL SECURITY;

--
-- Name: rounds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;

--
-- Name: scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

--
-- Name: team_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: tees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tees ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict yondieXvwNzBzJSkmmT6fLEAmf0Fo2ehH0IsK7aWn2sqpvTynfgdzbgXF1ki3Rv

