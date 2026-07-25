// Tournament match-play — pure types. No next / Supabase / React.
//
// Migration 031 (`tournament_foundation`) models a tournament as sessions (one
// playing day = one `rounds` row) → matches (a pairing of two team_numbers
// inside that day's round). This module owns the MATCH-PLAY scoring logic; it
// takes plain inputs a future data layer will assemble from round_players /
// scores / team_scores / holes and never queries anything itself.

export type SessionFormat = "greensomes" | "four_ball_match" | "singles_match";

export type Side = "a" | "b";

// A hole's outcome. `null` = UNRESOLVED: at least one side has no score present
// on that hole. A missing score is NEVER a loss and NEVER par.
export type HoleOutcome = "side_a" | "side_b" | "halved" | null;

export type MatchStatus = "pending" | "in_progress" | "complete";

export type MatchResult = "side_a" | "side_b" | "halved" | null;

export interface HoleMeta {
  holeNumber: number; // 1..18
  par: number;
  strokeIndex: number; // 1..18 — the allocation the match is played off
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
