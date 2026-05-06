import { describe, it, expect } from "vitest";
import { computeHoleResult, computeRoundResult } from "@/lib/scoring/engine";
import type { HoleInput } from "@/lib/scoring/types";

const FOUR_SCORERS = [
  { playerId: "A", grossScore: 4, courseHandicap: 0 },
  { playerId: "B", grossScore: 5, courseHandicap: 0 },
  { playerId: "C", grossScore: 6, courseHandicap: 0 },
  { playerId: "D", grossScore: 7, courseHandicap: 0 },
];

describe("override_holes — best-N formats", () => {
  it("2-Ball with override on this hole sums all 4 scores (not best-2)", () => {
    const result = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [9] },
      hole: { holeNumber: 9, par: 4, strokeIndex: 10 },
      players: FOUR_SCORERS,
    });
    expect(result.teamScore).toBe(22); // 4+5+6+7
    expect(result.contributingPlayerIds).toEqual(["A", "B", "C", "D"]);
  });

  it("3-Ball with override on this hole sums all 4 scores (not best-3)", () => {
    const result = computeHoleResult({
      format: "3_ball",
      formatConfig: { basis: "net", best_n: 3, override_holes: [9] },
      hole: { holeNumber: 9, par: 4, strokeIndex: 10 },
      players: FOUR_SCORERS,
    });
    expect(result.teamScore).toBe(22);
    expect(result.contributingPlayerIds).toEqual(["A", "B", "C", "D"]);
  });

  it("override wins over manualContributors — all 4 contribute, not the manual pick", () => {
    const result = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [9] },
      hole: { holeNumber: 9, par: 4, strokeIndex: 10 },
      players: FOUR_SCORERS,
      manualContributors: ["A", "B"], // would normally pick A+B; override ignores
    });
    expect(result.teamScore).toBe(22);
    expect(result.contributingPlayerIds).toEqual(["A", "B", "C", "D"]);
  });

  it("override with one null score — 3 non-null sum, missing player excluded", () => {
    const result = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [9] },
      hole: { holeNumber: 9, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: null, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
        { playerId: "D", grossScore: 7, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(18);
    expect(result.contributingPlayerIds).toEqual(["B", "C", "D"]);
    const a = result.perPlayer.find(p => p.playerId === "A");
    expect(a?.isContributing).toBe(false);
  });

  it("override with all players null — teamScore is null", () => {
    const result = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [9] },
      hole: { holeNumber: 9, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: null, courseHandicap: 0 },
        { playerId: "B", grossScore: null, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(null);
    expect(result.contributingPlayerIds).toEqual([]);
  });

  it("override with handicap strokes: net values still drive the sum (basis=net)", () => {
    // A: CH=22 SI=1 → 2 strokes; gross 6 → net 4. B/C/D CH=0 → net 5/6/7.
    // Sum of all nets = 4+5+6+7 = 22.
    const result = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [1] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 1 },
      players: [
        { playerId: "A", grossScore: 6, courseHandicap: 22 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
        { playerId: "D", grossScore: 7, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(22);
  });

  it("override does not affect non-override hole on the same round (per-hole gating)", () => {
    // Hole 9 in override list, hole 10 not. Confirm independent treatment.
    const config = { basis: "net" as const, best_n: 2, override_holes: [9] };
    const players = FOUR_SCORERS;
    const hole9 = computeHoleResult({
      format: "2_ball", formatConfig: config,
      hole: { holeNumber: 9, par: 4, strokeIndex: 10 },
      players,
    });
    const hole10 = computeHoleResult({
      format: "2_ball", formatConfig: config,
      hole: { holeNumber: 10, par: 4, strokeIndex: 11 },
      players,
    });
    expect(hole9.teamScore).toBe(22);                   // best-all
    expect(hole9.contributingPlayerIds).toHaveLength(4);
    expect(hole10.teamScore).toBe(9);                   // best-2 = 4+5
    expect(hole10.contributingPlayerIds).toEqual(["A", "B"]);
  });

  it("isContributing flags: all non-null players true on override hole", () => {
    const result = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [9] },
      hole: { holeNumber: 9, par: 4, strokeIndex: 10 },
      players: FOUR_SCORERS,
    });
    for (const playerId of ["A", "B", "C", "D"]) {
      const pp = result.perPlayer.find(p => p.playerId === playerId);
      expect(pp?.isContributing).toBe(true);
    }
  });
});

describe("override_holes — round-level teamParAtScored", () => {
  it("scales par by actual contributor count on override holes", () => {
    // 2 holes, par 4 each, 4 players all scoring.
    // Hole 1 (override): par × 4 = 16
    // Hole 2 (no override): par × 2 = 8
    // Total: 24
    const result = computeRoundResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [1] },
      holes: [
        { holeNumber: 1, par: 4, strokeIndex: 10 },
        { holeNumber: 2, par: 4, strokeIndex: 11 },
      ],
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: { 1: 4, 2: 4 } },
        { playerId: "B", courseHandicap: 0, grossScores: { 1: 5, 2: 5 } },
        { playerId: "C", courseHandicap: 0, grossScores: { 1: 6, 2: 6 } },
        { playerId: "D", courseHandicap: 0, grossScores: { 1: 7, 2: 7 } },
      ],
    });
    expect(result.teamParAtScored).toBe(24);
    // Sanity: round teamScore = (4+5+6+7) + (4+5) = 22 + 9 = 31
    expect(result.teamScore).toBe(31);
  });

  it("Stableford with override is a no-op — same teamScore as without override", () => {
    const baseConfig = { basis: "net" as const, override_holes: [] as number[] };
    const overrideConfig = { ...baseConfig, override_holes: [1, 2] };
    const players = [
      { playerId: "A", courseHandicap: 0, grossScores: { 1: 4, 2: 5 } }, // par=2, bogey=1
      { playerId: "B", courseHandicap: 0, grossScores: { 1: 3, 2: 4 } }, // birdie=3, par=2
    ];
    const holes = [
      { holeNumber: 1, par: 4, strokeIndex: 10 },
      { holeNumber: 2, par: 4, strokeIndex: 11 },
    ];
    const without = computeRoundResult({ format: "stableford_standard", formatConfig: baseConfig, holes, players });
    const withOverride = computeRoundResult({ format: "stableford_standard", formatConfig: overrideConfig, holes, players });
    expect(withOverride.teamScore).toBe(without.teamScore);
    expect(withOverride.teamScore).toBe(8); // (2+3) + (1+2)
  });

  it("GOBS House with override is a no-op — same teamScore as without override", () => {
    const baseConfig = { basis: "net" as const, override_holes: [] as number[] };
    const overrideConfig = { ...baseConfig, override_holes: [1] };
    const players = [
      { playerId: "A", courseHandicap: 0, grossScores: { 1: 6 } }, // double bogey → -1 in GOBS House
      { playerId: "B", courseHandicap: 0, grossScores: { 1: 4 } }, // par → 2
    ];
    const holes = [{ holeNumber: 1, par: 4, strokeIndex: 10 }];
    const without = computeRoundResult({ format: "gobs_house", formatConfig: baseConfig, holes, players });
    const withOverride = computeRoundResult({ format: "gobs_house", formatConfig: overrideConfig, holes, players });
    expect(withOverride.teamScore).toBe(without.teamScore);
    expect(withOverride.teamScore).toBe(1); // -1 + 2
  });
});

describe("override_holes — empty list regression", () => {
  it("empty override_holes leaves best-N behavior unchanged", () => {
    const result = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [] },
      hole: { holeNumber: 9, par: 4, strokeIndex: 10 },
      players: FOUR_SCORERS,
    });
    expect(result.teamScore).toBe(9); // best-2 = 4+5
    expect(result.contributingPlayerIds).toEqual(["A", "B"]);
  });

  it("hole not in override_holes — best-N applies normally", () => {
    const result = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [9, 18] },
      hole: { holeNumber: 5, par: 4, strokeIndex: 10 }, // not in override list
      players: FOUR_SCORERS,
    });
    expect(result.teamScore).toBe(9);
    expect(result.contributingPlayerIds).toEqual(["A", "B"]);
  });
});
