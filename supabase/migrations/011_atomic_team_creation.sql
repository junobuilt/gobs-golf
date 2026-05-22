-- 011 — Atomic team creation RPC.
--
-- Replaces the client-side "compute nextTeamNumber from local
-- roundPlayers state, then INSERT each row with that number" pattern.
-- That pattern collides when:
--   (a) two devices compute nextTeamNumber concurrently from the same
--       baseline and both write the same number (concurrent race), OR
--   (b) one device's roundPlayers state is stale relative to the DB
--       because another device created a team since it loaded
--       (sequential stale-data collision — no realtime sub on homepage).
--
-- Fix: do the MAX(team_number) lookup and the INSERTs inside a single
-- transactional function, under a SELECT FOR UPDATE on the rounds row,
-- so concurrent calls serialize and each sees the previous call's
-- writes when computing its own next number.
--
-- The function inserts round_players rows with tee_id NULL and
-- course_handicap NULL. The existing scorecard LT1 self-heal computes
-- and persists course_handicap on first load once the user picks a tee
-- in the Tee Selection setup screen, so leaving CH null at insert time
-- is consistent with the pre-existing upsertPlayerToTeam path.
--
-- Rollback (reference only):
--   DROP FUNCTION create_team_with_players(integer, integer[], numeric[]);

CREATE OR REPLACE FUNCTION create_team_with_players(
  p_round_id integer,
  p_player_ids integer[],
  p_handicap_snapshots numeric[]
) RETURNS integer
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
