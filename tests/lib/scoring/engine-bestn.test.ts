import { describe, it, expect } from "vitest";
import { computeHoleResult } from "@/lib/scoring/engine";

describe("Best-N format defaults", () => {
  it("3_ball with missing best_n defaults to 3 (not 2)", () => {
    // formatConfig omits best_n. Engine must derive 3 from format='3_ball',
    // not fall back to a hardcoded 2.
    const result = computeHoleResult({
      format: "3_ball",
      formatConfig: { basis: "net", override_holes: [] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
        { playerId: "D", grossScore: 7, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(15); // 3 best = 4+5+6, would be 9 if defaulted to 2
    expect(result.contributingPlayerIds).toHaveLength(3);
  });

  it("2_ball with missing best_n defaults to 2", () => {
    const result = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "net", override_holes: [] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(9); // 2 best = 4+5
    expect(result.contributingPlayerIds).toHaveLength(2);
  });

  it("best_ball with missing best_n defaults to 1", () => {
    const result = computeHoleResult({
      format: "best_ball",
      formatConfig: { basis: "net", override_holes: [] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 0 },
        { playerId: "B", grossScore: 4, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(4); // best 1 = 4
    expect(result.contributingPlayerIds).toEqual(["B"]);
  });
});

// A9: with the live scorecard's manual ball-override removed, no production
// caller passes manualContributors. Ties must therefore resolve silently and
// deterministically to the best-N set by input (roster) order — never to a
// non-best ball.
describe("Best-N tie resolution — deterministic, no manual override", () => {
  it("three-way exact tie picks the first N by input order (2_ball)", () => {
    const result = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 1 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 4, courseHandicap: 0 },
        { playerId: "C", grossScore: 4, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(8); // 4 + 4
    expect(result.contributingPlayerIds).toEqual(["A", "B"]);
    expect(result.perPlayer.find(p => p.playerId === "C")?.isContributing).toBe(false);
  });

  it("tie for the last counting spot resolves to the lower input index", () => {
    // B and C both net 5; the second BALL must go to B (earlier in input),
    // and the higher-scoring D must never be counted.
    const result = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 5, courseHandicap: 0 },
        { playerId: "D", grossScore: 6, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(9); // 4 + 5
    expect(result.contributingPlayerIds).toEqual(["A", "B"]);
    expect(result.perPlayer.find(p => p.playerId === "D")?.isContributing).toBe(false);
  });

  it("3_ball three-way tie for the last spot still excludes the worst ball", () => {
    // A=4 always counts; B/C/D all net 5 → best-3 = A,B,C; E (net 6) excluded.
    const result = computeHoleResult({
      format: "3_ball",
      formatConfig: { basis: "net", best_n: 3, override_holes: [] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 5, courseHandicap: 0 },
        { playerId: "D", grossScore: 5, courseHandicap: 0 },
        { playerId: "E", grossScore: 6, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(14); // 4 + 5 + 5
    expect(result.contributingPlayerIds).toEqual(["A", "B", "C"]);
    expect(result.perPlayer.find(p => p.playerId === "E")?.isContributing).toBe(false);
  });
});
