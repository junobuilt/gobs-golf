-- Backup Admin PIN v2 — named holders.
--
-- Supersedes the H9 single-active-credential design (migration 028). v1 allowed
-- ONE backup PIN at a time with a 1/3/7-day preset, and minting a new one
-- superseded the old. v2 lets several named people hold a PIN simultaneously,
-- each with its own calendar expiry up to a year out, so the admin can see
-- exactly who currently has access and remove any one of them individually.
--
-- Two nullable columns:
--   player_id   — FK to players(id), ON DELETE SET NULL. Nullable so the one
--                 existing active credential (prod id=7 at authoring time)
--                 survives untouched and keeps working. Used by the picker and
--                 for the "one active PIN per person" check; NOT what the list
--                 displays.
--   holder_name — snapshot of the holder's full_name at mint time. The list
--                 displays THIS, so the row still reads correctly if the player
--                 is later removed from the roster (at which point the FK nulls
--                 player_id but the name survives). A row with holder_name IS
--                 NULL is a pre-upgrade credential and renders as
--                 "Unnamed (pre-upgrade)".
--
-- NO unique constraint on pin_hash: the hash is salted, so two identical PINs
-- produce different hashes and a constraint could never fire. PIN collisions are
-- rejected in application code at mint time (scrypt-verify against every active
-- credential). "One active PIN per player" is likewise application-enforced — a
-- partial unique index cannot express it because the predicate needs now(),
-- which is not immutable.
--
-- Backup assessment: ADDITIVE and REVERSIBLE. Two NEW nullable columns + one
-- index. NO backfill, NO UPDATE, NO DROP, no existing row read or written. The
-- 7 existing credential rows and 16 audit rows are untouched.
--
-- Migration 043.
--
-- Rollback:
--   BEGIN;
--   DROP INDEX IF EXISTS public.admin_backup_pin_player_idx;
--   ALTER TABLE public.admin_backup_pin
--     DROP COLUMN IF EXISTS holder_name,
--     DROP COLUMN IF EXISTS player_id;
--   COMMIT;

BEGIN;

ALTER TABLE public.admin_backup_pin
  ADD COLUMN IF NOT EXISTS player_id bigint
    REFERENCES public.players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS holder_name text;

-- Supports the "does this player already hold an active credential?" check.
CREATE INDEX IF NOT EXISTS admin_backup_pin_player_idx
  ON public.admin_backup_pin (player_id) WHERE revoked_at IS NULL;

COMMIT;
