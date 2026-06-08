-- Phase G2 (Session 4b) — Fund reset write surface.
--
-- Adds:
--   1. fund_transactions.note  — nullable free-text column holding the admin's
--      REQUIRED human reason for a reset (mockup: "record reset amount, reason,
--      timestamp, and admin user"). `reason` stays CATEGORICAL ('reset') so the
--      existing REASON_LABELS mapping + the append-only conventions from 016 are
--      preserved. All pre-existing rows get note = NULL.
--   2. reset_fund(p_fund, p_reason, p_created_by) — SECURITY DEFINER. Zeroes a
--      fund by APPENDING one balancing ledger entry (amount = -current_balance),
--      never deleting history (same principle as reverse_round_payouts). The
--      balance is recomputed INSIDE the transaction (no stale client read).
--      Validates p_fund IN ('hio','bfb') and a non-blank reason; raises otherwise.
--
-- Funds are GLOBAL (not season-scoped), matching the fund_balances view. A reset
-- of an already-$0 fund writes a harmless $0 entry (the action is still audited).
-- created_by defaults to 'admin' — the app has no per-user identity (shared PIN
-- gate), matching the null/constant attribution of the 016 RPCs.
--
-- RLS posture (unchanged from 016): RLS on, public SELECT, NO write policies →
-- this SECURITY DEFINER RPC is the ONLY write path; the client cannot INSERT
-- fund_transactions directly. No new policy needed.
--
-- Known limitation (accepted, S4b): a reset zeroes the CURRENT total. Reopening
-- a round whose contributions PREDATE a reset will append that round's negative
-- reversal and can drive the fund balance negative (the reset already removed
-- that money). This is honest append-only accounting, not special-cased here.
--
-- Applied via Supabase MCP apply_migration (runs transactionally) on 2026-06-08
-- after a transaction-rollback dry-run on prod confirmed clean apply,
-- reset-to-0, empty-reason + bad-fund rejection, and already-$0 behavior, with
-- prod verified untouched post-rollback.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS reset_fund(text, text, text);
--   ALTER TABLE fund_transactions DROP COLUMN IF EXISTS note;

ALTER TABLE fund_transactions ADD COLUMN note text;

CREATE OR REPLACE FUNCTION reset_fund(p_fund text, p_reason text, p_created_by text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
