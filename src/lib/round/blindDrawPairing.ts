// D.1 — Pure helpers used by RoundResultsView and (potentially) other
// blind-draw display surfaces. Extracted here for direct testability;
// kept free of React imports.

import type { PlayerRow, TeamRow, BlindDrawFill } from "./results";

/**
 * Copy helper for a fill's hole range. Round-start fills (1..18) read
 * as "all 18 holes"; dropout fills read as "holes N+1–18".
 */
export function rangeCopy(fill: BlindDrawFill): string {
  if (fill.holeRangeStart === 1 && fill.holeRangeEnd === 18) return "all 18 holes";
  return `holes ${fill.holeRangeStart}–${fill.holeRangeEnd}`;
}

export interface BlindDrawPairing {
  player: PlayerRow;
  fill: BlindDrawFill;
}

export interface PairBlindDrawsResult {
  /** Dropout fills paired to the dropped player they're filling for. */
  dropoutPairings: BlindDrawPairing[];
  /** Fills that cover holes 1..18 (round-start short). No team player. */
  roundStartFills: BlindDrawFill[];
  /**
   * Dropped players with no fill paired — happens when the round isn't
   * finalized yet, or (very rarely) when fills couldn't be matched to a
   * specific dropped player by hole number. The caller should still
   * render these players' partial scores; the badge ("left after hole N")
   * still applies, just without a 🎲 merge.
   */
  unmatchedPlayers: PlayerRow[];
}

/**
 * Pair each dropout fill (holeRangeStart > 1) on a team with its dropped
 * player by matching `dropped_after_hole = holeRangeStart - 1`. Multiple
 * dropouts on the same team with the same hole pair greedily in roster
 * order. Round-start fills (holeRangeStart === 1) are returned separately
 * and render as synthetic pseudo-player rows.
 *
 * Pure function; no I/O. Deterministic given a team snapshot.
 */
export function pairBlindDraws(team: TeamRow): PairBlindDrawsResult {
  const droppedPool: PlayerRow[] = team.players.filter(p => p.droppedAfterHole != null);
  const dropoutFills = team.blindDraws.filter(b => b.holeRangeStart > 1);
  const roundStartFills = team.blindDraws.filter(b => b.holeRangeStart === 1);
  const dropoutPairings: BlindDrawPairing[] = [];
  for (const fill of dropoutFills) {
    const target = fill.holeRangeStart - 1;
    const idx = droppedPool.findIndex(p => p.droppedAfterHole === target);
    if (idx >= 0) {
      dropoutPairings.push({ player: droppedPool[idx], fill });
      droppedPool.splice(idx, 1);
    }
  }
  return { dropoutPairings, roundStartFills, unmatchedPlayers: droppedPool };
}
