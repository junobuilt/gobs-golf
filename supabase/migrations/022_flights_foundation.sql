-- Flights Track, Session 1 — Foundation (schema + format ownership move).
--
-- "Flights" are sub-competitions within a round: a flight owns format,
-- format_config (the format-behavior keys), the format lock, the handicap
-- allowance, and later its own payout run. The round becomes a container
-- (date / course / season). This migration is the additive, reversible
-- foundation: it adds the two tables and backfills exactly one flight per
-- existing round so the app behaves IDENTICALLY (every round has one flight).
--
-- INVARIANT (no format qualifier): every row in `rounds` gets exactly one
-- flight — INCLUDING rounds whose format is still null (shells where no format
-- has been chosen yet). The flight mirrors the round's not-yet-chosen state
-- (format null, flight-level config copied as-is).
--
-- Adds:
--   1. `flights` — id, round_id FK, name, sort_order, format (same CHECK set as
--      rounds.format, plus NULL for unchosen shells), format_config jsonb
--      (FLIGHT-level keys only — submitted_teams stays round-level), and the
--      format lock. UNIQUE (round_id, sort_order).
--   2. `flight_teams` — maps a team_number to its flight. UNIQUE (round_id,
--      team_number) so a team belongs to at most one flight; round_id is
--      denormalized deliberately so that uniqueness can span flights within a
--      round (a flight_id-only key could not). NOT backfilled — the resolution
--      helper's default rule (no flight_teams row → the round's first flight)
--      covers every existing team.
--
-- Key split (FLIGHT vs ROUND) for format_config, locked in the Session 1 plan:
--   FLIGHT-level (copied to flights.format_config): scoring_basis, basis,
--     best_n, point_values, override_holes, handicap_allowance, team_ball_count.
--   ROUND-level (left on rounds.format_config): submitted_teams.
--   The backfill copies `format_config - 'submitted_teams'` to the flight,
--   which is exactly the flight-level set today (submitted_teams is the only
--   round-level key).
--
-- FROZEN legacy: rounds.format, the flight-level keys of rounds.format_config,
-- and rounds.format_locked_at are NOT dropped here. After Session 1's code
-- changes nothing reads or writes them; a later cleanup migration drops them
-- once Sessions 2–4 are stable. The backfill does NOT modify any `rounds` row.
--
-- Rollback:
--   BEGIN;
--   DROP TABLE IF EXISTS public.flight_teams;
--   DROP TABLE IF EXISTS public.flights;
--   COMMIT;

BEGIN;

-- 1. flights
CREATE TABLE public.flights (
  id               bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  round_id         bigint NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  name             text NOT NULL,
  sort_order       integer NOT NULL,
  format           text,
  format_config    jsonb,
  format_locked_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flights_round_sort_key UNIQUE (round_id, sort_order),
  CONSTRAINT flights_format_check CHECK (
    format IS NULL OR format = ANY (ARRAY[
      '2_ball'::text,
      '3_ball'::text,
      'best_ball'::text,
      'stableford_standard'::text,
      'gobs_stableford'::text,
      'shambles'::text,
      'texas_scramble'::text,
      'alternate_shot'::text
    ])
  )
);
CREATE INDEX flights_round_idx ON public.flights (round_id);

-- RLS: mirror `rounds` (enabled + allow-all). The admin + scorecard surfaces
-- read and write flight format/config directly from the client.
ALTER TABLE public.flights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on flights"
  ON public.flights USING (true) WITH CHECK (true);

-- 2. flight_teams
CREATE TABLE public.flight_teams (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  flight_id   bigint NOT NULL REFERENCES public.flights(id) ON DELETE CASCADE,
  round_id    bigint NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  team_number integer NOT NULL CHECK (team_number > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flight_teams_round_team_key UNIQUE (round_id, team_number)
);
CREATE INDEX flight_teams_flight_idx ON public.flight_teams (flight_id);

ALTER TABLE public.flight_teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on flight_teams"
  ON public.flight_teams USING (true) WITH CHECK (true);

-- 3. Backfill: one Flight A per round, INCLUDING rounds with format = null.
--    Format + lock copy the round's values verbatim (may be null). format_config
--    copies every key EXCEPT submitted_teams (the only round-level key).
INSERT INTO public.flights
  (round_id, name, sort_order, format, format_config, format_locked_at)
SELECT
  r.id,
  'Flight A',
  1,
  r.format,
  r.format_config - 'submitted_teams',
  r.format_locked_at
FROM public.rounds r;

-- 4. Sanity check on EVERY row in `rounds` (no format qualifier): each round
--    must have exactly one sort_order=1 flight, and the total count of
--    sort_order=1 flights must equal the rounds count. Abort otherwise.
DO $$
DECLARE
  v_rounds  bigint;
  v_flights bigint;
  v_bad     bigint;
BEGIN
  SELECT COUNT(*) INTO v_rounds  FROM public.rounds;
  SELECT COUNT(*) INTO v_flights FROM public.flights WHERE sort_order = 1;

  IF v_flights <> v_rounds THEN
    RAISE EXCEPTION
      'flights backfill mismatch: % rounds but % sort_order=1 flights',
      v_rounds, v_flights;
  END IF;

  SELECT COUNT(*) INTO v_bad
  FROM public.rounds r
  LEFT JOIN (
    SELECT round_id, COUNT(*) AS c
    FROM public.flights
    WHERE sort_order = 1
    GROUP BY round_id
  ) f ON f.round_id = r.id
  WHERE COALESCE(f.c, 0) <> 1;

  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      '% round(s) do not have exactly one Flight A', v_bad;
  END IF;
END $$;

COMMIT;
