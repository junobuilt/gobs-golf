-- Phase 1C — Team-card NET formats (Texas Scramble, Alternate Shot).
--
-- These formats play ONE team ball and record one gross score per hole in
-- `team_scores` (migration 018), with NO per-player `scores` rows. Net is a
-- single deduction off the team gross (computed client-side from members' full
-- course handicaps — see lib/scoring/teamHandicap.ts). They are NEVER played
-- with unbalanced teams (locked league rule), so there is no blind draw and no
-- short-team handling.
--
-- finalize_round_relaxed (migration 020) is wrong for them: its completion floor
-- reads the individual `scores` table, so a team-card round (which has none)
-- would return 'not_yet' forever. This adds a SEPARATE finalize path that reads
-- `team_scores`.
--
-- Adds:
--   1. `finalize_round_team_card(round_id)`:
--        * Serializes on the rounds row (FOR UPDATE), mirroring RPC 008 / 020.
--        * 'already_complete' if already finalized.
--        * Completion FLOOR: every assigned team (team_number > 0) must have a
--          `team_scores` row on every hole 1..18. Any (team, hole) with no row
--          → 'not_yet' (the client computes the precise "Team N has no score on
--          hole H" message from its own state).
--        * No blind-draw loop, no blind_draws rows written.
--        * Flips rounds.is_complete = true and returns 'finalized'.
--        Returns one of: 'not_yet' | 'already_complete' | 'finalized'. Raises
--        'round_not_found' (P0002) if the round id doesn't exist.
--   2. Extends `rounds_format_check` to allow 'texas_scramble' + 'alternate_shot'.
--      Additive only — every existing round keeps its current format.
--
-- Payout persistence is unchanged: it stays client-side (after the RPC returns
-- 'finalized'/'already_complete' the team-card surface calls
-- persistPayoutsAfterFinalize), identical to the individual scorecard's path.
--
-- Rollback:
--   BEGIN;
--   DROP FUNCTION IF EXISTS finalize_round_team_card(bigint);
--   ALTER TABLE public.rounds DROP CONSTRAINT IF EXISTS rounds_format_check;
--   ALTER TABLE public.rounds ADD CONSTRAINT rounds_format_check
--     CHECK (format = ANY (ARRAY['2_ball','3_ball','best_ball',
--       'stableford_standard','gobs_stableford','shambles']));
--   COMMIT;

BEGIN;

-- 1. Allow the two new NET team-card formats.
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
    'alternate_shot'::text
  ]));

-- 2. Team-card finalize.
CREATE OR REPLACE FUNCTION finalize_round_team_card(p_round_id bigint)
RETURNS text
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

  -- Completion FLOOR: every assigned team must have a team_scores row on every
  -- hole 1..18. (One team ball per hole — no per-player gaps to tolerate.)
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

  -- No blind draw for team-card — balanced teams only.
  UPDATE rounds SET is_complete = true WHERE id = p_round_id;
  RETURN 'finalized';
END;
$$;

COMMIT;
