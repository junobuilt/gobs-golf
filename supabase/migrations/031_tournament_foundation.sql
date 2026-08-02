-- 031_tournament_foundation.sql
-- Ryder Cup style tournament container. ADDITIVE + REVERSIBLE.
--
-- APPLIED TO PROD 2026-07-24 from the planning chat via Supabase MCP
-- (apply_migration, name `031_tournament_foundation`). This file is the EXACT
-- deployed body, committed after the fact. DO NOT RE-APPLY.
--
-- Shape: tournaments -> tournament_sessions (one per playing day, each pinned to
-- exactly ONE rounds row) -> tournament_matches (a pairing of two team_numbers
-- inside that day's round).
--
-- WHY one round PER DAY (not per match): rounds carries a UNIQUE (played_on)
-- constraint, so multiple rounds cannot share a calendar date. A day's groups
-- therefore live as teams within a single round, and a match is (round_id,
-- side_a_team_number, side_b_team_number). This also reuses round_players
-- (HI/CH snapshots, tees), scores, team_scores and the write queue unchanged.
-- rounds_played_on_unique is deliberately LEFT INTACT: no league rounds are
-- played during tournament week.
--
-- rounds.tournament_id is NULLABLE; NULL = ordinary league round. Every existing
-- league surface must filter `tournament_id IS NULL` (shipped separately).
-- Tournament rounds carry season_id = NULL; the season association lives on
-- tournaments.season_id.
--
-- Tournament rounds leave rounds.format NULL - the session owns the format.
--
-- RLS mirrors the repo-wide allow-all posture. TD34 covers the lockdown pass.

CREATE TABLE public.tournaments (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL CHECK (btrim(name) <> ''),
  season_id    integer REFERENCES public.seasons(id),
  side_a_name  text NOT NULL DEFAULT 'USA'    CHECK (btrim(side_a_name) <> ''),
  side_b_name  text NOT NULL DEFAULT 'Canada' CHECK (btrim(side_b_name) <> ''),
  holder_side  text CHECK (holder_side IN ('a','b')),
  started_on   date NOT NULL,
  ended_on     date,
  is_active    boolean NOT NULL DEFAULT true,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_on IS NULL OR ended_on >= started_on)
);

CREATE TABLE public.tournament_players (
  id            bigserial PRIMARY KEY,
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id     bigint NOT NULL REFERENCES public.players(id),
  side          text NOT NULL CHECK (side IN ('a','b')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, player_id)
);

CREATE TABLE public.tournament_sessions (
  id            bigserial PRIMARY KEY,
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_id      bigint REFERENCES public.rounds(id) ON DELETE SET NULL,
  day_number    integer NOT NULL CHECK (day_number BETWEEN 1 AND 10),
  name          text NOT NULL,
  format        text NOT NULL CHECK (format IN ('greensomes','four_ball_match','singles_match')),
  played_on     date,
  is_locked     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, day_number)
);

CREATE TABLE public.tournament_matches (
  id                 bigserial PRIMARY KEY,
  tournament_id      bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  session_id         bigint NOT NULL REFERENCES public.tournament_sessions(id) ON DELETE CASCADE,
  match_number       integer NOT NULL CHECK (match_number > 0),
  side_a_team_number integer NOT NULL CHECK (side_a_team_number > 0),
  side_b_team_number integer NOT NULL CHECK (side_b_team_number > 0),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','complete')),
  result             text CHECK (result IN ('side_a','side_b','halved')),
  result_source      text NOT NULL DEFAULT 'engine' CHECK (result_source IN ('engine','admin')),
  closed_out_hole    integer CHECK (closed_out_hole BETWEEN 1 AND 18),
  scorer_label       text,
  admin_note         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (side_a_team_number <> side_b_team_number),
  UNIQUE (session_id, match_number)
);

CREATE TABLE public.tournament_point_adjustments (
  id            bigserial PRIMARY KEY,
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  side          text NOT NULL CHECK (side IN ('a','b')),
  points        numeric(4,1) NOT NULL,
  reason        text NOT NULL CHECK (btrim(reason) <> ''),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rounds
  ADD COLUMN tournament_id bigint REFERENCES public.tournaments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX tournaments_only_one_active ON public.tournaments (is_active) WHERE is_active;
CREATE INDEX idx_rounds_tournament_id ON public.rounds(tournament_id);
CREATE INDEX idx_tp_tournament        ON public.tournament_players(tournament_id);
CREATE INDEX idx_ts_tournament        ON public.tournament_sessions(tournament_id);
CREATE INDEX idx_tm_session           ON public.tournament_matches(session_id);
CREATE INDEX idx_tm_tournament        ON public.tournament_matches(tournament_id);

ALTER TABLE public.tournaments                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_players           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_matches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_point_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON public.tournaments                  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON public.tournament_players           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON public.tournament_sessions          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON public.tournament_matches           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON public.tournament_point_adjustments FOR ALL USING (true) WITH CHECK (true);
