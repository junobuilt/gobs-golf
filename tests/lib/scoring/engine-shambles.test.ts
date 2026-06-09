// Wave 1B follow-up — Shambles is an individual best-ball NET format with a
// RELAXED CLOSE. The engine reuses the best-N machinery: N comes from
// team_ball_count (1 or 2), scoring is NET, and a hole takes the best N net
// balls among the scores PRESENT (count-2 degrades to best-available when a
// player picked up; a hole with no scores yields a null team score).

import { describe, it, expect } from "vitest";
import { computeHoleResult, computeRoundResult } from "@/lib/scoring/engine";
import type { FormatConfig } from "@/lib/scoring/types";

const cfg = (ballCount: number): FormatConfig => ({
  basis: "net",
  scoring_basis: "net",
  team_ball_count: ballCount,
  override_holes: [],
});

describe("Shambles (best-N net, relaxed close)", () => {
  it("count-1 takes the single lowest NET ball", () => {
    const result = computeHoleResult({
      format: "shambles",
      formatConfig: cfg(1),
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 0 },
        { playerId: "B", grossScore: 4, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBe(4);
    expect(result.contributingPlayerIds).toEqual(["B"]);
  });

  it("scores NET — handicap can flip the winning ball", () => {
    // Gross both 4. C has CH=18 → 1 stroke on SI 1 → net 3 beats A's net 4.
    const result = computeHoleResult({
      format: "shambles",
      formatConfig: cfg(1),
      hole: { holeNumber: 1, par: 4, strokeIndex: 1 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "C", grossScore: 4, courseHandicap: 18 },
      ],
    });
    expect(result.teamScore).toBe(3);
    expect(result.contributingPlayerIds).toEqual(["C"]);
  });

  it("count-2 sums the two best NET balls", () => {
    const result = computeHoleResult({
      format: "shambles",
      formatConfig: cfg(2),
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 0 },
        { playerId: "B", grossScore: 4, courseHandicap: 0 },
        { playerId: "C", grossScore: 6, courseHandicap: 0 },
      ],
    });
    // Best two nets: B(4) + A(5) = 9.
    expect(result.teamScore).toBe(9);
    expect(result.contributingPlayerIds).toEqual(["B", "A"]);
  });

  it("count-2 DEGRADES to best-available when only one ball is present", () => {
    const result = computeHoleResult({
      format: "shambles",
      formatConfig: cfg(2),
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 0 },
        { playerId: "B", grossScore: null, courseHandicap: 0 }, // picked up
      ],
    });
    expect(result.teamScore).toBe(5);
    expect(result.contributingPlayerIds).toEqual(["A"]);
  });

  it("a hole with NO present scores yields a null team score", () => {
    const result = computeHoleResult({
      format: "shambles",
      formatConfig: cfg(2),
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: null, courseHandicap: 0 },
        { playerId: "B", grossScore: null, courseHandicap: 0 },
      ],
    });
    expect(result.teamScore).toBeNull();
    expect(result.contributingPlayerIds).toEqual([]);
  });

  it("round-level: count-2 accumulates par per contributing ball and tolerates gaps", () => {
    const result = computeRoundResult({
      format: "shambles",
      formatConfig: cfg(2),
      holes: [
        { holeNumber: 1, par: 4, strokeIndex: 10 },
        { holeNumber: 2, par: 4, strokeIndex: 12 },
      ],
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: { 1: 4, 2: 5 } },
        { playerId: "B", courseHandicap: 0, grossScores: { 1: 6 } }, // picked up on 2
      ],
    });
    // h1: best two nets 4+6=10, 2 contributors → par 4×2=8.
    // h2: only A present → best-available 5, 1 contributor → par 4×1=4.
    expect(result.teamScore).toBe(15);
    expect(result.teamParAtScored).toBe(12); // net delta = 15-12 = +3
    expect(result.holesScored).toBe(2);
    expect(result.blindDrawTotal).toBe(0); // no blind draws for shambles
  });
});
