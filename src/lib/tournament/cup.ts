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
