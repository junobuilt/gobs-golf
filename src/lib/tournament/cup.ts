// Cup-points math + the SINGLE derivation feeding the PointsBar on every
// surface (Home hero, Tournament Home, Scoreboard). Pure — reads the canonical
// `DashboardData` (loadDashboard → computeTournamentStandings) + the Tournament
// row; recomputes NOTHING. `deriveCupBar` is the SSOT: all three surfaces feed
// PointsBar from THIS one function, so the bar is identical by construction
// (guarded by the cross-surface test).

import type { DashboardData } from "./loadDashboard";
import type { Side, Tournament } from "./types";

// Cup thresholds off the DYNAMIC total (created matches, not a fixed 27/28):
//   to-win    = total/2 + 0.5  (outright win — must exceed half)
//   to-retain = total/2        (the holder retains the cup on a dead tie)
export function cupThresholds(total: number): { toWin: number; toRetain: number } {
  return { toWin: total / 2 + 0.5, toRetain: total / 2 };
}

// Half-point display: "8" | "8½" | "½" | "−1½". Powers the bar fills, the
// per-match "pts", and the win/retain captions.
export function formatCupPoints(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const hasHalf = abs - whole >= 0.5;
  const body = hasHalf ? (whole === 0 ? "½" : `${whole}½`) : `${whole}`;
  return neg ? `−${body}` : body;
}

// ── Cup verdict (SSOT) ───────────────────────────────────────────────────────
// The ONE helper that turns points → cup state. Every surface's win/retain
// caption reads THIS (never a positional/static label). Thresholds are dynamic
// off the current match count; `holder_side` is live from the DB (never assume a
// side). A live match can still yield up to 1 pt to a side, so the challenger's
// max-reachable uses `remaining × 1`.
export type CupState = "IN_PROGRESS" | "CHALLENGER_WINS" | "HOLDER_WINS" | "HOLDER_RETAINS";

export interface CupVerdict {
  state: CupState;
  winnerSide: Side | null; // the side that wins/retains; null while in progress
  label: string | null; // "USA WINS THE CUP." / "CANADA RETAINS THE CUP." / null
}

export function cupOutcome(input: {
  pointsA: number;
  pointsB: number;
  sideAName: string;
  sideBName: string;
  holderSide: Side | null;
  total: number;
  decided: number;
}): CupVerdict {
  const { pointsA, pointsB, sideAName, sideBName, holderSide, total, decided } = input;
  const { toWin: winLine } = cupThresholds(total); // total/2 + 0.5
  const remaining = Math.max(0, total - decided);
  const nameOf = (s: Side) => (s === "a" ? sideAName : sideBName);
  const winLabel = (s: Side) => `${nameOf(s)} WINS THE CUP.`;

  // No holder set (safety net — holder is set at go-live). No retain concept:
  // a side wins outright at the win line; a tie/short stays undecided.
  if (holderSide == null) {
    if (pointsA >= winLine) return { state: "CHALLENGER_WINS", winnerSide: "a", label: winLabel("a") };
    if (pointsB >= winLine) return { state: "CHALLENGER_WINS", winnerSide: "b", label: winLabel("b") };
    return { state: "IN_PROGRESS", winnerSide: null, label: null };
  }

  const challengerSide: Side = holderSide === "a" ? "b" : "a";
  const holderPts = holderSide === "a" ? pointsA : pointsB;
  const challengerPts = challengerSide === "a" ? pointsA : pointsB;
  const challengerMax = challengerPts + remaining; // a live match can still give the challenger up to 1

  // Order (canonical): challenger win → holder outright majority → holder safe
  // (retain) → still in progress. Holder "majority" = points > half = ≥ winLine
  // (points move in ½ steps). Retain = the challenger can no longer reach the
  // win line — the dead-tie case (N/2–N/2) is its canonical instance.
  if (challengerPts >= winLine) {
    return { state: "CHALLENGER_WINS", winnerSide: challengerSide, label: winLabel(challengerSide) };
  }
  if (holderPts >= winLine) {
    return { state: "HOLDER_WINS", winnerSide: holderSide, label: winLabel(holderSide) };
  }
  if (challengerMax < winLine) {
    return { state: "HOLDER_RETAINS", winnerSide: holderSide, label: `${nameOf(holderSide)} RETAINS THE CUP.` };
  }
  return { state: "IN_PROGRESS", winnerSide: null, label: null };
}

export interface CupBar {
  sideAName: string;
  sideBName: string;
  // Banked (decided-only, ½ per halve) country points — the bar fill values.
  pointsA: number;
  pointsB: number;
  total: number; // created matches (dynamic)
  decided: number; // matches with an authoritative result
  liveNow: number; // undecided matches with at least one resolved hole
  pointsInPlay: number; // total − decided (each undecided match = 1 available point)
  toWin: number;
  toRetain: number;
  holderSide: Side | null;
}

// The one derivation. Every field comes from the canonical loader output — the
// banked points are `standings.banked` (admin overrides already applied by
// resolveMatchResult upstream); the counts are read off the same LoadedMatch
// list the rows render. No parallel fetch, no recompute.
export function deriveCupBar(data: DashboardData, tournament: Tournament): CupBar {
  const matches = data.days.flatMap((d) => d.matches);
  const total = matches.length;
  const decided = matches.filter((m) => m.resolved.result != null).length;
  const liveNow = matches.filter((m) => m.resolved.result == null && m.state.thru > 0).length;
  const { toWin, toRetain } = cupThresholds(total);
  return {
    sideAName: tournament.side_a_name,
    sideBName: tournament.side_b_name,
    pointsA: data.standings.banked.a,
    pointsB: data.standings.banked.b,
    total,
    decided,
    liveNow,
    pointsInPlay: total - decided,
    toWin,
    toRetain,
    holderSide: tournament.holder_side,
  };
}
