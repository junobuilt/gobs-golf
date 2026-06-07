// GOBS Payout Engine — public API
//
// calculatePayouts is the single entry point. See docs/PAYOUT_ENGINE.md.
//
// Two modes:
//   - Without team_finishes: abstract payout structure (what-if calculator).
//   - With team_finishes: resolves ties and populates team_payouts (finalize).

import { calculateAbstractPayout } from "./engine";
import { resolveWithTies } from "./tieResolver";
import type { PayoutInput, PayoutResult } from "./types";

export function calculatePayouts(input: PayoutInput): PayoutResult {
  if (input.team_finishes === undefined) {
    return calculateAbstractPayout(input);
  }
  return resolveWithTies(input);
}

export { calculateAbstractPayout } from "./engine";
export { resolveWithTies, splitTiedPot } from "./tieResolver";
export * from "./types";
export {
  CAP_PER_PLAYER,
  FLOOR_PER_PLAYER,
  GAP_PRIMARY,
  GAP_FALLBACK,
  PROPORTIONS,
} from "./constants";
