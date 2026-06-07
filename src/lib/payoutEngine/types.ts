// GOBS Payout Engine — input/output type definitions
//
// Public contract for the engine. See docs/PAYOUT_ENGINE.md for semantics.
// No `any` types appear in this public API.

export type PayoutInput = {
  /** Total paying players in the round (§2). */
  players: number;
  /** Players per scorecard. */
  team_size: 2 | 3 | 4;
  /** Pot remaining after HIO + BFB contributions, in whole dollars (§2). */
  balance: number;
  /**
   * Optional. When provided, the engine resolves ties and populates
   * `team_payouts`. When omitted, the engine returns the abstract payout
   * structure only (the "what-if" calculator mode).
   */
  team_finishes?: TeamFinish[];
};

export type TeamFinish = {
  team_number: number;
  /** Lower wins for best-N, higher wins for Stableford. */
  net_score: number;
  scoring_basis: "best_n" | "stableford";
};

export type PayoutResult = {
  /**
   * Number of places paid. `0` represents the §9 "no payout" case
   * (fewer than 2 complete teams) — widened from the spec's 1|2|3|4 so the
   * empty result is expressible without faking a paid place. See confession
   * note in the session log.
   */
  places_paid: 0 | 1 | 2 | 3 | 4;
  /** Per-player payout by place, length === places_paid. */
  per_player: number[];
  /** Populated only when `team_finishes` is provided; empty otherwise. */
  team_payouts: TeamPayout[];
  /** Sum of per_player[i] * team_size across all paid places. */
  total_paid: number;
  /** balance − total_paid, always ≥ 0. */
  bfb_sweep: number;
};

export type TeamPayout = {
  team_number: number;
  /** 1–4. */
  place: number;
  per_player: number;
  total_for_team: number;
  is_tied: boolean;
};
