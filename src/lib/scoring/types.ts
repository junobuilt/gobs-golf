export type Format =
  | "2_ball"
  | "3_ball"
  | "best_ball"
  | "stableford_standard"
  | "gobs_stableford"
  // Wave 1B follow-up: individual best-ball NET format. After the team drive
  // everyone plays their own ball, so per-player `scores` exist; the team takes
  // the best team_ball_count (1 or 2) NET balls per hole via computeBestNHole.
  // Relaxed close (best of the scores PRESENT; finalizes via
  // finalize_round_relaxed) and excluded from individual season stats — see
  // allowsIncompleteClose() / excludedFromIndividualStats() in lib/format/helpers.
  | "shambles"
  // Phase 1C — team-card NET formats. The team plays ONE ball and records one
  // gross score per hole in `team_scores` (NOT per-player `scores`). Net is a
  // single deduction off the 18-hole team gross: net = teamGross − teamHandicap,
  // where teamHandicap comes from a per-format weighting of the members' FULL
  // (100%) course handicaps (computeTeamHandicap in lib/scoring/teamHandicap.ts)
  // — the formula IS the allowance, so these never route through the Wave 1A
  // allowance helper. Scored in results.ts' team-card branch, NOT the per-player
  // engine (computeHoleResult throws for them). Finalize via
  // finalize_round_team_card (every team scores every hole; no blind draw).
  | "texas_scramble"
  | "alternate_shot"
  // Par Competition — match play against the course. Individual scorecard (per-
  // player `scores`), net-locked, allowance enabled. Per hole the team takes its
  // best NET ball among the scores PRESENT (single ball, N=1, like Best Ball),
  // then maps it vs the hole's par: best net < par → +1, = par → 0, > par → −1.
  // A hole with ZERO scores present is UNRESOLVED (engine teamScore null, not
  // −1) so the live record sums only resolved holes; the relaxed finalize floor
  // (≥1 score/hole/team) guarantees every hole is resolved once finalized. The
  // team headline is the summed record (highest wins → Stableford-family
  // DESCENDING rank via ranksDescending(); NOT isStablefordFormat — individuals
  // stay ranked by net strokes via the best-N branch). Relaxed close like
  // Shambles (finalize_round_relaxed; short teams play short, no blind-draw
  // receive). Individual season stats COUNT (NOT excludedFromIndividualStats).
  | "par_competition";

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
  // Wave 1A: per-round handicap allowance as an integer percent (10–100, in
  // steps of 10). Scales every player's course handicap before strokes are
  // allocated, so it applies to every net format automatically and is a no-op
  // under gross scoring. Absent/undefined on all pre-1A rounds → treated as 100
  // (full handicap) at read time via getHandicapAllowance(). Applied to stroke
  // allocation ONLY (dots + net engine input) via getPlayingStrokes(); the
  // displayed Course Handicap number label stays RAW. NOTE: the GHIN Adjusted
  // Score is always computed at 100% and ignores this value by design.
  handicap_allowance?: number;
  // D.1 hotfix (2026-05-18): team_numbers that have tapped "Submit Final
  // Scores" on their scorecard. The blind-draw RPC is only called once
  // every team in the round appears in this list. Replaces the previous
  // auto-fire-on-last-score trigger, which raced A6's first-tap-commits-
  // par behavior and was locking rounds before players could correct.
  // Empty/undefined on rounds created before this hotfix → treat as [].
  submitted_teams?: number[];
  // Wave 1B: number of counting balls per hole for team-card formats
  // (Shambles: admin picks 1 or 2). Count-2 → the hole's team score is the
  // sum of the two entered balls. Generic across all future team-card formats
  // (Texas Scramble / 1 Score Only / Alternate Shot all use 1). Absent/
  // undefined on every non-team-card and pre-1B round → treated as 1 at read
  // time via getTeamBallCount(). Read ONLY for team-card rounds; inert for the
  // individual per-player formats.
  team_ball_count?: number;
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

// Best-N blind-draw fill resolved for a single hole. The drawn player's
// netScore is precomputed by computeRoundResult using the DRAWN player's own
// tee stroke-index (mirroring the Stableford block), not the short team's —
// so computeBestNHole must NOT re-derive net from the team's `hole`.
export type BestNFill = {
  playerId: string;
  grossScore: number | null;
  netScore: number | null;
};

export type HoleInput = {
  format: Format;
  formatConfig: FormatConfig;
  hole: HoleInfo;
  players: PlayerScoreInput[];
  // Retained as extension point (e.g. I16 worst-counts). No production caller
  // as of 2026-05-30; exercised only by engine-overrides.test.ts.
  manualContributors?: string[];
  // D.1 follow-up: blind-draw fills covering this hole. Each is a full member
  // of the per-hole "best of" pool (selectable as a contributing ball, and
  // counted on override "all scores count" holes). Populated only for best-N
  // formats by computeRoundResult; Stableford ignores it (uses blindDrawTotal).
  fills?: BestNFill[];
};

// D.1 follow-up: blind-draw fill input to the round-level engine.
// The drawn player's CH and stroke-index lookups use their OWN round_players
// row (their tee/CH on this round), not the short team's — that's why
// drawnPlayerHoles carries the drawn player's tee hole info, not the team's.
// Consumed by both Stableford (blindDrawTotal accumulator) and best-N
// (per-hole pool injection via resolveBestNFills) paths in computeRoundResult.
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
