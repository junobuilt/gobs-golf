-- 039_tournament_shotgun.sql
-- Shotgun start: per-group START HOLE + GROUP LABEL on a match. ADDITIVE +
-- REVERSIBLE.
--
-- APPLIED TO PROD 2026-07-28 via the Supabase MCP (apply_migration, name
-- `039_tournament_shotgun`) after a BEGIN…ROLLBACK dry-run passed. This file is
-- the EXACT deployed body, committed after the fact. DO NOT RE-APPLY. Post-apply
-- verify confirmed: start_hole (int, nullable) + group_label (text, nullable);
-- CHECK (start_hole BETWEEN 1 AND 18); the 8 existing rows untouched (all NULL,
-- no backfill).
--
-- WHY: in a shotgun start each foursome tees off on a different hole and plays in
-- sequence, wrapping (e.g. start 7 → 7,8,…,18,1,…,6). A "group" is the foursome
-- (matches sharing tournament_matches.group_number); shotgun start is therefore a
-- per-GROUP value, stored on every match in the group (for singles, both 1-v-1
-- matches of the foursome carry the same values).
--   • start_hole  — 1..18; NULL = an ordinary hole-1 start (the engine treats
--     NULL as 1, so every pre-shotgun round is unaffected).
--   • group_label — the admin's foursome tag ("A"/"B"/"C"…), auto-derived from
--     group_number with an editable override; NULL = fall back to the derived
--     letter at the display layer.
--
-- loadMatch/loadSessionMatches use select("*"), so both columns flow into
-- TournamentMatch with no reader change. The engine reads start_hole for the
-- play-order walk (order-agnostic completion); the scorecard nav reads it for the
-- rotated, wrapping hole rail.

ALTER TABLE public.tournament_matches
  ADD COLUMN start_hole  integer CHECK (start_hole BETWEEN 1 AND 18),
  ADD COLUMN group_label text;

-- ── Reversal (additive only; nothing on an existing column changes) ──────────
-- ALTER TABLE public.tournament_matches DROP COLUMN start_hole, DROP COLUMN group_label;
