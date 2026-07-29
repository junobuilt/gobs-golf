// Greensomes team handicap — SSOT cross-surface agreement (GOBS 60/40).
//
// The team handicap is computed ONCE by greensomesTeamHandicap and surfaced as
// LoadedMatch.side.collapsedHandicap. This asserts every surface that shows or
// scores off it reads the SAME value:
//   displayed collapsedHandicap  (scorecard header + pairings card)
//   === greensomesTeamHandicap(chA, chB)   (the formula)
//   === computeSideStrokes(...).aCollapsed (the pairings builder preview)
//   === the basis the engine strokes off    (side match strokes derive from it)

import { describe, it, expect } from "vitest";
import { makeLoaded } from "../../support/matchFixture";
import { greensomesTeamHandicap, computeMatchStrokes } from "@/lib/tournament/matchplay";
import { computeSideStrokes } from "@/lib/tournament/matchStrokes";

describe("greensomes team handicap — one value across every surface", () => {
  // Side A: CH 10 & 20 → 60·10 + 40·20 = 14. Side B: CH 5 & 15 → 9.
  const m = makeLoaded({
    format: "greensomes",
    a: [
      { playerId: 1, ch: 10, scored: {} },
      { playerId: 2, ch: 20, scored: {} },
    ],
    b: [
      { playerId: 3, ch: 5, scored: {} },
      { playerId: 4, ch: 15, scored: {} },
    ],
    teamA: { 1: 4 },
    teamB: { 1: 5 },
  });

  it("displayed collapsedHandicap === the 60/40 formula", () => {
    expect(m.sideA.collapsedHandicap).toBe(greensomesTeamHandicap(10, 20)); // 14
    expect(m.sideB.collapsedHandicap).toBe(greensomesTeamHandicap(5, 15)); // 9
    expect(m.sideA.collapsedHandicap).toBe(14);
    expect(m.sideB.collapsedHandicap).toBe(9);
  });

  it("the pairings builder preview (computeSideStrokes) === the loader's collapsed value", () => {
    const preview = computeSideStrokes("greensomes", [10, 20], [5, 15]);
    expect(preview.aCollapsed).toBe(m.sideA.collapsedHandicap);
    expect(preview.bCollapsed).toBe(m.sideB.collapsedHandicap);
    // …and the side match strokes agree too (same helper the card + engine use).
    expect(preview.aSideStrokes).toBe(m.sideA.sideMatchStrokes);
    expect(preview.bSideStrokes).toBe(m.sideB.sideMatchStrokes);
  });

  it("the engine strokes off the collapsed 60/40 handicaps (net basis === displayed value)", () => {
    // The side match strokes the engine allocated derive from computeMatchStrokes
    // over the two collapsed team handicaps — nothing else. min(14, 9) = 9 → A
    // gets 5, B gets 0.
    const [msA, msB] = computeMatchStrokes([
      m.sideA.collapsedHandicap ?? 0,
      m.sideB.collapsedHandicap ?? 0,
    ]);
    expect(msA).toBe(m.sideA.sideMatchStrokes);
    expect(msB).toBe(m.sideB.sideMatchStrokes);
    expect(msA).toBe(5);
    expect(msB).toBe(0);
  });
});
