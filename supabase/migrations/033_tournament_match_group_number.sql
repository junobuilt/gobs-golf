-- 033_tournament_match_group_number.sql
--
-- APPLIED TO PROD 2026-07-27 from the planning chat via Supabase MCP
-- (apply_migration, name `033_tournament_match_group_number`). This file is the
-- EXACT deployed body, committed after the fact. DO NOT RE-APPLY.
--
-- Adds a group identifier to tournament_matches so that several matches played by
-- one foursome can be recognised as belonging together.
--
-- WHY: on singles day a group of four (2 per side) plays TWO separate 1-v-1
-- matches, but they walk together, share one device and one scorer. Nothing in the
-- schema linked those two match rows, so neither the singles scorecard (one card
-- per foursome, both matches derived on screen) nor the group-level dashboard view
-- could be built. match_number is sequential and unreliable after edits/deletes.
--
-- SHAPE: group_number is sequential within a session, assigned by createGroup.
--   greensomes / four_ball_match -> one match, its own group_number
--   singles_match                -> two matches sharing one group_number
--
-- NULLABLE for back-compatibility; no rows existed at time of writing.

ALTER TABLE public.tournament_matches
  ADD COLUMN group_number integer CHECK (group_number IS NULL OR group_number > 0);

CREATE INDEX idx_tm_session_group ON public.tournament_matches(session_id, group_number);
