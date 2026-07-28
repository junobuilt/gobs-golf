// Tournament match-play engine — golden tests. Every expected value is
// hand-computed and written as a literal. Pure logic only; no Supabase, no UI.

import { describe, it, expect } from "vitest";
import {
  computeMatchStrokes,
  greensomesTeamHandicap,
  computeMatchState,
  countryPointsForResult,
  resolveMatchResult,
  computeTournamentStandings,
} from "@/lib/tournament/matchplay";
import type {
  HoleMeta,
  MatchInput,
  MatchPlayerInput,
} from "@/lib/tournament/types";

// 18 holes, par 4, stroke_index = hole number (SI 1 is hardest).
function holes(): HoleMeta[] {
  return Array.from({ length: 18 }, (_, i) => ({
    holeNumber: i + 1,
    par: 4,
    strokeIndex: i + 1,
  }));
}

// A gross array of length 18. `scored` maps 1-indexed hole → gross; unlisted
// holes are null (no score present).
function gross(scored: Record<number, number>): (number | null)[] {
  return Array.from({ length: 18 }, (_, i) => scored[i + 1] ?? null);
}

function player(playerId: number, ch: number | null, scored: Record<number, number>): MatchPlayerInput {
  return { playerId, courseHandicap: ch, gross: gross(scored) };
}

// Fill every hole 1..18 with a fixed gross.
function flat(v: number): Record<number, number> {
  const o: Record<number, number> = {};
  for (let h = 1; h <= 18; h++) o[h] = v;
  return o;
}

// ── §3.1 — match strokes ────────────────────────────────────────────────────
describe("computeMatchStrokes (§2.1)", () => {
  it("PH 5/10/10/20 → strokes 0/5/5/15 (the worked example)", () => {
    expect(computeMatchStrokes([5, 10, 10, 20])).toEqual([0, 5, 5, 15]);
  });

  it("clamps at 0 — the low unit never goes negative, ties both get 0", () => {
    expect(computeMatchStrokes([8, 8])).toEqual([0, 0]);
    expect(computeMatchStrokes([10, 5, 20])).toEqual([5, 0, 15]); // min need not be first
  });
});

// ── §6.3 correction — greensomes min is across the two SIDES ─────────────────
describe("greensomes team handicap + side strokes (§2.2 / correction 3 / Q4 60-40)", () => {
  it("Q4 60/40: 5+15 → 9, 10+20 → 14 (0.6·low + 0.4·high, .5 up)", () => {
    // Q4 weighted: 0.6·5 + 0.4·15 = 9; 0.6·10 + 0.4·20 = 14 (was 10 & 15 under
    // half-of-combined). Only these two values move under the 60/40 flip.
    expect(greensomesTeamHandicap(5, 15)).toBe(9);
    expect(greensomesTeamHandicap(10, 20)).toBe(14);
  });

  it("yields TWO side strokes 0 and 5 — not four per-player values", () => {
    const phA = greensomesTeamHandicap(5, 15); // 9
    const phB = greensomesTeamHandicap(10, 20); // 14
    expect(computeMatchStrokes([phA, phB])).toEqual([0, 5]); // 14−9 = 5 (spread preserved)
  });
});

// ── §3.2 — a handicap stroke changes the winner vs gross, per format ─────────
describe("handicap stroke changes the hole winner vs gross", () => {
  it("singles_match: A's stroke flips a gross halve into an A win", () => {
    // Hole 1 (SI 1). A gross 4, B gross 4 → gross HALVE. A CH 18 (1 stroke every
    // hole), B CH 0. minPH 0 → A matchStrokes 18. A gets 1 stroke on SI 1 →
    // matchNet 3 < B 4 → side_a.
    const input: MatchInput = {
      format: "singles_match",
      holes: holes(),
      sideA: { side: "a", players: [player(1, 18, { 1: 4 })] },
      sideB: { side: "b", players: [player(2, 0, { 1: 4 })] },
    };
    const st = computeMatchState(input);
    expect(st.holeOutcomes[0]).toBe("side_a"); // gross would be "halved"
    expect(st.thru).toBe(1);
  });

  it("four_ball_match: the higher-handicap A player's stroke wins the hole for A", () => {
    // Hole 1 (SI 1). A players: CH 10 gross 4, CH 0 gross 6. B players: CH 0
    // gross 4, CH 0 gross 5. minPH across 4 = 0 → A0 matchStrokes 10 (1 stroke
    // on SI 1) → matchNet 3; A1 matchNet 6; best A = 3. B best = 4. → side_a.
    // Gross best: A = min(4,6)=4, B = min(4,5)=4 → HALVE. Stroke flips to A.
    const input: MatchInput = {
      format: "four_ball_match",
      holes: holes(),
      sideA: { side: "a", players: [player(1, 10, { 1: 4 }), player(2, 0, { 1: 6 })] },
      sideB: { side: "b", players: [player(3, 0, { 1: 4 }), player(4, 0, { 1: 5 })] },
    };
    const st = computeMatchState(input);
    expect(st.holeOutcomes[0]).toBe("side_a");
  });

  it("greensomes: the higher team's stroke flips a gross A win into a halve", () => {
    // Hole 1 (SI 1). Q4 60/40: Team A = 5+15 → 9; Team B = 10+20 → 14. minPH 9 →
    // B gets 5 strokes (14−9, spread preserved), 1 on SI 1. teamGross A 4, B 5 →
    // gross A WIN. B matchNet 5−1=4, A 4 → HALVE (outcome unchanged from 50/50).
    const teamA = gross({ 1: 4 });
    const teamB = gross({ 1: 5 });
    const input: MatchInput = {
      format: "greensomes",
      holes: holes(),
      sideA: { side: "a", players: [player(1, 5, {}), player(2, 15, {})], teamGross: teamA },
      sideB: { side: "b", players: [player(3, 10, {}), player(4, 20, {})], teamGross: teamB },
    };
    const st = computeMatchState(input);
    expect(st.holeOutcomes[0]).toBe("halved");
  });
});

// ── §3.3 — halved hole → 0.5 / 0.5 ──────────────────────────────────────────
describe("halved hole points (§2.4)", () => {
  it("a single halved hole splits 0.5 / 0.5 and leaves the match in progress", () => {
    const input: MatchInput = {
      format: "singles_match",
      holes: holes(),
      sideA: { side: "a", players: [player(1, 0, { 1: 4 })] },
      sideB: { side: "b", players: [player(2, 0, { 1: 4 })] },
    };
    const st = computeMatchState(input);
    expect(st.holeOutcomes[0]).toBe("halved");
    expect(st.pointsA).toBe(0.5);
    expect(st.pointsB).toBe(0.5);
    expect(st.holesUp).toBe(0);
    expect(st.status).toBe("in_progress");
  });
});

// Helper for §3.4/§3.6: a scratch (CH 0) singles match where each side's gross
// is set directly, so matchNet == gross and outcomes are exactly as written.
// `aWins` / `bWins` list 1-indexed holes; `halves` list halved holes; anything
// else is left unscored (null).
function scratchSingles(opts: {
  aWins?: number[];
  bWins?: number[];
  halves?: number[];
}): MatchInput {
  const A: Record<number, number> = {};
  const B: Record<number, number> = {};
  for (const h of opts.aWins ?? []) { A[h] = 3; B[h] = 4; }
  for (const h of opts.bWins ?? []) { A[h] = 4; B[h] = 3; }
  for (const h of opts.halves ?? []) { A[h] = 4; B[h] = 4; }
  return {
    format: "singles_match",
    holes: holes(),
    sideA: { side: "a", players: [player(1, 0, A)] },
    sideB: { side: "b", players: [player(2, 0, B)] },
  };
}

// ── §3.4 / §2.5 — closeout boundary rows ────────────────────────────────────
describe("closeout boundaries (§2.5)", () => {
  it("thru 14, 5 up, 4 remaining → CLOSED, 5&4", () => {
    // A wins holes 1-5, halves 6-14; 15-18 unscored.
    const st = computeMatchState(scratchSingles({
      aWins: [1, 2, 3, 4, 5],
      halves: [6, 7, 8, 9, 10, 11, 12, 13, 14],
    }));
    expect(st.thru).toBe(14);
    expect(st.holesUp).toBe(5);
    expect(st.status).toBe("complete");
    expect(st.result).toBe("side_a");
    expect(st.closedOutHole).toBe(14);
    expect(st.margin).toBe("5&4");
  });

  it("thru 14, 4 up, 4 remaining → DORMIE, NOT closed", () => {
    const st = computeMatchState(scratchSingles({
      aWins: [1, 2, 3, 4],
      halves: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    }));
    expect(st.thru).toBe(14);
    expect(st.holesUp).toBe(4);
    expect(st.status).toBe("in_progress");
    expect(st.result).toBe(null);
    expect(st.closedOutHole).toBe(null);
    expect(st.margin).toBe("4 UP");
  });

  it("thru 17, 2 up, 1 remaining → CLOSED, 2&1", () => {
    const st = computeMatchState(scratchSingles({
      aWins: [1, 2],
      halves: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
    }));
    expect(st.thru).toBe(17);
    expect(st.holesUp).toBe(2);
    expect(st.status).toBe("complete");
    expect(st.closedOutHole).toBe(17);
    expect(st.margin).toBe("2&1");
  });

  it("thru 18, 1 up, 0 remaining → won 1 UP (not an early closeout)", () => {
    const halves: number[] = [];
    for (let h = 2; h <= 18; h++) halves.push(h);
    const st = computeMatchState(scratchSingles({ aWins: [1], halves }));
    expect(st.thru).toBe(18);
    expect(st.holesUp).toBe(1);
    expect(st.status).toBe("complete");
    expect(st.result).toBe("side_a");
    expect(st.closedOutHole).toBe(null);
    expect(st.margin).toBe("1 UP");
  });

  it("thru 18, all square → NO closeout, halved (AS)", () => {
    const halves: number[] = [];
    for (let h = 5; h <= 18; h++) halves.push(h);
    const st = computeMatchState(scratchSingles({
      aWins: [1, 2],
      bWins: [3, 4],
      halves,
    }));
    expect(st.thru).toBe(18);
    expect(st.holesUp).toBe(0);
    expect(st.status).toBe("complete");
    expect(st.result).toBe("halved");
    expect(st.closedOutHole).toBe(null);
    expect(st.margin).toBe("AS");
  });
});

// ── §3.5 — 18 holes dead level → halved + 0.5/0.5 country points ─────────────
describe("all square through 18 (§3.5)", () => {
  it("result halved, country points 0.5 / 0.5", () => {
    const halves: number[] = [];
    for (let h = 5; h <= 18; h++) halves.push(h);
    const st = computeMatchState(scratchSingles({ aWins: [1, 2], bWins: [3, 4], halves }));
    expect(st.result).toBe("halved");
    expect(countryPointsForResult(st.result)).toEqual({ a: 0.5, b: 0.5 });
  });
});

// ── §3.6 — gap handling (the load-bearing one) ──────────────────────────────
describe("gap handling — a missing hole stops the count (§2.4)", () => {
  // Holes 1-6 and 8-14 scored; hole 7 MISSING; 15-18 unscored.
  // Through 6: A wins 1,2 → 2 up. Through 14 (once 7 is a halve): A wins
  // 1,2,8,9,10 → 5 up, thru 14, remaining 4 → would close 5&4.
  const baseAWins = [1, 2, 8, 9, 10];
  const baseHalves = [3, 4, 5, 6, 11, 12, 13, 14];

  it("hole 7 missing → thru 6, firstUnresolvedHole 7, NOT closed (8-14 ignored)", () => {
    const st = computeMatchState(scratchSingles({ aWins: baseAWins, halves: baseHalves }));
    expect(st.thru).toBe(6);
    expect(st.firstUnresolvedHole).toBe(7);
    expect(st.holesUp).toBe(2); // only holes 1-6 count
    expect(st.status).toBe("in_progress");
    expect(st.closedOutHole).toBe(null);
  });

  it("NEGATIVE CONTROL: filling hole 7 flips it to closed (5&4)", () => {
    const st = computeMatchState(scratchSingles({
      aWins: baseAWins,
      halves: [...baseHalves, 7], // fill the gap as a halve
    }));
    expect(st.thru).toBe(14);
    expect(st.firstUnresolvedHole).toBe(15);
    expect(st.holesUp).toBe(5);
    expect(st.status).toBe("complete");
    expect(st.result).toBe("side_a");
    expect(st.closedOutHole).toBe(14);
    expect(st.margin).toBe("5&4");
  });
});

// ── closeout freezes at the closeout hole, ignoring later scores ────────────
const range = (a: number, b: number): number[] =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("closeout freezes state at the closeout hole (scoredBeyondCloseout)", () => {
  it("(a) closes 5&4 at 14 even when 15-18 are ALSO scored; points frozen", () => {
    // A wins 1-5, halves 6-18 (all 18 entered). Closeout at hole 14 (5 up, 4 to
    // play). Holes 15-18 are ignored: margin 5&4, and points freeze at 14 —
    // pointsA = 5 wins + 9 halves(6-14)/2 = 9.5 (NOT 11.5 with 15-18 counted).
    const st = computeMatchState(scratchSingles({ aWins: [1, 2, 3, 4, 5], halves: range(6, 18) }));
    expect(st.result).toBe("side_a");
    expect(st.margin).toBe("5&4");
    expect(st.closedOutHole).toBe(14);
    expect(st.holesUp).toBe(5);
    expect(st.pointsA).toBe(9.5);
    expect(st.pointsB).toBe(4.5);
    expect(st.scoredBeyondCloseout).toBe(true);
  });

  it("(b) REGRESSION: the same match with 15-18 blank is unchanged (no extra scores)", () => {
    const st = computeMatchState(scratchSingles({ aWins: [1, 2, 3, 4, 5], halves: range(6, 14) }));
    expect(st.margin).toBe("5&4");
    expect(st.closedOutHole).toBe(14);
    expect(st.thru).toBe(14);
    expect(st.holesUp).toBe(5);
    expect(st.pointsA).toBe(9.5);
    expect(st.scoredBeyondCloseout).toBe(false);
  });

  it("(c) dormie then halved-out (B wins 18) → AS, never closes early", () => {
    // A up 1 through 17 (dormie: lead 1 == 1 to play), B wins 18 → all square.
    const st = computeMatchState(scratchSingles({ aWins: [1], halves: range(2, 17), bWins: [18] }));
    expect(st.thru).toBe(18);
    expect(st.result).toBe("halved");
    expect(st.margin).toBe("AS");
    expect(st.closedOutHole).toBe(null);
    expect(st.scoredBeyondCloseout).toBe(false);
  });

  it("(d) correcting an early hole moves the closeout later and recomputes", () => {
    // Before: A wins 1-5, halves 6-18 → closes 5&4 at 14.
    const before = computeMatchState(scratchSingles({ aWins: [1, 2, 3, 4, 5], halves: range(6, 18) }));
    expect(before.closedOutHole).toBe(14);
    expect(before.margin).toBe("5&4");

    // Correct hole 1 from an A win to a B win → A now only 3 up; the closeout
    // slides to hole 16 (3 up, 2 to play).
    const after = computeMatchState(scratchSingles({ aWins: [2, 3, 4, 5], bWins: [1], halves: range(6, 18) }));
    expect(after.result).toBe("side_a");
    expect(after.closedOutHole).toBe(16);
    expect(after.margin).toBe("3&2");
    expect(after.holesUp).toBe(3);
  });
});

// ── §3.7 / §3.9 — admin override precedence ─────────────────────────────────
describe("admin override beats the engine (§2.7)", () => {
  it("admin result wins over a contradicting engine result", () => {
    // Engine: A wins clearly (thru 18, A up). Admin overrides to side_b.
    const halves: number[] = [];
    for (let h = 3; h <= 18; h++) halves.push(h);
    const engineState = computeMatchState(scratchSingles({ aWins: [1, 2], halves }));
    expect(engineState.result).toBe("side_a"); // engine's honest view

    const resolved = resolveMatchResult(engineState, {
      result_source: "admin",
      result: "side_b",
    });
    expect(resolved.source).toBe("admin");
    expect(resolved.result).toBe("side_b"); // admin wins unconditionally
    expect(resolved.engineResult).toBe("side_a"); // engine view still surfaced
    expect(resolved.pointsA).toBe(0);
    expect(resolved.pointsB).toBe(1);
  });

  it("admin result wins over an EMPTY scorecard (engine pending, no scores)", () => {
    const empty: MatchInput = {
      format: "singles_match",
      holes: holes(),
      sideA: { side: "a", players: [player(1, 0, {})] },
      sideB: { side: "b", players: [player(2, 0, {})] },
    };
    const engineState = computeMatchState(empty);
    expect(engineState.status).toBe("pending");
    expect(engineState.result).toBe(null);

    const resolved = resolveMatchResult(engineState, {
      result_source: "admin",
      result: "side_a",
    });
    expect(resolved.source).toBe("admin");
    expect(resolved.result).toBe("side_a");
    expect(resolved.engineResult).toBe(null);
    expect(resolved.pointsA).toBe(1);
    expect(resolved.pointsB).toBe(0);
  });

  it("withdrawal-as-halved: no scores + admin 'halved' → 0.5 / 0.5 (§3.9)", () => {
    const empty: MatchInput = {
      format: "four_ball_match",
      holes: holes(),
      sideA: { side: "a", players: [player(1, 0, {}), player(2, 0, {})] },
      sideB: { side: "b", players: [player(3, 0, {}), player(4, 0, {})] },
    };
    const engineState = computeMatchState(empty);
    const resolved = resolveMatchResult(engineState, {
      result_source: "admin",
      result: "halved",
    });
    expect(resolved.result).toBe("halved");
    expect(resolved.pointsA).toBe(0.5);
    expect(resolved.pointsB).toBe(0.5);
  });

  it("engine-sourced rows use the engine result (no override)", () => {
    const halves: number[] = [];
    for (let h = 3; h <= 18; h++) halves.push(h);
    const engineState = computeMatchState(scratchSingles({ aWins: [1, 2], halves }));
    const resolved = resolveMatchResult(engineState, {
      result_source: "engine",
      result: null,
    });
    expect(resolved.source).toBe("engine");
    expect(resolved.result).toBe("side_a");
  });
});

// ── §3.8 — tournament standings ─────────────────────────────────────────────
describe("tournament standings (§2.8)", () => {
  it("banked + in-play + projected, including an adjustment row", () => {
    const standings = computeTournamentStandings(
      [
        { matchId: 1, result: "side_a", holesUp: 3, thru: 16, margin: "3&2" }, // banked A
        { matchId: 2, result: "halved", holesUp: 0, thru: 18, margin: "AS" }, // banked split
        { matchId: 3, result: null, holesUp: 2, thru: 7, margin: "2 UP" }, // in play, A leads
      ],
      [{ side: "a", points: 0.5 }], // envelope-rule half point to A
    );

    // banked: A = 1 (match1) + 0.5 (match2) + 0.5 (adj) = 2 ; B = 0.5 (match2)
    expect(standings.banked).toEqual({ a: 2, b: 0.5 });
    // inPlay: just match 3
    expect(standings.inPlay).toEqual([{ matchId: 3, holesUp: 2, thru: 7, margin: "2 UP" }]);
    // projected: banked + live match 3 counted as A leads (+1 A) = A 3, B 0.5
    expect(standings.projected).toEqual({ a: 3, b: 0.5 });
  });

  it("a live TIE projects 0.5 / 0.5", () => {
    const standings = computeTournamentStandings(
      [{ matchId: 9, result: null, holesUp: 0, thru: 5, margin: "AS" }],
      [],
    );
    expect(standings.banked).toEqual({ a: 0, b: 0 });
    expect(standings.projected).toEqual({ a: 0.5, b: 0.5 });
  });
});

// ── §10 — four-ball counting ball (additive; existing 27 goldens untouched) ──
// The engine exposes WHICH unit's ball produced each side's net so the scorecard
// can mark it (←) instead of re-deciding it. Four-ball only.
describe("four-ball counting ball (§10)", () => {
  it("the handicap stroke changes which ball counts (flip vs gross)", () => {
    // Hole 1 (SI 1). A: P1 CH0 gross4, P2 CH20 gross5. B: P3 CH0 gross6, P4 gross7.
    // minPH 0 → A0 ms0, A1 ms20 (2 strokes on SI 1). A0 net 4, A1 net 5−2=3.
    // By GROSS the counting ball is A0 (4<5); by NET it flips to A1 (3<4).
    const input: MatchInput = {
      format: "four_ball_match",
      holes: holes(),
      sideA: { side: "a", players: [player(1, 0, { 1: 4 }), player(2, 20, { 1: 5 })] },
      sideB: { side: "b", players: [player(3, 0, { 1: 6 }), player(4, 0, { 1: 7 })] },
    };
    const st = computeMatchState(input);
    expect(st.countingUnitA?.[0]).toBe(1); // the stroke made P2's ball count
    expect(st.countingUnitB?.[0]).toBe(0); // B: 6 < 7 → P3
    expect(st.holeOutcomes[0]).toBe("side_a"); // A net 3 < B net 6
  });

  it("a tie between the two balls marks neither (null) but the side is still resolved", () => {
    // A both net 4 (tie) → null counting unit, yet the side value (4) is real and
    // wins the hole (B best 5). null here means 'either ball', NOT 'not entered'.
    const input: MatchInput = {
      format: "four_ball_match",
      holes: holes(),
      sideA: { side: "a", players: [player(1, 0, { 1: 4 }), player(2, 0, { 1: 4 })] },
      sideB: { side: "b", players: [player(3, 0, { 1: 5 }), player(4, 0, { 1: 6 })] },
    };
    const st = computeMatchState(input);
    expect(st.countingUnitA?.[0]).toBeNull();
    expect(st.countingUnitB?.[0]).toBe(0); // B: 5 < 6
    expect(st.holeOutcomes[0]).toBe("side_a");
  });

  it("a lone present ball is the counting ball (pickup: one ball blank still resolves)", () => {
    // A: P1 gross 4, P2 blank on hole 1. The single present ball counts (index 0,
    // non-null) and the one-ball side wins the hole over B's best (5).
    const input: MatchInput = {
      format: "four_ball_match",
      holes: holes(),
      sideA: { side: "a", players: [player(1, 0, { 1: 4 }), player(2, 0, {})] },
      sideB: { side: "b", players: [player(3, 0, { 1: 5 }), player(4, 0, { 1: 5 })] },
    };
    const st = computeMatchState(input);
    expect(st.countingUnitA?.[0]).toBe(0);
    expect(st.holeOutcomes[0]).toBe("side_a");
  });

  it("non-four-ball formats expose no counting unit (undefined)", () => {
    const singles: MatchInput = {
      format: "singles_match",
      holes: holes(),
      sideA: { side: "a", players: [player(1, 0, { 1: 4 })] },
      sideB: { side: "b", players: [player(2, 0, { 1: 5 })] },
    };
    const stS = computeMatchState(singles);
    expect(stS.countingUnitA).toBeUndefined();
    expect(stS.countingUnitB).toBeUndefined();

    const greensomes: MatchInput = {
      format: "greensomes",
      holes: holes(),
      sideA: { side: "a", players: [player(1, 5, {}), player(2, 15, {})], teamGross: gross({ 1: 4 }) },
      sideB: { side: "b", players: [player(3, 10, {}), player(4, 20, {})], teamGross: gross({ 1: 5 }) },
    };
    const stG = computeMatchState(greensomes);
    expect(stG.countingUnitA).toBeUndefined();
    expect(stG.countingUnitB).toBeUndefined();
  });
});

// A tiny guard that `flat()` helper is exercised somewhere (used for all-square
// gross fills in ad-hoc checks) — keeps the import meaningful without a lint nudge.
describe("sanity", () => {
  it("flat() fills all 18 holes", () => {
    expect(Object.keys(flat(4))).toHaveLength(18);
  });
});
