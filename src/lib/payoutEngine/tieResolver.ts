// GOBS Payout Engine — tie-handling layer
//
// Wraps the abstract engine (engine.ts) and resolves ties when actual team
// finishes are supplied. Not covered by docs/PAYOUT_ENGINE.md (§12 lists ties
// as out of scope for that doc); behavior here follows the Session-1 spec.
//
// Approach:
//   1. Get the abstract payout structure (places + per-player pots).
//   2. Sort teams by score (asc for best_n, desc for stableford).
//   3. Group consecutive equal scores into tied groups.
//   4. For each group overlapping a paid place, combine the paid pots in its
//      span and split evenly per player (rounded down). Cap/floor clamps apply
//      per spec. Remainders sweep to BFB.

import { calculateAbstractPayout } from "./engine";
import { CAP_PER_PLAYER } from "./constants";
import type {
  PayoutInput,
  PayoutResult,
  TeamFinish,
  TeamPayout,
} from "./types";

/**
 * Split a combined pot evenly among the players of a tied group.
 *
 * - Even per-player split, rounded down to whole dollars.
 * - Cap clamp: if the per-player split exceeds CAP, each team is capped at
 *   CAP * team_size and the excess sweeps to BFB. NOTE: because the abstract
 *   engine already caps 1st place at CAP, the average of any subset of paid
 *   pots is ≤ CAP, so this branch is unreachable via the full public API. It
 *   is retained per spec and unit-tested directly.
 * - Floor: a below-FLOOR split is paid as-is (v1 limitation — documented, not
 *   fixed). `belowFloor` flags the case for callers/telemetry.
 * - The indivisible remainder always sweeps to BFB.
 *
 * Returns the per-player and per-team payout plus the amount swept.
 */
export function splitTiedPot(
  combinedPot: number,
  numTeams: number,
  teamSize: number,
): {
  perPlayer: number;
  totalForTeam: number;
  sweep: number;
  belowFloor: boolean;
} {
  const totalPlayers = numTeams * teamSize;
  let perPlayer = Math.floor(combinedPot / totalPlayers);

  // Cap clamp (see note above).
  if (perPlayer > CAP_PER_PLAYER) {
    perPlayer = CAP_PER_PLAYER;
  }

  const totalForTeam = perPlayer * teamSize;
  const paidToGroup = totalForTeam * numTeams;
  const sweep = combinedPot - paidToGroup;
  const belowFloor = perPlayer < 5; // FLOOR_PER_PLAYER

  return { perPlayer, totalForTeam, sweep, belowFloor };
}

export function resolveWithTies(input: PayoutInput): PayoutResult {
  const teamSize = input.team_size;

  // Step 1: abstract base structure (no ties).
  const base = calculateAbstractPayout({
    ...input,
    team_finishes: undefined,
  });

  const finishes = input.team_finishes ?? [];
  const placesPaid = base.places_paid;

  // No payout, or no finishes to map → return the abstract structure as-is.
  if (placesPaid === 0 || finishes.length === 0) {
    return { ...base, team_payouts: [] };
  }

  // Step 2: sort by score. best_n: lower wins (asc). stableford: higher wins
  // (desc). Assume a uniform basis across finishes (uniform in practice).
  const basis = finishes[0].scoring_basis;
  const direction = basis === "stableford" ? -1 : 1;
  const sorted: TeamFinish[] = [...finishes].sort(
    (a, b) => direction * (a.net_score - b.net_score),
  );

  // Pot (whole dollars) for a 1-indexed paid place.
  const potForPlace = (place: number): number =>
    base.per_player[place - 1] * teamSize;

  // Step 3: group consecutive equal scores. Each group occupies a contiguous
  // span of 1-indexed positions [startPos .. endPos].
  type Group = { teams: TeamFinish[]; startPos: number; endPos: number };
  const groups: Group[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (
      j + 1 < sorted.length &&
      sorted[j + 1].net_score === sorted[i].net_score
    ) {
      j++;
    }
    groups.push({
      teams: sorted.slice(i, j + 1),
      startPos: i + 1,
      endPos: j + 1,
    });
    i = j + 1;
  }

  // Step 4: pay each group that overlaps a paid place.
  const team_payouts: TeamPayout[] = [];
  let total_paid = 0;

  for (const group of groups) {
    if (group.startPos > placesPaid) continue; // entirely beyond cutoff

    // Paid positions within this group's span (a tie spanning the cutoff only
    // combines the pots of the positions that are actually paid; teams beyond
    // the cutoff share those pots but no place backs in).
    const paidEnd = Math.min(group.endPos, placesPaid);
    let combinedPot = 0;
    for (let p = group.startPos; p <= paidEnd; p++) {
      combinedPot += potForPlace(p);
    }

    const numTeams = group.teams.length;
    const isTied = numTeams > 1;
    const split = splitTiedPot(combinedPot, numTeams, teamSize);

    for (const team of group.teams) {
      team_payouts.push({
        team_number: team.team_number,
        place: group.startPos, // tied teams share the group's top position
        per_player: split.perPlayer,
        total_for_team: split.totalForTeam,
        is_tied: isTied,
      });
      total_paid += split.totalForTeam;
    }
  }

  // Step 6: recompute the sweep after tie adjustments.
  const bfb_sweep = input.balance - total_paid;

  return {
    places_paid: placesPaid,
    per_player: base.per_player,
    team_payouts,
    total_paid,
    bfb_sweep,
  };
}
