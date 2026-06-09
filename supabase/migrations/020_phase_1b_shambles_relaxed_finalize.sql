-- Phase 1B follow-up — Shambles relaxed-close finalize.
--
-- Shambles was rebuilt from a team-card (gross, one score per hole) format into
-- an individual best-ball NET format. It allows a RELAXED CLOSE: players pick up,
-- so a hole's team score is the best N net among the scores PRESENT, and the
-- round finalizes WITHOUT any blind draw (short teams simply play short).
--
-- finalize_round_with_blind_draws (migration 008) is wrong for this: its
-- completion check demands every assigned player score every hole, and it runs
-- the blind-draw loop. Rather than branch that battle-tested RPC, this adds a
-- SEPARATE finalize path used only by relaxed-close formats (Shambles today).
--
-- finalize_round_relaxed(round_id):
--   * Serializes on the rounds row (FOR UPDATE), mirroring RPC 008.
--   * 'already_complete' if already finalized.
--   * Completion FLOOR: for each assigned team (team_number > 0) and each hole
--     1..18, at least ONE player on the team must have a score. Any (team, hole)
--     with zero scores → 'not_yet' (the client computes the precise
--     "Team N has no score on hole H" message from its own state).
--   * No blind-draw loop, no blind_draws rows written.
--   * Flips rounds.is_complete = true and returns 'finalized'.
--   Returns one of: 'not_yet' | 'already_complete' | 'finalized'. Raises
--   'round_not_found' (P0002) if the round id doesn't exist.
--
-- Payout persistence is unchanged: it stays client-side (after the RPC returns
-- 'finalized'/'already_complete' the scorecard calls computeAndPersistRoundPayouts),
-- identical to the blind-draw path.
--
-- Rollback:
--   BEGIN;
--   DROP FUNCTION IF EXISTS finalize_round_relaxed(bigint);
--   COMMIT;

BEGIN;

CREATE OR REPLACE FUNCTION finalize_round_relaxed(p_round_id bigint)
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

  -- Relaxed completion FLOOR: every assigned team must have at least one score
  -- on every hole 1..18. A team-hole with zero scores blocks finalize. (Unlike
  -- RPC 008, individual players may have gaps — they picked up.)
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

COMMIT;
