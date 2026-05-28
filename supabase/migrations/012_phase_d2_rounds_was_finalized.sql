-- Phase D.2: Admin Edit Round
--
-- Adds rounds.was_finalized — a one-way latch that records whether a round
-- was ever finalized, regardless of any subsequent reopen. This is the
-- discriminator the EditModeBanner uses to choose between:
--   was_finalized = true  → show "Finalize Round" (reopened state)
--   was_finalized = false → show "Done" (round is active for the first time)
--
-- The latch is set by a trigger on rounds.is_complete so every existing
-- finalize path (finalize_round_with_blind_draws RPC in migration 008, plus
-- the new finalizeRoundAdmin helper) flips it without modification. The
-- trigger never resets it to false — reopen flips is_complete back without
-- touching was_finalized, preserving the historical fact.
--
-- Backfill: every currently-finalized round gets was_finalized = true.
-- Without this, the EditModeBanner would misclassify every existing
-- finalized round as "active" on first reopen and show Done instead of
-- Finalize.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_rounds_was_finalized_latch ON rounds;
--   DROP FUNCTION IF EXISTS rounds_was_finalized_latch();
--   ALTER TABLE rounds DROP COLUMN was_finalized;

ALTER TABLE rounds
  ADD COLUMN was_finalized boolean NOT NULL DEFAULT false;

UPDATE rounds SET was_finalized = true WHERE is_complete = true;

CREATE OR REPLACE FUNCTION rounds_was_finalized_latch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_complete = true AND COALESCE(OLD.is_complete, false) = false THEN
    NEW.was_finalized := true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rounds_was_finalized_latch
  BEFORE UPDATE OF is_complete ON rounds
  FOR EACH ROW
  EXECUTE FUNCTION rounds_was_finalized_latch();
