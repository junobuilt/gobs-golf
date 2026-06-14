import { describe, it, expect } from "vitest";
import { rankTeams, holesCompleteForTeam, isStablefordFormat, ranksDescending } from "@/lib/leaderboard/rank";

describe("isStablefordFormat", () => {
  it("returns true for the Stableford-family formats", () => {
    expect(isStablefordFormat("stableford_standard")).toBe(true);
    expect(isStablefordFormat("gobs_stableford")).toBe(true);
  });

  it("returns false for best-N formats", () => {
    expect(isStablefordFormat("2_ball")).toBe(false);
    expect(isStablefordFormat("3_ball")).toBe(false);
  });

  it("returns FALSE for par_competition — individuals stay on net strokes", () => {
    // The whole point of keeping ranksDescending separate: par_competition must
    // NOT widen isStablefordFormat (that drives the per-player points axis).
    expect(isStablefordFormat("par_competition")).toBe(false);
  });
});

describe("ranksDescending", () => {
  it("is true for Stableford family AND par_competition", () => {
    expect(ranksDescending("stableford_standard")).toBe(true);
    expect(ranksDescending("gobs_stableford")).toBe(true);
    expect(ranksDescending("par_competition")).toBe(true);
  });

  it("is false for best-N formats", () => {
    expect(ranksDescending("2_ball")).toBe(false);
    expect(ranksDescending("best_ball")).toBe(false);
  });
});

describe("rankTeams", () => {
  it("ranks best-N (2_ball) ascending — lowest total wins", () => {
    const teams = [
      { id: 1, total: 0 },
      { id: 2, total: -3 },
      { id: 3, total: 5 },
    ];
    const ranked = rankTeams(teams, "2_ball");
    expect(ranked.map(t => t.id)).toEqual([2, 1, 3]);
    expect(ranked.map(t => t.rank)).toEqual([1, 2, 3]);
  });

  it("ranks Stableford descending — highest total wins", () => {
    const teams = [
      { id: 1, total: 35 },
      { id: 2, total: 42 },
      { id: 3, total: 21 },
    ];
    const ranked = rankTeams(teams, "stableford_standard");
    expect(ranked.map(t => t.id)).toEqual([2, 1, 3]);
    expect(ranked.map(t => t.rank)).toEqual([1, 2, 3]);
  });

  it("ranks par_competition DESCENDING — highest record wins", () => {
    // Fixture seeded in ASCENDING total order so a no-op (or best-N ascending)
    // sort would leave it unchanged and FAIL — the descending sort must reorder.
    const teams = [
      { id: 1, total: -2 }, // worst record (down 2 on the course)
      { id: 2, total: 0 },
      { id: 3, total: 5 }, // best record (up 5)
    ];
    const ranked = rankTeams(teams, "par_competition");
    expect(ranked.map(t => t.id)).toEqual([3, 2, 1]);
    expect(ranked.map(t => t.rank)).toEqual([1, 2, 3]);
  });

  it("two teams tied for 1st → both rank 1, next team is rank 3 (skip)", () => {
    const teams = [
      { id: 1, total: -2 },
      { id: 2, total: -2 },
      { id: 3, total: 1 },
    ];
    const ranked = rankTeams(teams, "2_ball");
    expect(ranked.map(t => t.rank)).toEqual([1, 1, 3]);
  });

  it("three-way tie at the top → all rank 1, next is rank 4", () => {
    const teams = [
      { id: 1, total: 5 },
      { id: 2, total: 5 },
      { id: 3, total: 5 },
      { id: 4, total: 8 },
    ];
    const ranked = rankTeams(teams, "2_ball");
    expect(ranked.map(t => t.rank)).toEqual([1, 1, 1, 4]);
  });

  it("all teams tied → all share rank 1", () => {
    const teams = [
      { id: 1, total: 0 },
      { id: 2, total: 0 },
      { id: 3, total: 0 },
    ];
    const ranked = rankTeams(teams, "2_ball");
    expect(ranked.map(t => t.rank)).toEqual([1, 1, 1]);
  });

  it("single team → rank 1", () => {
    const teams = [{ id: 1, total: 7 }];
    const ranked = rankTeams(teams, "2_ball");
    expect(ranked.map(t => t.rank)).toEqual([1]);
  });

  it("Stableford with negative totals — most negative is last (GOBS Stableford −1 at DB+)", () => {
    const teams = [
      { id: 1, total: -3 },
      { id: 2, total: 4 },
      { id: 3, total: 0 },
    ];
    const ranked = rankTeams(teams, "gobs_stableford");
    expect(ranked.map(t => t.id)).toEqual([2, 3, 1]);
    expect(ranked.map(t => t.rank)).toEqual([1, 2, 3]);
  });

  it("does not mutate input array", () => {
    const teams = [{ id: 1, total: 5 }, { id: 2, total: 3 }];
    const original = JSON.stringify(teams);
    rankTeams(teams, "2_ball");
    expect(JSON.stringify(teams)).toBe(original);
  });
});

describe("holesCompleteForTeam", () => {
  it("counts only holes where every required player has scored", () => {
    const scores = {
      101: { 1: 4, 2: 5, 3: 4 },
      102: { 1: 5, 2: 5 }, // missing hole 3
      103: { 1: 4, 2: 4, 3: 5 },
    };
    // Holes complete: 1 (all three scored), 2 (all three scored).
    // Hole 3 has 101 + 103 but 102 missing.
    expect(holesCompleteForTeam(scores, [101, 102, 103])).toBe(2);
  });

  it("returns 0 when required players list is empty", () => {
    const scores = { 101: { 1: 4, 2: 5 } };
    expect(holesCompleteForTeam(scores, [])).toBe(0);
  });

  it("treats null and undefined as 'not scored' uniformly", () => {
    const scores = {
      101: { 1: 4, 2: null as number | null, 3: 4 },
      102: { 1: 5 }, // 2, 3 undefined
    };
    // Only hole 1 has both players scored. Hole 2: 101 null + 102 missing.
    // Hole 3: 102 missing.
    expect(holesCompleteForTeam(scores, [101, 102])).toBe(1);
  });
});
