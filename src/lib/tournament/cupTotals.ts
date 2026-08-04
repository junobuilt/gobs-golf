// The SINGLE source for the tournament's decidable total + every threshold
// derived from it. Migration 040 lets the admin DECLARE a tournament size
// (`planned_match_total`) so the cup math doesn't shrink to the count of matches
// created so far (the "USA needs 4.5 with only Day-1 created" bug, TD45). It
// also lets a match be VOIDED (kept as a row, dropped from the pool).
//
// Every surface reads THIS — no surface recomputes liveTotal/winLine/retainLine
// on its own. Pure: takes plain counts, returns numbers. `deriveCupBar` (cup.ts)
// is the one caller that assembles the counts from a loaded dashboard; PointsBar
// then reads the results off CupBar.

import { cupThresholds } from "./cup";

export interface CupTotals {
  createdCount: number; // ALL tournament_matches (incl. voided)
  voidedCount: number; // is_voided = true
  plannedTotal: number | null; // the admin's declared size, or null (undeclared)
  // The decidable pool — the number the cup is won/retained over. Uncreated
  // planned matches ARE counted (that's the clinch fix); voided ones are not.
  liveTotal: number;
  // The bar's geometry denominator (tick count + fill widths). Uses the DECLARED
  // size so the bar doesn't resize as matches complete, but never drops below the
  // matches that actually exist and count (non-voided created) — an under-declared
  // planned total can't make the bar narrower than its own fills.
  barSize: number;
  winLine: number; // liveTotal/2 + 0.5 — majority needed to WIN the cup
  retainLine: number; // liveTotal/2 — holder retains on a tie
}

export function cupTotals(input: {
  createdCount: number;
  voidedCount: number;
  plannedTotal: number | null;
}): CupTotals {
  const { createdCount, voidedCount, plannedTotal } = input;
  const declaredOrCreated = plannedTotal ?? createdCount;
  const nonVoidedCreated = Math.max(0, createdCount - voidedCount);
  const liveTotal = Math.max(0, declaredOrCreated - voidedCount);
  // Under-declared clamp: the bar can't be narrower than the live matches it must
  // hold, so barSize is at least the non-voided created count.
  const barSize = Math.max(declaredOrCreated, nonVoidedCreated);
  const { toWin: winLine, toRetain: retainLine } = cupThresholds(liveTotal);
  return { createdCount, voidedCount, plannedTotal, liveTotal, barSize, winLine, retainLine };
}
