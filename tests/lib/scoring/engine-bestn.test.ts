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
});
