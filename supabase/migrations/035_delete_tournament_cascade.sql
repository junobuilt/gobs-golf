-- 035_delete_tournament_cascade.sql
-- Self-serve safe teardown for a tournament. ADDITIVE + REVERSIBLE.
--
-- APPLIED TO PROD 2026-07-27 from the planning chat via Supabase MCP
-- (apply_migration, name `035_delete_tournament_cascade`; dry-run then applied by
-- the owner). This file is the EXACT SQL that was relayed and applied — do NOT
-- re-apply.
--
-- WHY AN RPC: deleting a tournament must be transactional AND leak-safe.
--   rounds.tournament_id -> tournaments is ON DELETE SET NULL (migration 031),
--   so deleting the tournaments row FIRST would strand its rounds as
--   NULL-tournament orphans that look exactly like league rounds — corrupting
--   league history. The leak-safe order is: delete the tournament's ROUNDS
--   first, THEN the tournament row.
--
--   Deleting rounds WHERE tournament_id = p_tournament_id cascades to:
--     round_players (rounds ON DELETE CASCADE) -> scores (round_players CASCADE),
--     team_scores (rounds CASCADE),
--     tournament_sessions (round_id ON DELETE CASCADE since migration 032)
--        -> tournament_matches (session_id CASCADE).
--   Deleting the tournament row then cascades tournament_players and
--   tournament_point_adjustments (tournament_id CASCADE), plus any leftovers.
--
--   Every statement filters ONLY on the tournament id, so a league round
--   (tournament_id IS NULL, or a different tournament) can NEVER be touched.
--   Keeping the SQL in the function (not app code) also keeps `from("rounds")`
--   out of src/ so roundsQueryGuard is untouched.
--
-- SECURITY: SECURITY DEFINER, same posture as the payout RPCs
-- (reset_fund / override_round_payout). Callable by the API roles — the admin
-- surface is middleware-gated, not RLS-gated. (Parked on TD34's RLS list.)
--
-- REVERT: DROP FUNCTION IF EXISTS delete_tournament_cascade(bigint);

CREATE OR REPLACE FUNCTION delete_tournament_cascade(p_tournament_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rounds_deleted     integer := 0;
  v_tournament_deleted integer := 0;
BEGIN
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'delete_tournament_cascade: p_tournament_id is required';
  END IF;

  -- Rounds FIRST (leak-safe; cascades scores/team_scores/round_players/
  -- sessions/matches). Scoped to this tournament only.
  DELETE FROM rounds WHERE tournament_id = p_tournament_id;
  GET DIAGNOSTICS v_rounds_deleted = ROW_COUNT;

  -- Then the tournament (cascades tournament_players + point_adjustments).
  DELETE FROM tournaments WHERE id = p_tournament_id;
  GET DIAGNOSTICS v_tournament_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'rounds_deleted',     v_rounds_deleted,
    'tournament_deleted', v_tournament_deleted = 1
  );
END;
$$;
