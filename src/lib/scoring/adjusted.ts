// Wave 1A — GHIN Adjusted Score (Net Double Bogey / maximum hole score).
//
// A parallel, READ-ONLY score = what the player should post to GHIN. Each hole
// is capped at Net Double Bogey = par + 2 + strokes the player receives on that
// hole. The app records ACTUAL strokes everywhere (competition net, leaderboard,
// payouts, format math); this number is computed behind the scenes and shown as
// a separate orange total.
//
// LOAD-BEARING: the cap is ALWAYS computed at 100% handicap and IGNORES the
// per-round handicap allowance (Commits 1–2). GHIN doesn't know about the
// league's allowance and wants the score posted against the player's FULL
// handicap. So on an 80% round, competition net uses 80% strokes but the Adj
// cap uses 100% strokes — two handicap bases on the same screen, by design.
// Do NOT feed getPlayingStrokes() into this module.

import { getHandicapStrokes } from "./handicap";

// Net Double Bogey for one hole: par + 2 + strokes received at FULL handicap.
export function netDoubleBogeyCap(
  par: number,
  rawCourseHandicap: number | null,
  strokeIndex: number,
): number {
  return par + 2 + getHandicapStrokes(rawCourseHandicap, strokeIndex);
}

// Map an 18-length gross-score array to its adjusted (NDB-capped) equivalent.
// - null gross → null adjusted (unplayed).
// - missing par or stroke index for a hole → pass the actual score through
//   (can't compute a cap without both; never inflate or fabricate).
// - otherwise adjusted = min(actual, cap). A hole at or under the cap is
//   unchanged, so Adj == actual whenever nothing caps.
//
// `rawCourseHandicap` MUST be the player's true (100%) course handicap, NOT the
// allowance-reduced playing strokes.
export function computeAdjustedHoleScores(
  grossScores: (number | null)[],
  par: (number | null)[],
  strokeIndexes: (number | null)[],
  rawCourseHandicap: number | null,
): (number | null)[] {
  return grossScores.map((gross, i) => {
    if (gross == null) return null;
    const p = par[i];
    const si = strokeIndexes[i];
    if (p == null || si == null) return gross;
    return Math.min(gross, netDoubleBogeyCap(p, rawCourseHandicap, si));
  });
}

// Sum of the non-null adjusted scores (null when nothing was played).
export function sumAdjusted(adjScores: (number | null)[]): number | null {
  let total = 0;
  let any = false;
  for (const v of adjScores) {
    if (v != null) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}
