// Cup math + the single PointsBar derivation. cupThresholds / formatCupPoints
// are pure; deriveCupBar reads a DashboardData (loader output) + the Tournament
// row and recomputes nothing. The card-split invariant lives here too: total
// counts EXACTLY the matches in DashboardData (which come only from
// tournament_matches) — a league round cannot inflate it.

import { describe, it, expect } from "vitest";
import { cupThresholds, formatCupPoints, deriveCupBar } from "@/lib/tournament/cup";
import type { DashboardData } from "@/lib/tournament/loadDashboard";
import { makeLoaded } from "../../support/matchFixture";
import type { LoadedMatch, Tournament, TournamentSession } from "@/lib/tournament/types";

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 1, name: "2026 GOBS Ryder Cup", season_id: null, side_a_name: "USA", side_b_name: "Canada",
    holder_side: "b", started_on: "2026-08-01", ended_on: null, is_active: true, is_published: true, notes: null,
    ...overrides,
  };
}
function session(id: number): TournamentSession {
  return { id, tournament_id: 1, round_id: 100 + id, day_number: 1, name: "Day 1", format: "singles_match", played_on: "2026-08-01", is_locked: false };
}

// A USA-win match (USA gross 3, Canada gross 5 → closes out, result side_a).
function decidedUSA(id: number): LoadedMatch {
  const scored = (g: number) => Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, g]));
  return makeLoaded({ id, format: "singles_match", a: [{ playerId: id * 10 + 1, ch: 0, scored: scored(3) }], b: [{ playerId: id * 10 + 2, ch: 0, scored: scored(5) }] });
}
// A live, undecided match — scores on holes 1..5 only (thru 5, not complete).
function live(id: number): LoadedMatch {
  const partial = (g: number) => Object.fromEntries(Array.from({ length: 5 }, (_, i) => [i + 1, g]));
  return makeLoaded({ id, format: "singles_match", a: [{ playerId: id * 10 + 1, ch: 0, scored: partial(4) }], b: [{ playerId: id * 10 + 2, ch: 0, scored: partial(4) }] });
}
// A not-started match — no scores (thru 0).
function pending(id: number): LoadedMatch {
  return makeLoaded({ id, format: "singles_match", a: [{ playerId: id * 10 + 1, ch: 0, scored: {} }], b: [{ playerId: id * 10 + 2, ch: 0, scored: {} }] });
}

function dashboard(matches: LoadedMatch[], banked: { a: number; b: number }): DashboardData {
  return {
    standings: { banked, projected: banked, inPlay: [] },
    days: [{ session: session(9), matches, error: false }],
    adjustments: [],
  };
}

describe("cupThresholds", () => {
  it("to-win = total/2 + 0.5, to-retain = total/2 (dynamic total)", () => {
    expect(cupThresholds(28)).toEqual({ toWin: 14.5, toRetain: 14 });
    expect(cupThresholds(27)).toEqual({ toWin: 14, toRetain: 13.5 });
    expect(cupThresholds(24)).toEqual({ toWin: 12.5, toRetain: 12 });
  });
});

describe("formatCupPoints", () => {
  it("renders halves with the ½ glyph", () => {
    expect(formatCupPoints(8)).toBe("8");
    expect(formatCupPoints(8.5)).toBe("8½");
    expect(formatCupPoints(0.5)).toBe("½");
    expect(formatCupPoints(0)).toBe("0");
    expect(formatCupPoints(14)).toBe("14");
    expect(formatCupPoints(13.5)).toBe("13½");
    expect(formatCupPoints(-1.5)).toBe("−1½");
  });
});

describe("deriveCupBar", () => {
  it("derives banked points, dynamic total, decided/live counts, thresholds, holder", () => {
    const matches = [decidedUSA(1), decidedUSA(2), live(3), pending(4)];
    const bar = deriveCupBar(dashboard(matches, { a: 2, b: 0 }), tournament());

    expect(bar.total).toBe(4); // created matches
    expect(bar.decided).toBe(2);
    expect(bar.liveNow).toBe(1); // undecided with ≥1 resolved hole
    expect(bar.pointsInPlay).toBe(2); // total − decided
    expect(bar.pointsA).toBe(2);
    expect(bar.pointsB).toBe(0);
    expect(bar.toWin).toBe(2.5);
    expect(bar.toRetain).toBe(2);
    expect(bar.holderSide).toBe("b");
    expect(bar.sideAName).toBe("USA");
    expect(bar.sideBName).toBe("Canada");
  });

  it("card-split: total counts ONLY the matches in DashboardData (no league leakage)", () => {
    // DashboardData is assembled solely from tournament_matches; a league round
    // never appears here, so the total is exactly the tournament match count.
    const matches = [decidedUSA(1), live(2)];
    const bar = deriveCupBar(dashboard(matches, { a: 1, b: 0 }), tournament());
    expect(bar.total).toBe(2);
    expect(bar.decided).toBe(1);
  });

  it("honors the holder side for the retain line (holder a)", () => {
    const bar = deriveCupBar(dashboard([decidedUSA(1)], { a: 1, b: 0 }), tournament({ holder_side: "a" }));
    expect(bar.holderSide).toBe("a");
  });
});
