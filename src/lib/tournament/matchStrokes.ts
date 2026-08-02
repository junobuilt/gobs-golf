// Per-unit match strokes — the ONE place stroke allocation is derived, shared by
// the loader (assembleMatch) and the pre-save pairings preview so the strokes Dad
// sees while building a group can never diverge from what the saved card shows.
// Pure: it only calls matchplay.ts (computeMatchStrokes / greensomesTeamHandicap)
// on raw course handicaps — no Supabase, no score arithmetic.

import { computeMatchStrokes, greensomesTeamHandicap } from "./matchplay";
import type { SessionFormat } from "./types";

export interface SideStrokes {
  // Per-slot match strokes in the order the CHs were passed. For greensomes both
  // partners carry the side's collapsed value.
  aStrokes: number[];
  bStrokes: number[];
  // Greensomes only — each pair collapsed to one handicap + its side match
  // strokes. null for singles/four-ball (strokes are per-player above).
  aCollapsed: number | null;
  bCollapsed: number | null;
  aSideStrokes: number | null;
  bSideStrokes: number | null;
}

export function computeSideStrokes(
  format: SessionFormat,
  aCHs: ReadonlyArray<number | null>,
  bCHs: ReadonlyArray<number | null>,
): SideStrokes {
  if (format === "greensomes") {
    const aCollapsed = greensomesTeamHandicap(aCHs[0] ?? null, aCHs[1] ?? null);
    const bCollapsed = greensomesTeamHandicap(bCHs[0] ?? null, bCHs[1] ?? null);
    const [msA, msB] = computeMatchStrokes([aCollapsed, bCollapsed]);
    return {
      aStrokes: aCHs.map(() => msA),
      bStrokes: bCHs.map(() => msB),
      aCollapsed,
      bCollapsed,
      aSideStrokes: msA,
      bSideStrokes: msB,
    };
  }
  // singles / four-ball: units are the individual players, PH = 100% CH; combine
  // all players in aThenB order, compute, slice — matches matchplay's sideHoleNets.
  const phs = [...aCHs, ...bCHs].map((c) => c ?? 0);
  const ms = computeMatchStrokes(phs);
  return {
    aStrokes: ms.slice(0, aCHs.length),
    bStrokes: ms.slice(aCHs.length),
    aCollapsed: null,
    bCollapsed: null,
    aSideStrokes: null,
    bSideStrokes: null,
  };
}
