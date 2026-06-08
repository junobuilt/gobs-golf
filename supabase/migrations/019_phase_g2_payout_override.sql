-- Phase G2 (Session 4b) — Payout override write surface.
--
-- The second half of S4b: let an admin correct a single team's per-player
-- payout on a finalized round (with a required reason) and revert it to the
-- engine's original value. Uses the audit columns migration 016 shipped for
-- exactly this (was_overridden, original_amount, admin_override) plus the
-- round_payouts(round_id, team_number) UNIQUE index so each RPC targets ONE row.
--
-- Adds:
--   1. round_payouts.override_reason — nullable free-text holding the admin's
--      REQUIRED human reason for the most recent override OR revert on the row.
--      Mirrors the S4b fund-reset note column (017). All pre-existing rows get
--      override_reason = NULL. `reason` semantics: latest admin action only —
--      a revert overwrites the override's reason with the revert reason.
--   2. override_round_payout(p_round_id, p_team_number, p_new_per_player,
--      p_reason) — SECURITY DEFINER. UPDATES the one matching row IN PLACE
--      (never delete/re-insert, so the audit chain + original_amount survive).
--      Recomputes total_for_team = new_per_player * team_size. Captures the
--      engine value into original_amount ONLY on the first override
--      (was_overridden currently false) so a second edit can't clobber it.
--      Sets was_overridden + admin_override = true. Validates a non-blank
--      reason, p_new_per_player >= 0, and that the row exists; raises otherwise.
--   3. revert_round_payout(p_round_id, p_team_number, p_reason) —
--      SECURITY DEFINER. Restores per_player/total_for_team from
--      original_amount, clears was_overridden + admin_override, nulls
--      original_amount, and records the revert reason in override_reason.
--      Requires the row to be currently overridden (and original_amount set);
--      raises otherwise. Requires a non-blank reason.
--
-- NO AUTO-REBALANCE: an override changes ONLY the targeted team's row. The
-- engine does not recompute and no other team moves. A manual override is
-- authoritative. The resulting paid-vs-balance discrepancy is surfaced in the
-- UI (Winnings → Historical Payouts) but never blocked.
--
-- created_by / actor: NOT recorded. round_payouts has no actor column and the
-- app has no per-user identity (shared PIN gate) — every override is attributed
-- to the implicit 'admin'. (Unlike reset_fund, which writes created_by into the
-- fund_transactions ledger row.) An override_by column can be added later if
-- persisted attribution is ever wanted.
--
-- RLS posture (unchanged from 016): RLS on round_payouts, public SELECT, NO
-- write policies → these SECURITY DEFINER RPCs are the ONLY write path; the
-- client cannot INSERT/UPDATE/DELETE round_payouts directly. No new policy.
--
-- KNOWN LIMITATION (accepted, S4b): reopening a finalized round then
-- re-finalizing it RECREATES round_payouts (persist_round_payouts /
-- reverse_round_payouts DELETE + re-INSERT), which DISCARDS any overrides
-- (new rows default was_overridden=false, original_amount=NULL). This is NOT
-- special-cased here (the reopen/persist path is out of scope this session).
-- Surfaced to the admin via a one-line note inside the override modal and
-- documented in ROADMAP/STATUS.
--
-- Applied via Supabase MCP apply_migration (runs transactionally) on
-- 2026-06-07 after a transaction-rollback dry-run on prod confirmed: clean
-- apply, override sets per_player/total_for_team/was_overridden/admin_override
-- with original_amount = engine value, a SECOND override preserves
-- original_amount, revert restores it and clears flags, and empty-reason /
-- negative-amount / missing-row / revert-of-non-overridden are all rejected —
-- with prod verified untouched (zero new objects, zero payout rows) post-rollback.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS revert_round_payout(bigint, integer, text);
--   DROP FUNCTION IF EXISTS override_round_payout(bigint, integer, integer, text);
--   ALTER TABLE round_payouts DROP COLUMN IF EXISTS override_reason;

ALTER TABLE round_payouts ADD COLUMN override_reason text;

CREATE OR REPLACE FUNCTION override_round_payout(
  p_round_id bigint, p_team_number integer, p_new_per_player integer, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_size integer;
  v_was       boolean;
  v_per       integer;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'override_round_payout: reason is required';
  END IF;
  IF p_new_per_player IS NULL OR p_new_per_player < 0 THEN
    RAISE EXCEPTION 'override_round_payout: per_player must be >= 0';
  END IF;

  -- Lock the single target row (round_id + team_number is unique).
  SELECT team_size, was_overridden, per_player
    INTO v_team_size, v_was, v_per
    FROM round_payouts
    WHERE round_id = p_round_id AND team_number = p_team_number
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'override_round_payout: no row for round % team %',
      p_round_id, p_team_number;
  END IF;

  UPDATE round_payouts SET
    per_player      = p_new_per_player,
    total_for_team  = p_new_per_player * v_team_size,
    -- Capture the engine value on the FIRST override only; a re-edit of an
    -- already-overridden row must NOT clobber it (else revert restores wrong #).
    original_amount = CASE WHEN v_was THEN original_amount ELSE v_per END,
    was_overridden  = true,
    admin_override  = true,
    override_reason = btrim(p_reason)
  WHERE round_id = p_round_id AND team_number = p_team_number;
END;
$$;

CREATE OR REPLACE FUNCTION revert_round_payout(
  p_round_id bigint, p_team_number integer, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_size integer;
  v_was       boolean;
  v_orig      integer;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'revert_round_payout: reason is required';
  END IF;

  SELECT team_size, was_overridden, original_amount
    INTO v_team_size, v_was, v_orig
    FROM round_payouts
    WHERE round_id = p_round_id AND team_number = p_team_number
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revert_round_payout: no row for round % team %',
      p_round_id, p_team_number;
  END IF;
  IF NOT v_was THEN
    RAISE EXCEPTION 'revert_round_payout: row is not overridden';
  END IF;
  IF v_orig IS NULL THEN
    RAISE EXCEPTION 'revert_round_payout: original_amount missing';
  END IF;

  UPDATE round_payouts SET
    per_player      = v_orig,
    total_for_team  = v_orig * v_team_size,
    was_overridden  = false,
    admin_override  = false,
    original_amount = NULL,
    override_reason = btrim(p_reason)  -- records why it was reverted
  WHERE round_id = p_round_id AND team_number = p_team_number;
END;
$$;
