-- Flights Track, Session 5 — blind-draw higher-of-two payout reconciliation.
--
-- Dad's rule: a blind-draw fill player is associated with TWO per-player shares
-- — one on his OWN team (he's rostered there) and one on the DRAWING team (the
-- fill slot is part of that team's team_size). He keeps the HIGHER share; the
-- LOWER team forfeits one share, which sweeps to BFB. The reconciliation runs
-- client-side in persistRoundPayouts.ts (it reads loadRoundResults' blindDraws,
-- no new query) and decrements the losing team's total_for_team in the payload.
--
-- This migration records WHICH team forfeited how many shares so the Winnings
-- tab can render "−N share ($X) → BFB" — the team's total_for_team is already
-- NET of the forfeited shares, so the count makes the redirect explicit (rather
-- than inferring it from total_for_team / per_player arithmetic).
--
-- The swept dollars are recorded in fund_transactions with a DISTINCT reason
-- 'blind_draw_redirect' (a free-text reason — no schema change; the funds branch
-- of persist_round_payouts already inserts arbitrary reasons from the payload).
--
-- Additive + reversible:
--   * One NEW column, NOT NULL DEFAULT 0. Every historical payout row keeps 0
--     (no redirect) → the Winnings read renders them exactly as before.
--   * No backfill, no data rewrite. No backup needed (purely additive).
--
-- persist_round_payouts is replaced to accept (and INSERT) redirected_share_count
-- from the payouts recordset. The funds branch is UNCHANGED.
--
-- Applied via Supabase MCP apply_migration (transactional) — matches 016/023's
-- convention (no explicit BEGIN/COMMIT here).
--
-- Rollback:
--   -- restore the migration-023 function body (without redirected_share_count),
--   -- then:
--   ALTER TABLE round_payouts DROP COLUMN IF EXISTS redirected_share_count;

-- 1. Additive column --------------------------------------------------------
ALTER TABLE round_payouts
  ADD COLUMN redirected_share_count integer NOT NULL DEFAULT 0
    CHECK (redirected_share_count >= 0);

-- 2. persist_round_payouts — now carries the redirect marker -----------------
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
     total_for_team, is_tied, below_floor, flight_id, flight_name,
     redirected_share_count)
  SELECT
    p_round_id, v_season_id, x.team_number, x.place, x.per_player, x.team_size,
    x.total_for_team, x.is_tied, x.below_floor, x.flight_id, x.flight_name,
    COALESCE(x.redirected_share_count, 0)
  FROM jsonb_to_recordset(p_payload -> 'payouts') AS x(
    team_number integer, place integer, per_player integer, team_size integer,
    total_for_team integer, is_tied boolean, below_floor boolean,
    flight_id bigint, flight_name text, redirected_share_count integer
  );

  -- Idempotency guard: credit funds only when the round has no live (net-nonzero
  -- per fund) contributions. Re-running while active is a no-op; after a reopen
  -- reversal (net 0) a re-finalize re-credits cleanly. UNCHANGED from 016/023.
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
