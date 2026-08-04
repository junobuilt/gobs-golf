// Scorecard "resume to my spot" resolver (both apps).
//
// When a player checks the leaderboard mid-round and returns to their
// scorecard, it must reopen where they were — NOT on numeric hole 1. Two
// layers drive the initial hole:
//   1. a remembered last-viewed hole (localStorage, see holeMemory.ts), and
//   2. this fallback: the first UNSCORED hole in PLAY ORDER from the group's
//      start hole, wrapping 18→1.
//
// The play-order walk is start-position-agnostic: a hole-1 start yields the
// ordinary numeric 1..18 sequence, a shotgun group starting on hole 12 walks
// 12,13,…,18,1,…,11. Walking numeric 1→18 instead would land a shotgun group
// on hole 1 (a hole they play LAST) — the exact mis-entry trap this exists to
// kill. The rotation is owned by holePlayOrder (matchplay.ts) — the single
// source of truth also used by the tournament nav rail and match engine.

import { holePlayOrder } from "@/lib/tournament/matchplay";

/**
 * First unscored hole in play order from `startHole` (wrapping 18→1). If every
 * hole is scored, returns the LAST hole in play order (so a finished card lands
 * on the final hole, not back at the start).
 *
 * @param isScored predicate: true when the given 1-indexed hole already has a
 *   score entered. For the regular app this is "any player on the team has a
 *   score on that hole"; for tournament it's "any score present on that hole
 *   across the group".
 */
export function resolveResumeHole({
  startHole,
  total = 18,
  isScored,
}: {
  startHole: number;
  total?: number;
  isScored: (hole: number) => boolean;
}): number {
  const order = holePlayOrder(startHole, total);
  for (const hole of order) {
    if (!isScored(hole)) return hole;
  }
  // Every hole scored → land on the last hole in play order.
  return order[order.length - 1];
}

/**
 * True when `hole` is a valid 1..total hole number. Guards a persisted value
 * (from a prior round shape, a hand-edited localStorage entry, or corruption)
 * so a bad saved hole falls through to the fallback resolver rather than
 * landing the player on a nonexistent hole.
 */
export function isValidHole(hole: unknown, total = 18): hole is number {
  return typeof hole === "number" && Number.isInteger(hole) && hole >= 1 && hole <= total;
}

/**
 * The scorecard's initial hole: honor a valid saved (last-viewed) hole if one
 * exists, else run the play-order fallback. Single composition point shared by
 * both scorecards so the restore-vs-fallback decision is identical and unit-
 * testable without rendering a component.
 */
export function pickInitialHole({
  savedHole,
  startHole,
  total = 18,
  isScored,
}: {
  savedHole: number | null;
  startHole: number;
  total?: number;
  isScored: (hole: number) => boolean;
}): number {
  if (isValidHole(savedHole, total)) return savedHole;
  return resolveResumeHole({ startHole, total, isScored });
}
