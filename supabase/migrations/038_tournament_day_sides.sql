-- 038_tournament_day_sides.sql
-- Per-day team assignment for tournament "alternates". ADDITIVE + REVERSIBLE.
--
-- APPLIED TO PROD 2026-07-28 via the Supabase MCP (apply_migration, name
-- `038_tournament_day_sides`) after a BEGIN…ROLLBACK dry-run passed. This file is
-- the EXACT deployed body, committed after the fact. DO NOT RE-APPLY. Post-apply
-- verify confirmed: table present; 6 NOT NULL columns; pkey + 3 FKs + UNIQUE
-- (session_id,player_id) + side CHECK; idx_tds_session/idx_tds_tournament; RLS on
-- with the "Allow all" policy; 0 rows.
--
-- WHY: each tournament_players row carries ONE global "home" side (USA/Canada)
-- for the whole tournament (UNIQUE (tournament_id, player_id)). An "alternate"
-- plays for different sides on different days (e.g. USA Days 1 & 3, Canada Day
-- 2). This table is the SPARSE per-day OVERRIDE: a row exists ONLY when a
-- player's side on a given day differs from home. No row → the resolver falls
-- back to the home side. This mirrors the Flights `getFlightForTeam`
-- canonical-default-to-home pattern.
--
-- SSOT NOTE: the resolver (getPlayerTeamForDay / getDaySideAssignments) is the
-- authority for PAIRING-TIME side eligibility. The built match row
-- (tournament_matches.side_a_team_number / side_b_team_number → round_players.
-- team_number) stays the authority for SCORING-TIME side; the two agree by
-- construction because createGroup stamps each player into the slot the resolver
-- dictates. An override edited AFTER a match is built does NOT re-side that
-- match (same freeze semantics as the CH/HI snapshots) — the admin rebuilds.
--
-- MEMBERSHIP: an override NEVER grants tournament membership. tournament_players
-- remains the authoritative participant set; setPlayerDaySide refuses to write a
-- row for a player without a tournament_players row, and the resolver ignores an
-- override for a non-member (defense in depth).
--
-- Scoped by session_id (the per-day unit) so a day's round-move / delete cascades
-- cleanly. RLS mirrors the repo-wide allow-all posture (matches migration 031).

CREATE TABLE public.tournament_day_sides (
  id            bigserial PRIMARY KEY,
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id)         ON DELETE CASCADE,
  session_id    bigint NOT NULL REFERENCES public.tournament_sessions(id) ON DELETE CASCADE,
  player_id     bigint NOT NULL REFERENCES public.players(id),
  side          text   NOT NULL CHECK (side IN ('a','b')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- One override per (day, player): a player has exactly one side on a given day.
  UNIQUE (session_id, player_id)
);

CREATE INDEX idx_tds_tournament ON public.tournament_day_sides(tournament_id);
CREATE INDEX idx_tds_session    ON public.tournament_day_sides(session_id);

ALTER TABLE public.tournament_day_sides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON public.tournament_day_sides FOR ALL USING (true) WITH CHECK (true);

-- ── Reversal (additive only; nothing on an existing table changes) ───────────
-- DROP TABLE public.tournament_day_sides;
