-- Phase TD: Add `updated_at` column to rounds with auto-update trigger.
--
-- The May 11 duplicate-rounds investigation (Track A, 2026-05-13) could not
-- determine when round 90's `is_complete` flag was flipped from false to true
-- because the `rounds` table had no `updated_at` column. Triangulating from
-- score timestamps worked but was unreliable. This migration adds the column
-- plus a BEFORE UPDATE trigger so future "when did this row last change?"
-- investigations are direct lookups.
--
-- Trigger pattern: stamps `now()` on every UPDATE regardless of which column
-- changed. Intentionally broad — any mutation to a `rounds` row is interesting
-- for diagnostics. This is the first BEFORE UPDATE trigger in the project,
-- so the trigger function `set_updated_at_timestamp()` is also created here.
-- Future tables that want the same pattern can reuse the function.
--
-- Default `now()` on existing rows means historical rounds get the migration
-- apply time as their `updated_at`. That's incorrect for those rows but
-- acceptable — we can't reconstruct the true update history retroactively,
-- and from this point forward the column is honest.
--
-- Apply order: independent of migrations 005 and 006. Safe to run any time
-- after the rounds table exists. Listed after 006 to keep the cleanup +
-- constraint pair contiguous in history.
--
-- Rollback:
--   BEGIN;
--   DROP TRIGGER IF EXISTS rounds_set_updated_at ON rounds;
--   DROP FUNCTION IF EXISTS set_updated_at_timestamp();
--   ALTER TABLE rounds DROP COLUMN IF EXISTS updated_at;
--   COMMIT;

BEGIN;

ALTER TABLE rounds
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER rounds_set_updated_at
  BEFORE UPDATE ON rounds
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at_timestamp();

COMMIT;
