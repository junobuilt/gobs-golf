-- 037_tournament_match_multi_flag.sql
-- Post-v1 — widen "Flag this hole" from ONE hole per match to MANY. The opposing
-- side can flag several holes for a second look; the scorer sees the full set and
-- resolves each independently. Still coordination metadata only: never changes a
-- score / status / outcome. Migration 036 added flagged_hole int (single); this
-- adds flagged_holes int[] and backfills the single value. Idempotent so a
-- dry-run re-apply is safe.
--
-- Applied to prod via the Supabase MCP by the owner (dry-run passed: column +
-- CHECK apply, 0 rows needed backfill — the test flags were already resolved).
-- File committed verbatim — DO NOT re-apply. flagged_hole (036) is left in place,
-- now frozen/unused; a later cleanup migration drops it once no deployed code
-- references it.

-- 1. New array column. NOT NULL DEFAULT '{}' so the app always reads a stable []
--    (no null-guard needed). Existing rows get '{}' here; step 3 backfills flags.
ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS flagged_holes integer[] NOT NULL DEFAULT '{}';

-- 2. Every element must be a real hole 1..18 (mirrors the 036 single-hole CHECK).
--    <@ = "is contained by": each element of flagged_holes ∈ {1..18}.
ALTER TABLE public.tournament_matches
  DROP CONSTRAINT IF EXISTS tournament_matches_flagged_holes_valid;
ALTER TABLE public.tournament_matches
  ADD CONSTRAINT tournament_matches_flagged_holes_valid
  CHECK (flagged_holes <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]);

-- 3. Backfill: convert the one existing single flag (prod testing value) into a
--    one-element array. Rows with no legacy flag stay '{}'. Re-run safe: only
--    touches rows whose array is still empty AND carry a legacy scalar flag.
UPDATE public.tournament_matches
  SET flagged_holes = ARRAY[flagged_hole]
  WHERE flagged_hole IS NOT NULL
    AND flagged_holes = '{}';
