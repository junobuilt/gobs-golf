-- 036_tournament_match_flag.sql
-- Phase 3.2 Relay B — "Flag this hole". The opposing side marks a hole as needing
-- a second look (a suspected wrong score) WITHOUT seizing scoring control.
-- Coordination metadata only: never changes a score / status / outcome. Nullable
-- (null = no flag); one flag per match (the most recently flagged hole). Mirrors
-- the closed_out_hole 1..18 check. Idempotent so a dry-run re-apply is safe.
ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS flagged_hole integer
  CHECK (flagged_hole IS NULL OR flagged_hole BETWEEN 1 AND 18);
