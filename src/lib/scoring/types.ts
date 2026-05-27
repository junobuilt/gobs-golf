export type Format =
  | "2_ball"
  | "3_ball"
  | "best_ball"
  | "stableford_standard"
  | "gobs_stableford";

export type FormatConfig = {
  basis: "net" | "gross";
  // Persistent admin choice for net vs gross scoring. Optional for backward
  // compatibility with rounds saved before B3.2; treat null/undefined as "net"
  // at read time via getScoringBasis(). The legacy `basis` field above is a
  // per-call display switch used internally by the engine and is unrelated.
  scoring_basis?: "net" | "gross";
  best_n?: number;
  point_values?: Record<string, number>;
  override_holes?: number[];
  // D.1 hotfix (2026-05-18): team_numbers that have tapped "Submit Final
  // Scores" on their scorecard. The blind-draw RPC is only called once
  // every team in the round appears in this list. Replaces the previous
  // auto-fire-on-last-score trigger, which raced A6's first-tap-commits-
  // par behavior and was locking rounds before players could correct.
  // Empty/undefined on rounds created before this hotfix → treat as [].
  submitted_teams?: number[];
};

export type HoleInfo = {
  holeNumber: number;
  par: number;
  strokeIndex: number;
};

export type PlayerScoreInput = {
  playerId: string;
  grossScore: number | null;
  courseHandicap: number | null;
};

export type PlayerHoleResult = {
  playerId: string;
  grossScore: number | null;
  netScore: number | null;
  handicapStrokes: number;
  isContributing: boolean;
  // Stableford points awarded to this player on this hole. Populated for
  // stableford_standard / stableford_modified / gobs_house formats; null for
  // best-N stroke-play formats (2_ball, 3_ball) and for any player whose
  // gross score is null.
  points: number | null;
};

export type HoleResult = {
  teamScore: number | null;
  contributingPlayerIds: string[];
  perPlayer: PlayerHoleResult[];
};

export type HoleInput = {
  format: Format;
  formatConfig: FormatConfig;
  hole: HoleInfo;
  players: PlayerScoreInput[];
  manualContributors?: string[];
};

// D.1 follow-up: blind-draw fill input to the round-level engine.
// The drawn player's CH and stroke-index lookups use their OWN round_players
// row (their tee/CH on this round), not the short team's — that's why
// drawnPlayerHoles carries the drawn player's tee hole info, not the team's.
// Stableford-only this session; best-N formats currently ignore this field.
export type BlindDrawInput = {
  drawnPlayerId: string;
  drawnPlayerCourseHandicap: number | null;
  drawnPlayerScores: Record<number, number | null>;
  drawnPlayerHoles: HoleInfo[];
  holeRangeStart: number; // 1-based inclusive
  holeRangeEnd: number;   // 1-based inclusive, always 18 in current schema
};

export type RoundInput = {
  format: Format;
  formatConfig: FormatConfig;
  holes: HoleInfo[];
  players: Array<{
    playerId: string;
    courseHandicap: number | null;
    grossScores: Record<number, number | null>;
  }>;
  manualContributors?: Record<number, string[]>;
  blindDraws?: BlindDrawInput[];
};

export type RoundResult = {
  teamScore: number | null;
  teamParAtScored: number;
  perHole: Array<{ holeNumber: number; result: HoleResult }>;
  perPlayer: Array<{
    playerId: string;
    grossTotal: number;
    netTotal: number;
    holesPlayed: number;
  }>;
  holesScored: number;
  // Stableford points contributed by blind-draw fills. Kept separate from
  // perHole[h].teamScore so the per-hole invariant "teamScore = sum of
  // perPlayer.points on that hole" is preserved for the team's own players.
  // Callers add blindDrawTotal into the team's headline total, and
  // blindDrawPerHole[h] into the F9/B9 leg totals for holes in each nine.
  // Always 0 / {} for best-N formats this session (TODO: best-N support).
  blindDrawTotal: number;
  blindDrawPerHole: Record<number, number>;
};
