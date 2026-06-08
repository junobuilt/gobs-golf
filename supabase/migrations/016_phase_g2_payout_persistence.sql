-- Phase G2 (Session 2) — Payout + fund persistence.
--
-- Adds:
--   1. round_payouts      — one row per (round, placing team). Ties produce
--      multiple rows at the same place. Immutable once written except the
--      Session-4 admin override (was_overridden + original_amount).
--   2. fund_transactions  — append-only money ledger. One row per movement
--      (HiO/BFB buy-in contributions, the BFB sweep, reopen reversals, future
--      resets/imports). Reversals are balancing NEGATIVE entries, never deletes.
--   3. fund_balances      — VIEW deriving the running total per fund from the
--      ledger. Funds are GLOBAL (not season-scoped). No cached table → no drift.
--   4. persist_round_payouts(p_round_id, p_payload jsonb) — SECURITY DEFINER.
--      In ONE transaction: replace the round's payout rows and (idempotently)
--      credit its funds. Safe to re-run (recovery).
--   5. reverse_round_payouts(p_round_id) — SECURITY DEFINER. Deletes the
--      round's payout rows and inserts per-fund balancing entries so the
--      round's net fund contribution returns to zero. Idempotent.
--
-- RLS posture (no Supabase-auth model exists in this app — admin is a route
-- layer PIN, so auth.uid() RLS is meaningless): RLS ENABLED with a public
-- SELECT policy (the app reads payouts/funds for display) and NO write
-- policies. The two RPCs are SECURITY DEFINER, so they are the ONLY write
-- path — direct INSERT/UPDATE/DELETE from the anon client is blocked by RLS.
-- This is achievable here precisely because every payout write goes through an
-- RPC (unlike scores, which the client writes directly).
--
-- Applied via Supabase MCP apply_migration, which runs transactionally — so no
-- explicit BEGIN/COMMIT here (matches migration 014's convention).
--
-- Scope: does NOT backfill existing finalized rounds. Only rounds finalized
-- after this ships get payout rows (historical import is Session 3).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS reverse_round_payouts(bigint);
--   DROP FUNCTION IF EXISTS persist_round_payouts(bigint, jsonb);
--   DROP VIEW IF EXISTS fund_balances;
--   DROP TABLE IF EXISTS fund_transactions;
--   DROP TABLE IF EXISTS round_payouts;

-- 1. round_payouts ----------------------------------------------------------
CREATE TABLE round_payouts (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  round_id        bigint NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  season_id       integer REFERENCES seasons(id),       -- stamped from rounds.season_id by the RPC
  team_number     integer NOT NULL CHECK (team_number > 0),
  place           integer NOT NULL CHECK (place BETWEEN 1 AND 4),
  per_player      integer NOT NULL CHECK (per_player >= 0),
  team_size       integer NOT NULL CHECK (team_size BETWEEN 2 AND 4),
  total_for_team  integer NOT NULL CHECK (total_for_team >= 0),
  is_tied         boolean NOT NULL DEFAULT false,
  below_floor     boolean NOT NULL DEFAULT false,
  admin_override  boolean NOT NULL DEFAULT false,
  was_overridden  boolean NOT NULL DEFAULT false,
  original_amount integer,                               -- null until a Session-4 override
  import_source   text,                                  -- null = engine-computed
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX round_payouts_round_idx  ON round_payouts(round_id);
CREATE INDEX round_payouts_season_idx ON round_payouts(season_id);
-- A team appears at most once per round; ties = multiple teams sharing a place,
-- which this still allows (uniqueness is per team, not per place).
CREATE UNIQUE INDEX round_payouts_round_team_uniq ON round_payouts(round_id, team_number);

-- 2. fund_transactions ------------------------------------------------------
CREATE TABLE fund_transactions (
  id         bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  fund       text NOT NULL CHECK (fund IN ('hio','bfb')),
  amount     integer NOT NULL,          -- signed whole dollars: +credit, -reversal
  reason     text NOT NULL,             -- 'buyin_hio' | 'buyin_bfb' | 'sweep' | 'reopen_reversal' | ...
  round_id   bigint REFERENCES rounds(id) ON DELETE SET NULL,  -- nullable; SET NULL preserves the audit row
  source     text NOT NULL CHECK (source IN ('finalize','reopen_reversal','reset','import')),
  created_by text,                       -- admin identifier where applicable; nullable
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fund_transactions_fund_idx  ON fund_transactions(fund);
CREATE INDEX fund_transactions_round_idx ON fund_transactions(round_id);

-- 3. fund_balances VIEW -----------------------------------------------------
-- Always returns both funds (LEFT JOIN against a fixed fund list) so a fund
-- with no movements yet still reports a 0 balance.
CREATE VIEW fund_balances AS
SELECT f.fund,
       COALESCE(SUM(t.amount), 0)::int AS balance,
       MAX(t.created_at)               AS last_movement
FROM (VALUES ('hio'), ('bfb')) AS f(fund)
LEFT JOIN fund_transactions t ON t.fund = f.fund
GROUP BY f.fund;

-- 4. persist_round_payouts --------------------------------------------------
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
     total_for_team, is_tied, below_floor)
  SELECT
    p_round_id, v_season_id, x.team_number, x.place, x.per_player, x.team_size,
    x.total_for_team, x.is_tied, x.below_floor
  FROM jsonb_to_recordset(p_payload -> 'payouts') AS x(
    team_number integer, place integer, per_player integer, team_size integer,
    total_for_team integer, is_tied boolean, below_floor boolean
  );

  -- Idempotency guard: credit funds only when the round has no live (net-nonzero
  -- per fund) contributions. Re-running while active is a no-op; after a reopen
  -- reversal (net 0) a re-finalize re-credits cleanly.
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

-- 5. reverse_round_payouts --------------------------------------------------
CREATE OR REPLACE FUNCTION reverse_round_payouts(p_round_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Append one balancing negative entry per fund so the round's net returns to
  -- zero. GROUP BY ... HAVING SUM<>0 makes this correct across any
  -- finalize/reopen history and idempotent (already-zero → inserts nothing).
  INSERT INTO fund_transactions (fund, amount, reason, round_id, source)
  SELECT fund, -SUM(amount), 'reopen_reversal', p_round_id, 'reopen_reversal'
  FROM fund_transactions
  WHERE round_id = p_round_id
  GROUP BY fund
  HAVING SUM(amount) <> 0;

  DELETE FROM round_payouts WHERE round_id = p_round_id;
END;
$$;

-- 6. RLS --------------------------------------------------------------------
ALTER TABLE round_payouts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_transactions ENABLE ROW LEVEL SECURITY;

-- Public read (display). No write policies → direct anon writes are denied;
-- the SECURITY DEFINER RPCs above are the only write path.
CREATE POLICY "round_payouts public read"
  ON round_payouts FOR SELECT USING (true);
CREATE POLICY "fund_transactions public read"
  ON fund_transactions FOR SELECT USING (true);
