-- Phase 1B — Team-card scoring spine (Shambles).
--
-- The app today assumes every player owns an individual scorecard: scores live
-- in `scores`, keyed per `round_player` per hole. Team-card formats (Shambles,
-- and later Texas Scramble / 1 Score Only / Alternate Shot) score at the TEAM
-- level instead — one number per hole, no individual scores. This migration
-- adds the storage for that, kept strictly separate from `scores` so a team
-- score can never leak into a per-player surface.
--
-- Adds:
--   1. `team_scores` — one row per counting ball per hole per team, keyed by
--      (round_id, team_number, hole_number, ball_index). Count-1 formats write
--      one row per hole (ball_index 1); count-2 (Shambles best-2) write two
--      rows whose SUM is the hole's team score. UNIQUE on the full key gives
--      per-box last-write-wins (two phones editing the same card is acceptable
--      by spec; no conflict UI). RLS mirrors `scores`: enabled + allow-all,
--      since the team-card entry surface writes directly from the client.
--   2. Extends `rounds_format_check` to allow the 'shambles' format value.
--      Additive only — every existing round keeps its current format and is
--      unaffected. The ball count itself lives in `rounds.format_config`
--      (`team_ball_count`, default 1), not a column.
--
-- Ball count is NOT a column: it is per-round config in format_config JSONB,
-- read via getTeamBallCount() (lib/format/helpers.ts), consistent with the
-- existing handicap_allowance / override_holes / submitted_teams keys.
--
-- Rollback:
--   BEGIN;
--   ALTER TABLE public.rounds DROP CONSTRAINT IF EXISTS rounds_format_check;
--   ALTER TABLE public.rounds ADD CONSTRAINT rounds_format_check
--     CHECK (format = ANY (ARRAY['2_ball','3_ball','best_ball',
--       'stableford_standard','gobs_stableford']));
--   DROP TABLE IF EXISTS public.team_scores;
--   COMMIT;

BEGIN;

-- 1. team_scores
CREATE TABLE public.team_scores (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  round_id     bigint NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  team_number  integer NOT NULL CHECK (team_number > 0),
  hole_number  integer NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  ball_index   integer NOT NULL DEFAULT 1 CHECK (ball_index BETWEEN 1 AND 2),
  strokes      integer NOT NULL CHECK (strokes BETWEEN 1 AND 20),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_scores_round_team_hole_ball_key
    UNIQUE (round_id, team_number, hole_number, ball_index)
);
CREATE INDEX team_scores_round_team_idx
  ON public.team_scores (round_id, team_number);

-- RLS: mirror `scores` (allow-all). Client writes team scores directly via the
-- publishable key, same as individual scores.
ALTER TABLE public.team_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on team_scores"
  ON public.team_scores USING (true) WITH CHECK (true);

-- 2. Allow 'shambles' as a round format.
ALTER TABLE public.rounds DROP CONSTRAINT IF EXISTS rounds_format_check;
ALTER TABLE public.rounds ADD CONSTRAINT rounds_format_check
  CHECK (format = ANY (ARRAY[
    '2_ball'::text,
    '3_ball'::text,
    'best_ball'::text,
    'stableford_standard'::text,
    'gobs_stableford'::text,
    'shambles'::text
  ]));

COMMIT;
