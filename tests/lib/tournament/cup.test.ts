// Cup math + the single PointsBar derivation. cupThresholds / formatCupPoints
// are pure; deriveCupBar reads a DashboardData (loader output) + the Tournament
// row and recomputes nothing. The card-split invariant lives here too: total
// counts EXACTLY the matches in DashboardData (which come only from
// tournament_matches) — a league round cannot inflate it.

import { describe, it, expect } from "vitest";
import { cupThresholds, formatCupPoints, deriveCupBar, cupOutcome, isMatchExcluded } from "@/lib/tournament/cup";
import type { DashboardData } from "@/lib/tournament/loadDashboard";
import { makeLoaded } from "../../support/matchFixture";
import type { LoadedMatch, Tournament, TournamentSession } from "@/lib/tournament/types";

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 1, name: "2026 GOBS Ryder Cup", season_id: null, side_a_name: "USA", side_b_name: "Canada",
    holder_side: "b", started_on: "2026-08-01", ended_on: null, is_active: true, is_published: true, planned_match_total: null, notes: null,
    ...overrides,
  };
}
function session(id: number): TournamentSession {
  return { id, tournament_id: 1, round_id: 100 + id, day_number: 1, name: "Day 1", format: "singles_match", played_on: "2026-08-01", is_locked: false, is_voided: false, handicap_allowance: null };
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
// A voided match (migration 040) — kept as a row, out of the decidable pool.
function voided(id: number): LoadedMatch {
  return makeLoaded({ id, isVoided: true, format: "singles_match", a: [{ playerId: id * 10 + 1, ch: 0, scored: {} }], b: [{ playerId: id * 10 + 2, ch: 0, scored: {} }] });
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

describe("deriveCupBar — declared total + void (migration 040)", () => {
  it("planned_match_total drives the total even when few matches are created (TD45)", () => {
    // 8 created, all pending, but the admin declared a 32-match tournament.
    const matches = Array.from({ length: 8 }, (_, i) => pending(i + 1));
    const bar = deriveCupBar(dashboard(matches, { a: 0, b: 0 }), tournament({ planned_match_total: 32 }));
    expect(bar.total).toBe(32); // liveTotal, NOT the created count
    expect(bar.barSize).toBe(32);
    expect(bar.createdCount).toBe(8);
    expect(bar.toWin).toBe(16.5);
    expect(bar.toRetain).toBe(16);
  });

  it("voiding a match drops liveTotal by 1 and shifts the thresholds; un-void restores", () => {
    const active = [decidedUSA(1), decidedUSA(2), pending(3), pending(4)];
    const withVoid = [...active, voided(5)];

    const t = tournament({ planned_match_total: null });
    // 4 non-voided created (planned NULL) → liveTotal 4, win 2.5 / retain 2.
    const before = deriveCupBar(dashboard(active, { a: 2, b: 0 }), t);
    expect(before.total).toBe(4);
    expect(before.toWin).toBe(2.5);
    expect(before.toRetain).toBe(2);
    expect(before.voidedCount).toBe(0);

    // Add a 5th match that is VOIDED: createdCount 5, but the pool stays 4.
    const voidedBar = deriveCupBar(dashboard(withVoid, { a: 2, b: 0 }), t);
    expect(voidedBar.createdCount).toBe(5);
    expect(voidedBar.voidedCount).toBe(1);
    expect(voidedBar.total).toBe(4); // liveTotal unchanged (voided excluded)
    expect(voidedBar.decided).toBe(2); // voided (pending) not counted

    // Now with planned declared at 5, that same void drops liveTotal 5 → 4.
    const tPlanned5 = tournament({ planned_match_total: 5 });
    const declaredNoVoid = deriveCupBar(dashboard(active, { a: 2, b: 0 }), tPlanned5); // 4 created, planned 5
    expect(declaredNoVoid.total).toBe(5);
    expect(declaredNoVoid.toWin).toBe(3);
    const declaredWithVoid = deriveCupBar(dashboard(withVoid, { a: 2, b: 0 }), tPlanned5);
    expect(declaredWithVoid.total).toBe(4); // 5 − 1 voided
    expect(declaredWithVoid.toWin).toBe(2.5);
    // Un-void = the same data without the voided row → back to 5.
    const restored = deriveCupBar(dashboard(active, { a: 2, b: 0 }), tPlanned5);
    expect(restored.total).toBe(5);
    expect(restored.toWin).toBe(3);
  });
});

// Mark a set of matches as belonging to a VOIDED DAY (migration 041): flips each
// match's embedded session.isVoided (the flag the loader populates from the
// session row) without touching its own is_voided.
function onVoidedDay(matches: LoadedMatch[]): LoadedMatch[] {
  return matches.map((m) => ({ ...m, session: { ...m.session, isVoided: true } }));
}

describe("isMatchExcluded — the voided-set SSOT (migrations 040 + 041)", () => {
  it("excludes a per-match void, a match on a voided day, or both; includes a plain match", () => {
    const [plain] = [pending(1)];
    const [matchVoid] = [voided(2)];
    const [dayVoid] = onVoidedDay([pending(3)]);
    const [both] = onVoidedDay([voided(4)]);
    expect(isMatchExcluded(plain)).toBe(false);
    expect(isMatchExcluded(matchVoid)).toBe(true);
    expect(isMatchExcluded(dayVoid)).toBe(true);
    expect(isMatchExcluded(both)).toBe(true);
  });
});

describe("deriveCupBar — day-level void (migration 041)", () => {
  it("voiding a whole day removes its matches from liveTotal and shifts the lines; un-void restores", () => {
    const day1 = [decidedUSA(1), decidedUSA(2)]; // 2 decided for USA
    const day2 = [pending(3), pending(4)]; // 2 pending
    const t = tournament({ planned_match_total: null });

    // Both days live: 4 created → liveTotal 4, win 2.5 / retain 2.
    const before = deriveCupBar(dashboard([...day1, ...day2], { a: 2, b: 0 }), t);
    expect(before.total).toBe(4);
    expect(before.voidedCount).toBe(0);
    expect(before.decided).toBe(2);
    expect(before.toWin).toBe(2.5);
    expect(before.toRetain).toBe(2);

    // Void day 2 (its two matches drop out): createdCount still 4, voidedCount 2,
    // liveTotal 2 → win 1.5 / retain 1. Day-1 decideds still bank.
    const dayVoided = deriveCupBar(dashboard([...day1, ...onVoidedDay(day2)], { a: 2, b: 0 }), t);
    expect(dayVoided.createdCount).toBe(4);
    expect(dayVoided.voidedCount).toBe(2);
    expect(dayVoided.total).toBe(2);
    expect(dayVoided.decided).toBe(2);
    expect(dayVoided.toWin).toBe(1.5);
    expect(dayVoided.toRetain).toBe(1);

    // Un-void the day = the same matches without the session flag → back to 4.
    const restored = deriveCupBar(dashboard([...day1, ...day2], { a: 2, b: 0 }), t);
    expect(restored.total).toBe(4);
    expect(restored.voidedCount).toBe(0);
    expect(restored.toWin).toBe(2.5);
  });

  it("with a declared planned_match_total, a voided day's matches subtract from it", () => {
    const day1 = [pending(1), pending(2)];
    const day2 = [pending(3), pending(4)];
    const t = tournament({ planned_match_total: 8 });
    expect(deriveCupBar(dashboard([...day1, ...day2], { a: 0, b: 0 }), t).total).toBe(8);
    // Void day 2 → 8 − 2 = 6.
    const voidedBar = deriveCupBar(dashboard([...day1, ...onVoidedDay(day2)], { a: 0, b: 0 }), t);
    expect(voidedBar.total).toBe(6);
    expect(voidedBar.voidedCount).toBe(2);
    expect(voidedBar.toWin).toBe(3.5);
  });

  it("orthogonality: match-void then day-void then day-un-void keeps the match-voided match out, restores the rest", () => {
    const t = tournament({ planned_match_total: null });
    // m1 individually voided; m2,m3,m4 plain — all on the same day.
    const m1 = voided(1);
    const rest = [pending(2), pending(3), pending(4)];

    // Baseline: m1 out (match-void), 3 live → liveTotal 3.
    const baseline = deriveCupBar(dashboard([m1, ...rest], { a: 0, b: 0 }), t);
    expect(baseline.createdCount).toBe(4);
    expect(baseline.voidedCount).toBe(1);
    expect(baseline.total).toBe(3);

    // Void the whole day: ALL four out → liveTotal 0.
    const dayVoided = deriveCupBar(dashboard(onVoidedDay([m1, ...rest]), { a: 0, b: 0 }), t);
    expect(dayVoided.voidedCount).toBe(4);
    expect(dayVoided.total).toBe(0);

    // Un-void the day (clears ONLY session.isVoided): m1 stays voided, the other
    // three return → back to liveTotal 3, NOT 4. This is the key correctness case.
    const afterUnvoid = deriveCupBar(dashboard([m1, ...rest], { a: 0, b: 0 }), t);
    expect(afterUnvoid.voidedCount).toBe(1);
    expect(afterUnvoid.total).toBe(3);
    // And the individually-voided match is still excluded by the predicate.
    expect(isMatchExcluded(m1)).toBe(true);
    expect(rest.every((m) => !isMatchExcluded(m))).toBe(true);
  });
});

describe("cupOutcome — the canonical verdict (SSOT)", () => {
  const base = { sideAName: "USA", sideBName: "Canada", holderSide: "b" as const, total: 8 };
  const at = (pointsA: number, pointsB: number, decided: number) =>
    cupOutcome({ ...base, pointsA, pointsB, decided });

  it("acceptance table — holder = Canada, 8 matches, win line 4.5", () => {
    expect(at(4.0, 2.0, 6)).toMatchObject({ state: "IN_PROGRESS", winnerSide: null });
    expect(at(5.0, 2.0, 7)).toMatchObject({ state: "CHALLENGER_WINS", winnerSide: "a", label: "USA WINS THE CUP." });
    expect(at(5.0, 3.0, 8)).toMatchObject({ state: "CHALLENGER_WINS", winnerSide: "a", label: "USA WINS THE CUP." });
    expect(at(4.0, 4.0, 8)).toMatchObject({ state: "HOLDER_RETAINS", winnerSide: "b", label: "Canada RETAINS THE CUP." });
    expect(at(4.5, 3.5, 8)).toMatchObject({ state: "CHALLENGER_WINS", winnerSide: "a", label: "USA WINS THE CUP." });
    expect(at(3.0, 5.0, 8)).toMatchObject({ state: "HOLDER_WINS", winnerSide: "b", label: "Canada WINS THE CUP." });
  });

  it("dynamic thresholds — 6 matches → win line auto-moves to 3.5", () => {
    const six = { ...base, total: 6 };
    // Challenger 3.5 clinches at 6 matches (was short of the 8-match 4.5 line).
    expect(cupOutcome({ ...six, pointsA: 3.5, pointsB: 1.5, decided: 5 })).toMatchObject({ state: "CHALLENGER_WINS", winnerSide: "a" });
    // 3.0 with matches still live → still reachable both ways → in progress.
    expect(cupOutcome({ ...six, pointsA: 3.0, pointsB: 1.0, decided: 4 })).toMatchObject({ state: "IN_PROGRESS" });
    // 3–3 at the end → holder retains.
    expect(cupOutcome({ ...six, pointsA: 3.0, pointsB: 3.0, decided: 6 })).toMatchObject({ state: "HOLDER_RETAINS", winnerSide: "b" });
  });

  it("decide-early + max-reachable uses remaining × 1 (a live match can swing a full point)", () => {
    // Holder clinches the retain with a dead rubber STILL live: USA 3.0, Canada
    // 4.0, 7 decided (1 live). USA max = 3.0 + 1 = 4.0 < 4.5 → RETAIN now.
    expect(at(3.0, 4.0, 7)).toMatchObject({ state: "HOLDER_RETAINS", winnerSide: "b" });
    // USA 3.5 with 1 live can still reach 4.5 → NOT yet decided. (A ×0.5 bug here
    // would wrongly retain at max 4.0.)
    expect(at(3.5, 3.5, 7)).toMatchObject({ state: "IN_PROGRESS" });
  });

  it("reads the LIVE holder side — holder a (not Canada)", () => {
    const holderA = { sideAName: "USA", sideBName: "Canada", holderSide: "a" as const, total: 8 };
    expect(cupOutcome({ ...holderA, pointsA: 4.0, pointsB: 4.0, decided: 8 })).toMatchObject({ state: "HOLDER_RETAINS", winnerSide: "a", label: "USA RETAINS THE CUP." });
    expect(cupOutcome({ ...holderA, pointsA: 2.0, pointsB: 5.0, decided: 8 })).toMatchObject({ state: "CHALLENGER_WINS", winnerSide: "b", label: "Canada WINS THE CUP." });
  });

  it("null holder (safety net) — outright win only; a tie stays undecided", () => {
    const none = { sideAName: "USA", sideBName: "Canada", holderSide: null, total: 8 };
    expect(cupOutcome({ ...none, pointsA: 4.5, pointsB: 3.5, decided: 8 })).toMatchObject({ state: "CHALLENGER_WINS", winnerSide: "a" });
    expect(cupOutcome({ ...none, pointsA: 4.0, pointsB: 4.0, decided: 8 })).toMatchObject({ state: "IN_PROGRESS", winnerSide: null });
  });
});
