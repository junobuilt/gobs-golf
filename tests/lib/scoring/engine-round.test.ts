import { describe, it, expect } from "vitest";
import { computeRoundResult, computePlayerRoundTotal } from "@/lib/scoring/engine";
import type { RoundInput, HoleInfo } from "@/lib/scoring/types";

const holes18: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({
  holeNumber: i + 1,
  par: i % 3 === 0 ? 5 : i % 5 === 0 ? 3 : 4,
  strokeIndex: i + 1,
}));

const baseConfig = { basis: "net" as const, best_n: 2, override_holes: [] };

describe("computeRoundResult — 2-Ball aggregation", () => {
  it("sums per-hole team scores into round total", () => {
    const input: RoundInput = {
      format: "2_ball",
      formatConfig: baseConfig,
      holes: holes18,
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: Object.fromEntries(holes18.map(h => [h.holeNumber, h.par])) },
        { playerId: "B", courseHandicap: 0, grossScores: Object.fromEntries(holes18.map(h => [h.holeNumber, h.par + 1])) },
      ],
    };
    const result = computeRoundResult(input);

    const expectedTeamScore = holes18.reduce((sum, h) => sum + h.par + (h.par + 1), 0);
    expect(result.teamScore).toBe(expectedTeamScore);
    expect(result.holesScored).toBe(18);
    expect(result.teamParAtScored).toBe(holes18.reduce((sum, h) => sum + h.par * 2, 0));
  });

  it("skips holes that don't produce a team score", () => {
    const grossA: Record<number, number | null> = {};
    const grossB: Record<number, number | null> = {};
    for (const h of holes18) {
      if (h.holeNumber <= 9) {
        grossA[h.holeNumber] = h.par;
        grossB[h.holeNumber] = h.par + 1;
      }
    }
    const input: RoundInput = {
      format: "2_ball",
      formatConfig: baseConfig,
      holes: holes18,
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: grossA },
        { playerId: "B", courseHandicap: 0, grossScores: grossB },
      ],
    };
    const result = computeRoundResult(input);
    expect(result.holesScored).toBe(9);
    const expected = holes18.slice(0, 9).reduce((sum, h) => sum + h.par + (h.par + 1), 0);
    expect(result.teamScore).toBe(expected);
  });

  it("returns null teamScore when no holes have team scores", () => {
    const input: RoundInput = {
      format: "2_ball",
      formatConfig: baseConfig,
      holes: holes18,
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: {} },
        { playerId: "B", courseHandicap: 0, grossScores: {} },
      ],
    };
    const result = computeRoundResult(input);
    expect(result.teamScore).toBe(null);
    expect(result.holesScored).toBe(0);
  });

  it("perPlayer totals match individual aggregation helper", () => {
    const grossA = Object.fromEntries(holes18.slice(0, 10).map(h => [h.holeNumber, h.par]));
    const input: RoundInput = {
      format: "2_ball",
      formatConfig: baseConfig,
      holes: holes18,
      players: [
        { playerId: "A", courseHandicap: 10, grossScores: grossA },
        { playerId: "B", courseHandicap: 0, grossScores: grossA },
      ],
    };
    const result = computeRoundResult(input);
    const aTotal = computePlayerRoundTotal(grossA, 10, holes18);
    const playerA = result.perPlayer.find(p => p.playerId === "A");
    expect(playerA?.grossTotal).toBe(aTotal.gross);
    expect(playerA?.netTotal).toBe(aTotal.net);
    expect(playerA?.holesPlayed).toBe(aTotal.holesPlayed);
  });
});

describe("computePlayerRoundTotal", () => {
  it("sums gross and applies handicap strokes hole-by-hole for net", () => {
    const grossScores: Record<number, number | null> = {};
    for (const h of holes18) grossScores[h.holeNumber] = h.par;
    const total = computePlayerRoundTotal(grossScores, 18, holes18);
    const grossSum = holes18.reduce((s, h) => s + h.par, 0);
    expect(total.gross).toBe(grossSum);
    expect(total.net).toBe(grossSum - 18); // CH=18 → 1 stroke per hole
    expect(total.holesPlayed).toBe(18);
  });

  it("ignores null/missing scores", () => {
    const grossScores = { 1: 4, 2: 5 };
    const total = computePlayerRoundTotal(grossScores, 0, holes18);
    expect(total.gross).toBe(9);
    expect(total.holesPlayed).toBe(2);
  });
});
