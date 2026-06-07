// GOBS Payout Engine — constants
//
// Canonical values from docs/PAYOUT_ENGINE.md §4–§5. Do not inline these
// numbers in engine.ts; import them so the spec has a single source of truth.

/** HARD — 1st place per-player never exceeds this (§4). */
export const CAP_PER_PLAYER = 25;

/** HARD — every paid place must be ≥ this per-player (§4). */
export const FLOOR_PER_PLAYER = 5;

/** SOFT — preferred minimum gap between consecutive places (§4). */
export const GAP_PRIMARY = 3;

/** SOFT — absolute minimum gap; never allowed to tie (§4). */
export const GAP_FALLBACK = 1;

/**
 * Gap values attempted, in order, for each `places` count (§7 Step 2).
 * Note: includes the intermediate value 2 between PRIMARY (3) and FALLBACK (1).
 */
export const GAP_SEQUENCE = [GAP_PRIMARY, 2, GAP_FALLBACK] as const;

/**
 * Starting per-team share of the balance by number of places paid (§5).
 * Index 0 = 1st place. These are a soft starting shape; the engine deviates
 * to honor the hard rules (cap, floor, max places).
 */
export const PROPORTIONS: Record<number, readonly number[]> = {
  1: [1.0],
  2: [0.65, 0.35],
  3: [0.55, 0.3, 0.15],
  4: [0.5, 0.25, 0.17, 0.08],
};

/** Iteration guard for the cascade-balancing loop (§8d). */
export const CASCADE_ITERATION_GUARD = 200;

/**
 * Target places paid given the number of complete teams (§7 Step 1).
 * Returns 0 when there is no payout (fewer than 2 teams).
 */
export function targetPlacesForTeams(numTeams: number): 0 | 1 | 2 | 3 | 4 {
  if (numTeams < 2) return 0;
  if (numTeams === 2) return 1;
  if (numTeams === 3) return 2;
  if (numTeams === 4 || numTeams === 5) return 3;
  return 4;
}
