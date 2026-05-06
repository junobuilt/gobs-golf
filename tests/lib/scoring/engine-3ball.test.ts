import { describe, it, expect } from "vitest";
import { computeHoleResult } from "@/lib/scoring/engine";
import type { HoleInput } from "@/lib/scoring/types";

const baseConfig = { basis: "net" as const, best_n: 3, override_holes: [] };

function holeInput(overrides: Partial<HoleInput> & Pick<HoleInput, "players" | "hole">): HoleInput {
  return {
    format: "3_ball",
    formatConfig: baseConfig,
    ...overrides,
  };
}

describe("computeHoleResult — 3-Ball", () => {
  it("standard best-3-of-4 with no strokes drops the worst score", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
        { playerId: "D", grossScore: 7, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(15);
    expect(result.contributingPlayerIds).toEqual(["A", "B", "C"]);
  });

  it("best-3-of-4 with one player getting a stroke (CH=18 → 1 stroke per hole)", () => {
    // A: gross 5, 1 stroke → net 4. B/C/D: 4/6/7 → net 4/6/7. Sorted: A=4, B=4, C=6, D=7.
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 18 },
        { playerId: "B", grossScore: 4, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
        { playerId: "D", grossScore: 7, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(14); // 4 + 4 + 6
    expect(result.contributingPlayerIds).toEqual(["A", "B", "C"]);
  });

  it("best-3-of-3 (small team) — all scores count", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(15);
    expect(result.contributingPlayerIds).toEqual(["A", "B", "C"]);
  });

  it("best-3-of-4 with two-way tie for worst — input-order tie-break drops the later one", () => {
    // Scores 4/5/6/6. Best 3 = 4+5+6. Tie at score 6 between C and D; C (lower idx) contributes.
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
        { playerId: "D", grossScore: 6, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(15);
    expect(result.contributingPlayerIds).toEqual(["A", "B", "C"]);
  });

  it("all four players score the same — first three by input order contribute", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 5, courseHandicap: 0 },
        { playerId: "D", grossScore: 5, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(15);
    expect(result.contributingPlayerIds).toEqual(["A", "B", "C"]);
  });

  it("one player has null score — best-3 picks from the 3 non-null", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: null, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 4, courseHandicap: 0 },
        { playerId: "D", grossScore: 6, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(15); // 4 + 5 + 6
    expect(result.contributingPlayerIds).toEqual(["C", "B", "D"]);
  });

  it("two players null — only 2 non-null, best_n=3 not satisfied, returns null", () => {
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: null, courseHandicap: 0 },
        { playerId: "B", grossScore: null, courseHandicap: 0 },
        { playerId: "C", grossScore: 4, courseHandicap: 0 },
        { playerId: "D", grossScore: 5, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(null);
    expect(result.contributingPlayerIds).toEqual([]);
  });

  it("double-digit handicap edge case (CH=22 on stroke index 1)", () => {
    // A: CH=22 SI=1 → 2 strokes; gross 6 → net 4. B/C/D CH=0 gross 5/6/7 net 5/6/7.
    // Sorted nets: A=4, B=5, C=6, D=7. Best 3 = 4+5+6 = 15.
    const result = computeHoleResult(holeInput({
      hole: { holeNumber: 1, par: 4, strokeIndex: 1 },
      players: [
        { playerId: "A", grossScore: 6, courseHandicap: 22 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
        { playerId: "D", grossScore: 7, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(15);
    expect(result.contributingPlayerIds).toEqual(["A", "B", "C"]);
    const a = result.perPlayer.find(p => p.playerId === "A");
    expect(a?.handicapStrokes).toBe(2);
    expect(a?.netScore).toBe(4);
  });

  it("dispatcher routes 3_ball to best-N helper (sanity)", () => {
    // Same scores, format='3_ball' explicitly. Must produce best-3 result, not best-2.
    const result = computeHoleResult({
      format: "3_ball",
      formatConfig: { basis: "net", best_n: 3, override_holes: [] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
        { playerId: "D", grossScore: 7, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(15);
    expect(result.contributingPlayerIds).toHaveLength(3);
  });
});
