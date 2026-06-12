-- Flights Track, Session 3 — per-flight payout attribution.
--
-- Stamp each round_payouts row with the FLIGHT it was computed under, snapshotted
-- at persist time. Per-flight payout runs (one engine call per non-empty flight)
-- need a stable flight identity on the payout row so the Winnings tab can group a
-- round's payouts by flight. Resolving the flight at READ time via flight_teams
-- would DRIFT if teams move flights after finalize — hence a persisted snapshot
-- (flight_id + a denormalized flight_name, so the label survives a flight rename
-- or delete too).
--
-- Additive + reversible:
--   * Two NULLABLE columns. No backfill, no data rewrite.
--   * Every historical finalized round is single-flight; its existing payout rows
--     keep flight_id / flight_name NULL. The Winnings read treats NULL as
--     "ungrouped / single-flight" → renders exactly as before.
--   * No backup needed (purely additive; no destructive change).
--
-- persist_round_payouts is replaced to accept (and INSERT) flight_id + flight_name
-- from the payouts recordset. The funds branch is UNCHANGED.
--
-- Applied via Supabase MCP apply_migration (transactional) — matches 016's
-- convention (no explicit BEGIN/COMMIT here).
--
-- Rollback:
--   -- restore the migration-016 function body (without the two flight columns),
--   -- then:
--   ALTER TABLE round_payouts DROP COLUMN IF EXISTS flight_name;
--   ALTER TABLE round_payouts DROP COLUMN IF EXISTS flight_id;

-- 1. Additive columns -------------------------------------------------------
ALTER TABLE round_payouts
  ADD COLUMN flight_id   bigint REFERENCES flights(id),
  ADD COLUMN flight_name text;

-- 2. persist_round_payouts — now flight-aware --------------------------------
CREATE OR REPLACE FUNCTION persist_round_payouts(p_round_id bigint, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id integer;
BEGIN
  SELECT season_id INTO v_season_id FROM rounds WHERE id = p_round_id;

  -- Replace this round's payout rows (idempotent; engine output is deterministic).
  DELETE FROM round_payouts WHERE round_id = p_round_id;

  INSERT INTO round_payouts
    (round_id, season_id, team_number, place, per_player, team_size,
     total_for_team, is_tied, below_floor, flight_id, flight_name)
  SELECT
    p_round_id, v_season_id, x.team_number, x.place, x.per_player, x.team_size,
    x.total_for_team, x.is_tied, x.below_floor, x.flight_id, x.flight_name
  FROM jsonb_to_recordset(p_payload -> 'payouts') AS x(
    team_number integer, place integer, per_player integer, team_size integer,
    total_for_team integer, is_tied boolean, below_floor boolean,
    flight_id bigint, flight_name text
  );

  -- Idempotency guard: credit funds only when the round has no live (net-nonzero
  -- per fund) contributions. Re-running while active is a no-op; after a reopen
  -- reversal (net 0) a re-finalize re-credits cleanly. UNCHANGED from 016.
  IF NOT EXISTS (
    SELECT 1 FROM fund_transactions
    WHERE round_id = p_round_id
    GROUP BY fund
    HAVING SUM(amount) <> 0
  ) THEN
    INSERT INTO fund_transactions (fund, amount, reason, round_id, source)
    SELECT f.fund, f.amount, f.reason, p_round_id, 'finalize'
    FROM jsonb_to_recordset(p_payload -> 'funds') AS f(
      fund text, amount integer, reason text
    );
  END IF;
END;
$$;
