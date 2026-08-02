-- 032_tournament_session_integrity.sql
--
-- APPLIED TO PROD 2026-07-25 from the planning chat via Supabase MCP
-- (apply_migration, name `032_tournament_session_integrity`). This file is the
-- EXACT deployed body, committed after the fact. DO NOT RE-APPLY.
--
-- Fixes three integrity holes found during Phase 2.1 browser verification.
--
-- 1. Two sessions in the same tournament could share a played_on date, which made
--    ensureTournamentRound hand them the SAME round. Their matches would then have
--    collided on team_number. Observed in prod: two sessions shared 2026-07-25.
--
-- 2. tournament_sessions.round_id was ON DELETE SET NULL, so deleting a shared
--    round silently left the surviving session with no round and no way to hold
--    scores. Sessions and rounds are strictly 1:1, so CASCADE is correct.
--
-- 3. CHECK (ended_on >= started_on) made it impossible to end a tournament that
--    had not started yet -- endTournament writes ended_on = today, which is before
--    started_on for a future tournament. The write was rejected and the failure was
--    invisible in the UI.
--
-- Data repair applied alongside (not part of this file): session 10 was left with
-- round_id NULL by hole #2 and was given a fresh tournament round (id 227).

ALTER TABLE public.tournament_sessions
  ADD CONSTRAINT tournament_sessions_tournament_date_unique UNIQUE (tournament_id, played_on);

ALTER TABLE public.tournament_sessions
  DROP CONSTRAINT tournament_sessions_round_id_fkey;

ALTER TABLE public.tournament_sessions
  ADD CONSTRAINT tournament_sessions_round_id_fkey
    FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE;

ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_check;

ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_ended_on_sane
    CHECK (ended_on IS NULL OR ended_on >= started_on OR is_active = false);
