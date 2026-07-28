// Tournament match-play — pure types. No next / Supabase / React.
//
// Migration 031 (`tournament_foundation`) models a tournament as sessions (one
// playing day = one `rounds` row) → matches (a pairing of two team_numbers
// inside that day's round). This module owns the MATCH-PLAY scoring logic; it
// takes plain inputs a future data layer will assemble from round_players /
// scores / team_scores / holes and never queries anything itself.

export type SessionFormat = "greensomes" | "four_ball_match" | "singles_match";

export type Side = "a" | "b";

// ── DB row types (migration 031) ────────────────────────────────────────────
// Plain shapes for the tournament tables. The data layer (queries.ts /
// mutations.ts) reads/writes these; the admin Tournament tab renders them.

export interface Tournament {
  id: number;
  name: string;
  season_id: number | null;
  side_a_name: string;
  side_b_name: string;
  holder_side: Side | null;
  started_on: string; // ISO date
  ended_on: string | null;
  is_active: boolean;
  // Migration 034. Test (false, default) = not shown to players; Live (true) =
  // shown on the homepage hero + the public /tournament landing. The player-
  // facing gate; `is_active` still identifies the one live tournament.
  is_published: boolean;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TournamentPlayer {
  id: number;
  tournament_id: number;
  player_id: number;
  side: Side;
  created_at?: string;
}

// The embedded-player shape (TD2 pattern): a tournament_players row joined to
// its `players` record so an already-assigned player still renders even after
// being deactivated. `players` may arrive as an object or a one-element array
// (PostgREST embed) — callers apply the array-vs-object guard.
export interface TournamentPlayerJoined extends TournamentPlayer {
  players:
    | {
        id: number;
        full_name: string;
        display_name: string | null;
        handicap_index: number | null;
        is_active: boolean;
      }
    | Array<{
        id: number;
        full_name: string;
        display_name: string | null;
        handicap_index: number | null;
        is_active: boolean;
      }>
    | null;
}

export interface TournamentSession {
  id: number;
  tournament_id: number;
  round_id: number | null;
  day_number: number;
  name: string;
  format: SessionFormat;
  played_on: string | null;
  is_locked: boolean;
  created_at?: string;
  updated_at?: string;
}

// One batched read for the admin tab.
export interface TournamentWithSessions {
  tournament: Tournament;
  players: TournamentPlayerJoined[];
  sessions: TournamentSession[];
}

// A persisted tournament_matches row (migration 031). A match pairs two
// team_numbers inside the session's round: greensomes/four-ball = one match of
// 2-v-2 (each side is a team_number); singles = a 1-v-1 pairing (each player is
// a team_number of one), two matches per group of four.
export interface TournamentMatch {
  id: number;
  tournament_id: number;
  session_id: number;
  match_number: number;
  // Foursome identifier (migration 033). One match for greensomes/four-ball;
  // TWO matches share one group_number for a singles foursome. Sequential within
  // a session. Nullable for pre-033 rows (none existed).
  group_number: number | null;
  side_a_team_number: number;
  side_b_team_number: number;
  status: MatchStatus;
  result: MatchResult;
  result_source: "engine" | "admin";
  closed_out_hole: number | null;
  scorer_label: string | null;
  // Phase 3.2 Relay B — coordination metadata (never score data):
  // scorer_label = the current scorer's player_id as text (soft claim);
  // flagged_hole = a hole the opposing side flagged for a second look (migration
  // 036). Both are signals; neither changes a score / status / outcome.
  flagged_hole: number | null;
  admin_note: string | null;
  created_at?: string;
  updated_at?: string;
}

// Whether a session's backing round carries real scores (blocks delete) and/or
// pairings (does NOT block — pairings are rebuildable). See §5.1.
export interface SessionRoundStatus {
  roundId: number | null;
  hasScores: boolean; // scores OR team_scores present
  hasPairings: boolean; // round_players present
}

// A persisted `tournament_point_adjustments` row (migration 031) — the Level-3
// admin override (Phase 4): a direct country-points adjustment, e.g. the
// envelope-rule half point. The engine reads only `side` + `points` (the
// `PointAdjustment` shape below), so a row is assignable to it directly.
export interface TournamentPointAdjustment {
  id: number;
  tournament_id: number;
  side: Side;
  points: number; // numeric(4,1) — may be negative
  reason: string; // NOT NULL, non-blank
  created_at?: string;
}

// A hole's outcome. `null` = UNRESOLVED: at least one side has no score present
// on that hole. A missing score is NEVER a loss and NEVER par.
export type HoleOutcome = "side_a" | "side_b" | "halved" | null;

export type MatchStatus = "pending" | "in_progress" | "complete";

export type MatchResult = "side_a" | "side_b" | "halved" | null;

export interface HoleMeta {
  holeNumber: number; // 1..18
  par: number;
  strokeIndex: number; // 1..18 — the allocation the match is played off
  // §3.1 fix: distance for the scorecard's hole-context row. Optional — the
  // engine never reads it (goldens unaffected); the loader surfaces it from
  // holes.yardage, null when the column is empty.
  yardage?: number | null;
}

export interface MatchPlayerInput {
  playerId: number;
  courseHandicap: number | null; // raw stored round_players.course_handicap
  gross: ReadonlyArray<number | null>; // length 18; index i = hole i+1; null = no score
}

export interface MatchSideInput {
  side: Side;
  players: ReadonlyArray<MatchPlayerInput>; // singles: 1, four_ball: 2, greensomes: 2
  teamGross?: ReadonlyArray<number | null>; // greensomes ONLY — length 18, from team_scores
}

export interface MatchInput {
  format: SessionFormat;
  // ONE allocation set for the whole match (the league plays a tournament match
  // off a single tee). Length 18. A future mixed-tee need would carry per-unit
  // stroke indexes; out of scope now — no caller, no UI.
  holes: ReadonlyArray<HoleMeta>;
  sideA: MatchSideInput;
  sideB: MatchSideInput;
}

export interface MatchState {
  holeOutcomes: HoleOutcome[]; // length 18
  pointsA: number; // Dad's per-hole points: 1 per hole won, 0.5 each per halve — THROUGH `thru`
  pointsB: number;
  holesUp: number; // signed lead in HOLES WON (not points): holesWonA − holesWonB; + = A up
  thru: number; // holes resolved from hole 1 CONSECUTIVELY; a gap stops the count
  firstUnresolvedHole: number | null; // the gap (1-indexed), for the amber "Hole N missing" prompt
  status: MatchStatus;
  result: MatchResult;
  closedOutHole: number | null; // the hole an EARLY closeout landed on; null if decided on 18
  margin: string | null; // "5&4" | "2 UP" | "AS"
  // True when the match closed early AND at least one score exists on a hole
  // past the closeout hole — those holes are ignored for state, but an admin
  // surface can warn that extra scores were entered on an already-decided match.
  scoredBeyondCloseout: boolean;
  // FOUR-BALL ONLY (§3.1/§10): per hole, the 0|1 index of the side's player
  // whose net was the COUNTING ball — the one the engine's best-net selection
  // picked. `null` when the hole is unresolved (side has no usable ball) OR when
  // the two balls tie (either could count — the surface marks both). `undefined`
  // for greensomes/singles (there is no "which of two balls" to mark). Purely
  // additive: no existing field changes meaning; the scorecard reads this to
  // draw the ← mark rather than re-deciding the counting ball itself.
  countingUnitA?: (number | null)[]; // length 18 when present
  countingUnitB?: (number | null)[];
}

// A persisted match row's result fields (from `tournament_matches`).
export interface MatchResultRow {
  result_source: "engine" | "admin";
  result: MatchResult;
}

export interface ResolvedResult {
  source: "engine" | "admin";
  result: MatchResult; // the AUTHORITATIVE result (admin override wins unconditionally)
  engineResult: MatchResult; // engine's view, always surfaced for "engine says X, admin set Y"
  pointsA: number; // country points from the authoritative result
  pointsB: number;
}

export interface SidePoints {
  a: number;
  b: number;
}

// A tournament-level point adjustment (`tournament_point_adjustments`) — e.g.
// the envelope-rule half point.
export interface PointAdjustment {
  side: Side;
  points: number;
}

// Per-match input to the standings roll-up. `result` is the AUTHORITATIVE result
// (admin override already applied via resolveMatchResult); null = still in play.
// The live engine numbers feed the in-play list + projection.
export interface StandingsMatchInput {
  matchId: number;
  result: MatchResult;
  holesUp: number;
  thru: number;
  margin: string | null;
}

export interface StandingsInPlayEntry {
  matchId: number;
  holesUp: number;
  thru: number;
  margin: string | null;
}

export interface Standings {
  banked: SidePoints; // decided matches + adjustments
  projected: SidePoints; // banked + every live match counted as it currently stands
  inPlay: StandingsInPlayEntry[];
}

// ── Canonical loaded match (Phase 2.2) ──────────────────────────────────────
// The single assembled view of a match. Every downstream surface (pairings
// view, the Phase-3 scorecard, the Phase-4 dashboard) reads THIS — nothing
// recomputes strokes / nets / state / points. All the derived numbers here come
// from matchplay.ts; loadMatch.ts only assembles inputs and calls it.

export interface LoadedMatchPlayer {
  playerId: number;
  // round_players.id — the FK the individual `scores` write path needs. Surfaced
  // (§3.1) so the score-entry surface can enqueue a durable per-player upsert.
  roundPlayerId: number;
  displayName: string;
  handicapIndexSnapshot: number | null; // round_players.handicap_index_snapshot
  courseHandicap: number | null; // round_players.course_handicap (raw; PH = CH at 100%)
  matchStrokes: number; // computeMatchStrokes — strokes this unit gives/gets in the match
  // §3.1: the per-hole gross the loader assembled for this player from `scores`
  // (length 18; null = no score). Surfaced so the score-entry surface can seed
  // an optimistic score map and re-run computeMatchState LOCALLY over live edits
  // (single source of truth: same pure engine, newer inputs). Individual formats
  // (four-ball / singles) only; greensomes score lives on the side's teamGross.
  gross: (number | null)[];
}

export interface LoadedMatchSide {
  side: Side;
  displayName: string; // tournaments.side_a_name / side_b_name
  teamNumber: number;
  players: LoadedMatchPlayer[];
  // Greensomes only: the pair collapsed to one handicap + its match strokes.
  // null for singles/four-ball (their strokes are per-player above).
  collapsedHandicap: number | null;
  sideMatchStrokes: number | null;
  // §3.1: greensomes ONLY — the side's per-hole collapsed team gross from
  // `team_scores` (ball_index = 1; length 18, null = no score), surfaced so the
  // alternate-shot surface can seed its optimistic map and recompute locally.
  // null for singles/four-ball (their score lives per-player on `gross` above).
  teamGross: (number | null)[] | null;
}

export interface LoadedMatch {
  match: TournamentMatch;
  session: {
    id: number;
    format: SessionFormat;
    name: string;
    dayNumber: number;
    playedOn: string | null;
    roundId: number | null;
  };
  tournament: { id: number; sideAName: string; sideBName: string };
  sideA: LoadedMatchSide;
  sideB: LoadedMatchSide;
  teeId: number | null; // the group's single tee (holes are its allocation set)
  holes: HoleMeta[]; // the match's single allocation set (one tee)
  state: MatchState; // computeMatchState
  resolved: ResolvedResult; // resolveMatchResult (admin override precedence)
  // §5: a side is short its full complement (e.g. a group of three, or a singles
  // opponent not yet chosen). The match row still exists so an admin override —
  // the envelope-rule halved — can land on it. Never blocks; UI flags it amber.
  isIncomplete: boolean;
}
