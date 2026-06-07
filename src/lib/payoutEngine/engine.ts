// GOBS Payout Engine — the calculator (pure function)
//
// Implements docs/PAYOUT_ENGINE.md v3 (cascade balancing) §7–§9 for the
// abstract (no-ties) case. All arithmetic is integer dollars.
//
// This module is intentionally pure: same input → same output, no I/O, no
// dates, no globals. Tie resolution lives in tieResolver.ts.

import {
  CAP_PER_PLAYER,
  CASCADE_ITERATION_GUARD,
  FLOOR_PER_PLAYER,
  GAP_SEQUENCE,
  PROPORTIONS,
  targetPlacesForTeams,
} from "./constants";
import type { PayoutInput, PayoutResult } from "./types";

/**
 * Abstract-mode payout calculation (§7). Returns places_paid, per-player
 * amounts, total paid, and the BFB sweep. Does not handle ties — callers that
 * need tie resolution go through tieResolver.ts.
 */
export function calculateAbstractPayout(input: PayoutInput): PayoutResult {
  const { team_size, balance } = input;
  const numTeams = Math.floor(input.players / team_size);

  const empty = (): PayoutResult => ({
    places_paid: 0,
    per_player: [],
    team_payouts: [],
    total_paid: 0,
    // No payable place exists; the whole balance sweeps to the BFB fund.
    bfb_sweep: balance,
  });

  // §9: fewer than 2 complete teams → no payout.
  if (numTeams < 2) return empty();

  // §9: zero balance → all zero, no sweep.
  if (balance <= 0) {
    return { ...empty(), bfb_sweep: 0 };
  }

  const targetPlaces = targetPlacesForTeams(numTeams);

  // §7 Step 2: from target places down to 1, try each gap in sequence; accept
  // the first valid build. Dropping a place is the last resort — only after
  // every gap value has failed at the current places count.
  let chosen: { perPlayer: number[]; gap: number } | null = null;
  outer: for (let places = targetPlaces; places >= 1; places--) {
    for (const gap of GAP_SEQUENCE) {
      const built = build(places, gap, balance, team_size);
      if (built) {
        chosen = { perPlayer: built, gap };
        break outer;
      }
    }
  }

  // Defensive: places=1 with gap is always buildable for balance > 0 (a single
  // place has no gap/floor interaction beyond cap), so `chosen` is non-null
  // here. Fall back to the capped single place if some pathological input slips
  // through, matching §9's last-resort behavior.
  if (!chosen) {
    const first = Math.min(Math.floor(balance / team_size), CAP_PER_PLAYER);
    chosen = { perPlayer: [first], gap: GAP_SEQUENCE[GAP_SEQUENCE.length - 1] };
  }

  const perPlayer = chosen.perPlayer;

  // §7 Step 3: spread leftover dollars. Two passes — gap=3 first, then gap=1.
  spreadLeftover(perPlayer, balance, team_size, 3);
  spreadLeftover(perPlayer, balance, team_size, 1);

  // §7 Step 4.
  const total_paid = perPlayer.reduce((sum, p) => sum + p * team_size, 0);
  const bfb_sweep = balance - total_paid;

  return {
    places_paid: perPlayer.length as PayoutResult["places_paid"],
    per_player: perPlayer,
    team_payouts: [],
    total_paid,
    bfb_sweep,
  };
}

/**
 * §8 build(places, gap) sub-routine. Returns a valid per-player array of length
 * `places`, or null if no valid arrangement exists at this (places, gap).
 */
function build(
  places: number,
  gap: number,
  balance: number,
  teamSize: number,
): number[] | null {
  const props = PROPORTIONS[places];
  if (!props) return null;

  // §8a: apply proportions (integer floor of per-player share).
  const pp: number[] = props.map((prop) =>
    Math.floor((balance * prop) / teamSize),
  );

  // §8b: apply cap with proportional redistribution of the overflow.
  if (pp[0] > CAP_PER_PLAYER) {
    const overflowTeamDollars = (pp[0] - CAP_PER_PLAYER) * teamSize;
    pp[0] = CAP_PER_PLAYER;
    const remainingProps = props.slice(1);
    const remainingSum = remainingProps.reduce((a, b) => a + b, 0);
    if (remainingSum > 0) {
      for (let i = 1; i < places; i++) {
        const share = remainingProps[i - 1] / remainingSum;
        const bonusPerPlayer = Math.floor(
          (overflowTeamDollars * share) / teamSize,
        );
        pp[i] += bonusPerPlayer;
      }
    }
  }

  // §8c: apply gap (initial enforcement), clamping negatives to 0.
  for (let i = 1; i < places; i++) {
    if (pp[i] > pp[i - 1] - gap) {
      pp[i] = pp[i - 1] - gap;
    }
    if (pp[i] < 0) {
      pp[i] = 0;
    }
  }

  // §8d: cascade balancing — raise any sub-floor place (indices 1..places-1).
  let guard = 0;
  while (true) {
    if (guard++ > CASCADE_ITERATION_GUARD) return null;

    // Lowest-indexed place below floor among intermediate/last places. The
    // spec phrases this as max(i where pp[i] < FLOOR); since we resolve one
    // unit at a time and recurse upward, the chosen index converges either
    // way. We target the deepest below-floor place (per §8d's `max(...)`).
    let target = -1;
    for (let i = 1; i < places; i++) {
      if (pp[i] < FLOOR_PER_PLAYER) target = i;
    }
    if (target === -1) break; // all intermediate/last places at or above floor

    if (!raiseByOne(pp, target, gap, guard >= CASCADE_ITERATION_GUARD)) {
      return null;
    }
  }

  // §8e: final validation.
  if (pp[0] > CAP_PER_PLAYER) return null;
  for (let i = 0; i < places; i++) {
    if (pp[i] < FLOOR_PER_PLAYER) return null;
    if (pp[i] < 0) return null;
  }
  for (let i = 1; i < places; i++) {
    if (pp[i] > pp[i - 1] - gap) return null;
  }

  return pp;
}

/**
 * §8d helper: raise pp[target] by 1 while honoring gap and cap. Returns false
 * if the raise is impossible.
 *
 * Case A: raising target does not violate the gap with target-1 → pull $1 from
 *   1st place (if its gap with 2nd allows), else from an intermediate place
 *   that has slack above its successor.
 * Case B: raising target would violate the gap with target-1 → first raise
 *   target-1 by 1 (recursively), then retry.
 */
function raiseByOne(
  pp: number[],
  target: number,
  gap: number,
  atGuardLimit: boolean,
): boolean {
  if (atGuardLimit) return false;

  // Case B: raising target would collide with the place above it.
  if (pp[target] + 1 > pp[target - 1] - gap) {
    // Raise the place above first (recursively), then the retry happens on the
    // next outer-loop iteration / fallthrough below.
    if (target - 1 >= 1) {
      if (!raiseByOne(pp, target - 1, gap, atGuardLimit)) return false;
    } else {
      // target-1 is 1st place; raising target requires headroom there. Pulling
      // from 1st cannot create that headroom, so this is impossible.
      return false;
    }
    // After lifting the place above, fall through to attempt the actual raise.
    if (pp[target] + 1 > pp[target - 1] - gap) {
      // Still blocked even after lifting above — give up this path.
      return false;
    }
  }

  // Case A: find a donor whose reduction keeps its own gap intact.
  // Prefer 1st place.
  if (pp.length > 1 && pp[0] - 1 >= pp[1] + gap && 0 !== target) {
    pp[0] -= 1;
    pp[target] += 1;
    return true;
  }
  // Otherwise pull from an intermediate place strictly above target that has
  // slack over its successor.
  for (let i = 1; i < target; i++) {
    if (pp[i] - 1 >= pp[i + 1] + gap) {
      pp[i] -= 1;
      pp[target] += 1;
      return true;
    }
  }

  return false;
}

/**
 * §7 Step 3: distribute leftover $1/player at a time, walking 1st → last in
 * repeated passes, skipping capped teams and gap-violating bumps. Mutates `pp`.
 */
function spreadLeftover(
  pp: number[],
  balance: number,
  teamSize: number,
  gap: number,
): void {
  const leftoverOf = () =>
    balance - pp.reduce((sum, p) => sum + p * teamSize, 0);

  while (leftoverOf() >= teamSize) {
    let spreadHappened = false;
    for (let i = 0; i < pp.length; i++) {
      if (leftoverOf() < teamSize) break;
      if (pp[i] + 1 > CAP_PER_PLAYER) continue; // skip capped teams
      if (i > 0 && pp[i] + 1 > pp[i - 1] - gap) continue; // skip gap violation
      pp[i] += 1;
      spreadHappened = true;
    }
    if (!spreadHappened) break;
  }
}
