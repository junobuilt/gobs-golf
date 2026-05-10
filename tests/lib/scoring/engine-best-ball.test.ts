import { describe, it, expect } from "vitest";
import { computeHoleResult, computeRoundResult } from "@/lib/scoring/engine";

describe("Best Ball (best-1 net)", () => {
  it("picks the lowest net score among 4 players", () => {
    const result = computeHoleResult({
      format: "best_ball",
      formatConfig: { basis: "net", override_holes: [] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 0 },
        { playerId: "B", grossScore: 4, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
        { playerId: "D", grossScore: 7, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(4);
    expect(result.contributingPlayerIds).toEqual(["B"]);
  });

  it("uses net scoring — handicap can flip the winner", () => {
    // Gross both = 4. C has CH=18 → 1 stroke on SI 1 → net 3.
    const result = computeHoleResult({
      format: "best_ball",
      formatConfig: { basis: "net", override_holes: [] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 1 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "C", grossScore: 4, courseHandicap: 18 },
      ],
    });
    expect(result.teamScore).toBe(3);
    expect(result.contributingPlayerIds).toEqual(["C"]);
  });

  it("ties go to first-in-input-order (engine contract)", () => {
    const result = computeHoleResult({
      format: "best_ball",
      formatConfig: { basis: "net", override_holes: [] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 4, courseHandicap: 0 },
        { playerId: "C", grossScore: 5, courseHandicap: 0 },
      ],
    });
    expect(result.contributingPlayerIds).toEqual(["A"]);
  });

  it("override_holes turns the hole into best-all (all non-null contribute)", () => {
    const result = computeHoleResult({
      format: "best_ball",
      formatConfig: { basis: "net", override_holes: [9] },
      hole: { holeNumber: 9, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(15); // 4+5+6
    expect(result.contributingPlayerIds).toEqual(["A", "B", "C"]);
  });

  it("round-level teamParAtScored is par × 1 contributor per hole", () => {
    const result = computeRoundResult({
      format: "best_ball",
      formatConfig: { basis: "net", override_holes: [] },
      holes: [
        { holeNumber: 1, par: 4, strokeIndex: 10 },
        { holeNumber: 2, par: 4, strokeIndex: 5 },
      ],
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: { 1: 4, 2: 5 } },
        { playerId: "B", courseHandicap: 0, grossScores: { 1: 5, 2: 4 } },
      ],
    });
    // Best each hole: 4, 4 → 8 strokes; teamParAtScored = par × 1 × 2 = 8.
    expect(result.teamScore).toBe(8);
    expect(result.teamParAtScored).toBe(8);
  });

  it("all players null on a hole → teamScore null on that hole", () => {
    const result = computeHoleResult({
      format: "best_ball",
      formatConfig: { basis: "net", override_holes: [] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: null, courseHandicap: 0 },
        { playerId: "B", grossScore: null, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(null);
    expect(result.contributingPlayerIds).toEqual([]);
  });
});
