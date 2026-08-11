// Per-unit match strokes — the ONE place stroke allocation is derived, shared by
// the loader (assembleMatch) and the pre-save pairings preview so the strokes Dad
// sees while building a group can never diverge from what the saved card shows.
// Pure: it only calls matchplay.ts (computeMatchStrokes / greensomesTeamHandicap)
// on raw course handicaps — no Supabase, no score arithmetic.

import {
  computeMatchStrokes,
  greensomesTeamHandicap,
  resolveTournamentAllowance,
  tournamentPlayingHandicap,
} from "./matchplay";
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
  // The session's raw handicap_allowance (migration 042), or null. Resolved per
  // format via resolveTournamentAllowance — four-ball only; greensomes ignores
  // it (60/40); singles is always 100%. Absent/null ⇒ 100% (back-compat).
  sessionAllowance: number | null = null,
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
  // singles / four-ball: units are the individual players. PH = CH × the format's
  // allowance (singles 100%, four-ball the session value or 100%) via the shared
  // resolveTournamentAllowance + tournamentPlayingHandicap — the SAME math
  // matchplay's sideHoleNets uses, so preview and scored card can't diverge.
  // Combine all players in aThenB order, compute, slice.
  const allowance = resolveTournamentAllowance(format, sessionAllowance);
  const phs = [...aCHs, ...bCHs].map(
    (c) => tournamentPlayingHandicap(c, allowance) ?? 0,
  );
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
