import { describe, it, expect } from "vitest";
import { computeHoleResult } from "@/lib/scoring/engine";
import type { HoleInput } from "@/lib/scoring/types";

const baseConfig = { basis: "net" as const, best_n: 2, override_holes: [] };

function holeInput(overrides: Partial<HoleInput> & Pick<HoleInput, "players" | "hole">): HoleInput {
  return {
    format: "2_ball",
    formatConfig: baseConfig,
    ...overrides,
  };
}

describe("computeHoleResult — 2-Ball", () => {
  it("standard best-2-of-4, no strokes", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
        { playerId: "D", grossScore: 7, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(9);
    expect(result.contributingPlayerIds).toEqual(["A", "B"]);
  });

  it("best-2-of-4 with one player getting a stroke on this hole (CH=18)", () => {
    // Player A: CH=18 → 1 stroke per hole; gross 5 → net 4
    // Players B/C/D: CH=0; gross 4/6/7 → net 4/6/7
    // Best 2 net: A(4) + B(4) = 8; A wins tie because input order
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 18 },
        { playerId: "B", grossScore: 4, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
        { playerId: "D", grossScore: 7, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(8);
    expect(result.contributingPlayerIds).toEqual(["A", "B"]);
    const a = result.perPlayer.find(p => p.playerId === "A");
    expect(a?.netScore).toBe(4);
    expect(a?.handicapStrokes).toBe(1);
  });

  it("best-2-of-4 with multiple strokes per player (CH=22 on stroke index 1)", () => {
    // Player A: CH=22 on SI=1 → 2 strokes; gross 6 → net 4
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 1 },
      players: [
        { playerId: "A", grossScore: 6, courseHandicap: 22 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 7, courseHandicap: 0 },
        { playerId: "D", grossScore: 8, courseHandicap: 0 },
      ],
    }));
    const a = result.perPlayer.find(p => p.playerId === "A");
    expect(a?.handicapStrokes).toBe(2);
    expect(a?.netScore).toBe(4);
    expect(result.teamScore).toBe(9); // A(4) + B(5)
    expect(result.contributingPlayerIds).toEqual(["A", "B"]);
  });

  it("best-2-of-3 (small team)", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 0 },
        { playerId: "B", grossScore: 4, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(9); // B(4) + A(5)
    expect(result.contributingPlayerIds).toEqual(["B", "A"]);
  });

  it("all four players score the same — first two by input order contribute", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 5, courseHandicap: 0 },
        { playerId: "D", grossScore: 5, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(10);
    expect(result.contributingPlayerIds).toEqual(["A", "B"]);
  });

  it("one player has null gross — engine picks best 2 of remaining 3", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: null, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 4, courseHandicap: 0 },
        { playerId: "D", grossScore: 6, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(9); // C(4) + B(5)
    expect(result.contributingPlayerIds).toEqual(["C", "B"]);
    const a = result.perPlayer.find(p => p.playerId === "A");
    expect(a?.netScore).toBe(null);
  });

  it("all players have null scores", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: null, courseHandicap: 0 },
        { playerId: "B", grossScore: null, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(null);
    expect(result.contributingPlayerIds).toEqual([]);
  });

  it("score equals par — no special-casing", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 4, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(8);
    const a = result.perPlayer.find(p => p.playerId === "A");
    expect(a?.netScore).toBe(4);
  });

  it("manual override picks the chosen contributors", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
        { playerId: "D", grossScore: 7, courseHandicap: 0 },
      ],
      manualContributors: ["C", "D"],
    }));
    expect(result.teamScore).toBe(13);
    expect(result.contributingPlayerIds).toEqual(["C", "D"]);
  });

  it("manual override with one null contributor returns null team score", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: null, courseHandicap: 0 },
      ],
      manualContributors: ["A", "B"],
    }));
    expect(result.teamScore).toBe(null);
    expect(result.contributingPlayerIds).toEqual([]);
  });

  it("gross-basis config sums gross scores instead of net", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 1 },
      formatConfig: { basis: "gross", best_n: 2, override_holes: [] },
      players: [
        { playerId: "A", grossScore: 6, courseHandicap: 22 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 7, courseHandicap: 0 },
        { playerId: "D", grossScore: 8, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(11); // B(5) + A(6) on gross basis
    expect(result.contributingPlayerIds).toEqual(["B", "A"]);
  });
});
