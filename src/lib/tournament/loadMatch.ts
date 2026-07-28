// Tournament match — THE canonical loader (Phase 2.2).
//
// Single source of truth: this module turns database rows into everything any
// surface needs about a match. The pairings view (Phase 2.2 UI), the match
// scorecard (Phase 3), and the dashboard (Phase 4) all read `LoadedMatch` — none
// of them recompute strokes, nets, match state, or points. ALL such math comes
// from matchplay.ts; this module only assembles inputs and calls it. It contains
// no arithmetic on scores.
//
// No `from("rounds")` here — the session row carries round_id, so roundsQueryGuard
// has nothing to scope in this file (all reads are on tournament_* / round_players
// / scores / team_scores / holes).

import { supabase } from "@/lib/supabase";
import { computeMatchState, resolveMatchResult } from "./matchplay";
import { computeSideStrokes } from "./matchStrokes";
import type {
  HoleMeta,
  LoadedMatch,
  LoadedMatchPlayer,
  LoadedMatchSide,
  MatchInput,
  MatchPlayerInput,
  MatchSideInput,
  SessionFormat,
  Side,
  TournamentMatch,
} from "./types";

// A single round's scores can't exceed ~50 players × 18 = 900 rows, so one
// session-scoped `.in()` read stays under Supabase's 1000-row API cap by design
// (the History-fix pattern: scope every score read to one round). This guard
// makes truncation DETECTABLE rather than silent if that assumption ever breaks.
const SCORES_ROW_CAP = 1000;

// A match's players span more than one tee, so there is no single stroke-index
// allocation to play the match off. matchplay.ts takes ONE `holes` set per match
// (documented single-tee limitation); rather than silently allocate three
// players' strokes against a fourth player's tee, we refuse loudly.
export class MixedTeesInMatchError extends Error {
  readonly code = "mixed_tees_in_match";
  constructor(public readonly matchId: number, public readonly teeIds: number[]) {
    super(`loadMatch: match ${matchId} spans multiple tees (${teeIds.join(", ")}); one allocation set is required`);
    this.name = "MixedTeesInMatchError";
  }
}

// The tee a match is played off has no `holes` rows — can't allocate strokes.
export class MatchHolesMissingError extends Error {
  readonly code = "match_holes_missing";
  constructor(public readonly matchId: number, public readonly teeId: number | null) {
    super(`loadMatch: no holes for tee ${teeId ?? "∅"} (match ${matchId})`);
    this.name = "MatchHolesMissingError";
  }
}

// A scores read returned at/above the row cap — the result may be truncated and
// cannot be trusted. Never silently short.
export class ScoresTruncatedError extends Error {
  readonly code = "scores_truncated";
  constructor(public readonly roundId: number | null, public readonly count: number) {
    super(`loadMatch: scores read for round ${roundId ?? "∅"} returned ${count} rows (>= ${SCORES_ROW_CAP}); possibly truncated`);
    this.name = "ScoresTruncatedError";
  }
}

export class MatchNotFoundError extends Error {
  readonly code = "match_not_found";
  constructor(public readonly matchId: number) {
    super(`loadMatch: no match ${matchId}`);
    this.name = "MatchNotFoundError";
  }
}

// ── Row shapes (internal) ───────────────────────────────────────────────────
interface RoundPlayerRow {
  id: number;
  player_id: number;
  team_number: number;
  tee_id: number | null;
  course_handicap: number | null;
  handicap_index_snapshot: number | null;
  players:
    | { display_name: string | null; full_name: string }
    | Array<{ display_name: string | null; full_name: string }>
    | null;
}

interface SessionRow {
  id: number;
  tournament_id: number;
  round_id: number | null;
  day_number: number;
  name: string;
  format: SessionFormat;
  played_on: string | null;
}

interface TournamentNameRow {
  id: number;
  side_a_name: string;
  side_b_name: string;
}

function playerName(rp: RoundPlayerRow): string {
  const rec = Array.isArray(rp.players) ? rp.players[0] : rp.players;
  return rec?.display_name || rec?.full_name || `#${rp.player_id}`;
}

// ── The shared assembler ────────────────────────────────────────────────────
// Given the pre-fetched rows for ONE match, build its LoadedMatch. Both entry
// points funnel here so loadSessionMatches is never N × loadMatch.
function assembleMatch(
  match: TournamentMatch,
  session: SessionRow,
  tournament: TournamentNameRow,
  roundPlayers: RoundPlayerRow[], // this match's two team numbers only
  scoresByRpId: Map<number, (number | null)[]>,
  teamScoresByTeam: Map<number, (number | null)[]>,
  holesByTee: Map<number, HoleMeta[]>,
): LoadedMatch {
  const format = session.format;
  const aRps = roundPlayers.filter((rp) => rp.team_number === match.side_a_team_number);
  const bRps = roundPlayers.filter((rp) => rp.team_number === match.side_b_team_number);
  const allRps = [...aRps, ...bRps];

  // One allocation set per match. Distinct tees ⇒ refuse (never mis-allocate).
  const teeIds = [...new Set(allRps.map((rp) => rp.tee_id).filter((t): t is number => t != null))];
  if (teeIds.length > 1) throw new MixedTeesInMatchError(match.id, teeIds);
  const teeId = teeIds[0] ?? null;
  const holes = teeId != null ? holesByTee.get(teeId) ?? [] : [];
  if (holes.length === 0) throw new MatchHolesMissingError(match.id, teeId);

  const toPlayerInput = (rp: RoundPlayerRow): MatchPlayerInput => ({
    playerId: rp.player_id,
    courseHandicap: rp.course_handicap,
    gross: scoresByRpId.get(rp.id) ?? new Array(18).fill(null),
  });

  const sideAInput: MatchSideInput = {
    side: "a",
    players: aRps.map(toPlayerInput),
    teamGross: format === "greensomes" ? teamScoresByTeam.get(match.side_a_team_number) : undefined,
  };
  const sideBInput: MatchSideInput = {
    side: "b",
    players: bRps.map(toPlayerInput),
    teamGross: format === "greensomes" ? teamScoresByTeam.get(match.side_b_team_number) : undefined,
  };

  const matchInput: MatchInput = { format, holes, sideA: sideAInput, sideB: sideBInput };
  const state = computeMatchState(matchInput);
  const resolved = resolveMatchResult(state, { result_source: match.result_source, result: match.result });

  // ── Per-unit match strokes — via the shared computeSideStrokes (matchplay.ts).
  // Same helper the pre-save pairings preview uses, so screen and card agree.
  const { aStrokes, bStrokes, aCollapsed, bCollapsed, aSideStrokes, bSideStrokes } = computeSideStrokes(
    format,
    aRps.map((rp) => rp.course_handicap),
    bRps.map((rp) => rp.course_handicap),
  );

  const toLoadedPlayer = (rp: RoundPlayerRow, strokes: number): LoadedMatchPlayer => ({
    playerId: rp.player_id,
    roundPlayerId: rp.id,
    displayName: playerName(rp),
    handicapIndexSnapshot: rp.handicap_index_snapshot,
    courseHandicap: rp.course_handicap,
    matchStrokes: strokes,
    // Same array the engine consumed above (scoresByRpId) — surfaced verbatim so
    // the surface recomputes from identical inputs, never a parallel fetch.
    gross: scoresByRpId.get(rp.id) ?? new Array(18).fill(null),
  });

  const sideA: LoadedMatchSide = {
    side: "a",
    displayName: tournament.side_a_name,
    teamNumber: match.side_a_team_number,
    players: aRps.map((rp, i) => toLoadedPlayer(rp, aStrokes[i] ?? 0)),
    collapsedHandicap: aCollapsed,
    sideMatchStrokes: aSideStrokes,
    teamGross:
      format === "greensomes"
        ? teamScoresByTeam.get(match.side_a_team_number) ?? new Array(18).fill(null)
        : null,
  };
  const sideB: LoadedMatchSide = {
    side: "b",
    displayName: tournament.side_b_name,
    teamNumber: match.side_b_team_number,
    players: bRps.map((rp, i) => toLoadedPlayer(rp, bStrokes[i] ?? 0)),
    collapsedHandicap: bCollapsed,
    sideMatchStrokes: bSideStrokes,
    teamGross:
      format === "greensomes"
        ? teamScoresByTeam.get(match.side_b_team_number) ?? new Array(18).fill(null)
        : null,
  };

  // §5 completeness: full side = 2 (greensomes/four-ball) or 1 (singles per match).
  const need = format === "singles_match" ? 1 : 2;
  const isIncomplete = aRps.length < need || bRps.length < need;

  return {
    match,
    session: {
      id: session.id,
      format,
      name: session.name,
      dayNumber: session.day_number,
      playedOn: session.played_on,
      roundId: session.round_id,
    },
    tournament: { id: tournament.id, sideAName: tournament.side_a_name, sideBName: tournament.side_b_name },
    sideA,
    sideB,
    teeId,
    holes,
    state,
    resolved,
    isIncomplete,
  };
}

// ── Shared readers ──────────────────────────────────────────────────────────
function grossByHole(rows: Array<{ round_player_id: number; hole_number: number; strokes: number }>): Map<number, (number | null)[]> {
  const byRp = new Map<number, (number | null)[]>();
  for (const s of rows) {
    let arr = byRp.get(s.round_player_id);
    if (!arr) {
      arr = new Array(18).fill(null);
      byRp.set(s.round_player_id, arr);
    }
    if (s.hole_number >= 1 && s.hole_number <= 18) arr[s.hole_number - 1] = s.strokes;
  }
  return byRp;
}

// Greensomes team gross per team_number. Greensomes writes exactly ONE team_scores
// row per (round, team, hole) at ball_index = 1 (the column default), enforced by
// team_scores_round_team_hole_ball_key UNIQUE. We read ball_index = 1 EXPLICITLY
// rather than taking the lowest — a stray ball_index = 2 row is a visible bug
// (surfacing as a missing/odd score), never silently folded in.
function teamGrossByTeam(rows: Array<{ team_number: number; hole_number: number; ball_index: number; strokes: number }>): Map<number, (number | null)[]> {
  const byTeam = new Map<number, (number | null)[]>();
  for (const r of rows) {
    if (r.ball_index !== 1) continue;
    if (r.hole_number < 1 || r.hole_number > 18) continue;
    let arr = byTeam.get(r.team_number);
    if (!arr) {
      arr = new Array(18).fill(null);
      byTeam.set(r.team_number, arr);
    }
    arr[r.hole_number - 1] = r.strokes;
  }
  return byTeam;
}

async function loadHolesByTee(teeIds: number[]): Promise<Map<number, HoleMeta[]>> {
  const byTee = new Map<number, HoleMeta[]>();
  for (const teeId of teeIds) {
    const { data } = await supabase
      .from("holes")
      .select("hole_number, par, stroke_index")
      .eq("tee_id", teeId)
      .order("hole_number");
    byTee.set(
      teeId,
      (data ?? []).map((h: { hole_number: number; par: number; stroke_index: number }) => ({
        holeNumber: h.hole_number,
        par: h.par,
        strokeIndex: h.stroke_index,
      })),
    );
  }
  return byTee;
}

// Fetch every score for a round in ONE session-scoped read (History-fix pattern:
// per-round scope keeps it under the cap) and assert it isn't truncated.
async function loadScores(roundId: number | null, rpIds: number[]): Promise<Map<number, (number | null)[]>> {
  if (rpIds.length === 0) return new Map();
  const { data } = await supabase
    .from("scores")
    .select("round_player_id, hole_number, strokes")
    .in("round_player_id", rpIds);
  const rows = (data ?? []) as Array<{ round_player_id: number; hole_number: number; strokes: number }>;
  if (rows.length >= SCORES_ROW_CAP) throw new ScoresTruncatedError(roundId, rows.length);
  return grossByHole(rows);
}

async function loadTeamScores(roundId: number | null): Promise<Map<number, (number | null)[]>> {
  if (roundId == null) return new Map();
  const { data } = await supabase
    .from("team_scores")
    .select("team_number, hole_number, ball_index, strokes")
    .eq("round_id", roundId);
  return teamGrossByTeam((data ?? []) as Array<{ team_number: number; hole_number: number; ball_index: number; strokes: number }>);
}

async function loadSessionRow(sessionId: number): Promise<SessionRow | null> {
  const { data } = await supabase
    .from("tournament_sessions")
    .select("id, tournament_id, round_id, day_number, name, format, played_on")
    .eq("id", sessionId)
    .maybeSingle();
  return (data as SessionRow | null) ?? null;
}

async function loadTournamentName(tournamentId: number): Promise<TournamentNameRow | null> {
  const { data } = await supabase
    .from("tournaments")
    .select("id, side_a_name, side_b_name")
    .eq("id", tournamentId)
    .maybeSingle();
  return (data as TournamentNameRow | null) ?? null;
}

async function loadRoundPlayers(roundId: number | null, teamNumbers?: number[]): Promise<RoundPlayerRow[]> {
  if (roundId == null) return [];
  let q = supabase
    .from("round_players")
    .select("id, player_id, team_number, tee_id, course_handicap, handicap_index_snapshot, players ( display_name, full_name )")
    .eq("round_id", roundId)
    .gt("team_number", 0);
  if (teamNumbers) q = q.in("team_number", teamNumbers);
  const { data } = await q;
  return (data as unknown as RoundPlayerRow[] | null) ?? [];
}

// ── Entry points ────────────────────────────────────────────────────────────
export async function loadMatch(matchId: number): Promise<LoadedMatch> {
  const { data: matchData } = await supabase
    .from("tournament_matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle();
  const match = (matchData as TournamentMatch | null) ?? null;
  if (!match) throw new MatchNotFoundError(matchId);

  const session = await loadSessionRow(match.session_id);
  if (!session) throw new MatchNotFoundError(matchId);
  const tournament = await loadTournamentName(match.tournament_id);
  if (!tournament) throw new MatchNotFoundError(matchId);

  const roundPlayers = await loadRoundPlayers(session.round_id, [match.side_a_team_number, match.side_b_team_number]);
  const rpIds = roundPlayers.map((rp) => rp.id);
  const scoresByRpId = await loadScores(session.round_id, rpIds);
  const teamScoresByTeam = session.format === "greensomes" ? await loadTeamScores(session.round_id) : new Map<number, (number | null)[]>();
  const teeIds = [...new Set(roundPlayers.map((rp) => rp.tee_id).filter((t): t is number => t != null))];
  const holesByTee = await loadHolesByTee(teeIds);

  return assembleMatch(match, session, tournament, roundPlayers, scoresByRpId, teamScoresByTeam, holesByTee);
}

// Batched: one read each for session / matches / tournament / round_players /
// scores / team_scores / holes-per-tee — NOT one set per match. Each match is
// then assembled from the shared rows sliced on its two team numbers.
export async function loadSessionMatches(sessionId: number): Promise<LoadedMatch[]> {
  const session = await loadSessionRow(sessionId);
  if (!session) return [];

  const { data: matchData } = await supabase
    .from("tournament_matches")
    .select("*")
    .eq("session_id", sessionId)
    .order("match_number");
  const matches = (matchData as TournamentMatch[] | null) ?? [];
  if (matches.length === 0) return [];

  const tournament = await loadTournamentName(session.tournament_id);
  if (!tournament) return [];

  const roundPlayers = await loadRoundPlayers(session.round_id); // all groups this day, one read
  const rpIds = roundPlayers.map((rp) => rp.id);
  const scoresByRpId = await loadScores(session.round_id, rpIds);
  const teamScoresByTeam = session.format === "greensomes" ? await loadTeamScores(session.round_id) : new Map<number, (number | null)[]>();
  const teeIds = [...new Set(roundPlayers.map((rp) => rp.tee_id).filter((t): t is number => t != null))];
  const holesByTee = await loadHolesByTee(teeIds);

  return matches.map((m) => {
    const forMatch = roundPlayers.filter(
      (rp) => rp.team_number === m.side_a_team_number || rp.team_number === m.side_b_team_number,
    );
    return assembleMatch(m, session, tournament, forMatch, scoresByRpId, teamScoresByTeam, holesByTee);
  });
}
