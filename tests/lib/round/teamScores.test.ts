import { describe, it, expect } from "vitest";
import {
  buildTeamScoreMap,
  getTeamHoleTotal,
  getTeamHoleBalls,
  holesScoredForTeam,
  getTeamTotal,
  type TeamScoreRow,
} from "@/lib/round/teamScores";

// Fixtures are deliberately seeded OUT OF ORDER and across multiple teams/balls
// so the aggregation must do real work for the assertions to hold (CLAUDE.md
// engineering principle #3 — no accidentally-passing fixtures). The IO loader
// (loadTeamScores) is intentionally NOT unit-tested against a mocked Supabase
// client (principle #2); only the pure aggregation is covered here.

describe("buildTeamScoreMap + readers (Wave 1B)", () => {
  it("count-1: one ball per hole, hole total = that ball", () => {
    const rows: TeamScoreRow[] = [
      // out of hole order on purpose
      { team_number: 1, hole_number: 3, ball_index: 1, strokes: 5 },
      { team_number: 1, hole_number: 1, ball_index: 1, strokes: 4 },
      { team_number: 1, hole_number: 2, ball_index: 1, strokes: 6 },
    ];
    const map = buildTeamScoreMap(rows);
    expect(getTeamHoleTotal(map, 1, 1)).toBe(4);
    expect(getTeamHoleTotal(map, 1, 2)).toBe(6);
    expect(getTeamHoleTotal(map, 1, 3)).toBe(5);
    expect(getTeamHoleBalls(map, 1, 1)).toEqual([4]);
  });

  it("count-2: hole total = sum of the two balls", () => {
    const rows: TeamScoreRow[] = [
      // ball_index 2 listed before ball_index 1 to prove ordering/summing work
      { team_number: 1, hole_number: 1, ball_index: 2, strokes: 5 },
      { team_number: 1, hole_number: 1, ball_index: 1, strokes: 4 },
    ];
    const map = buildTeamScoreMap(rows);
    expect(getTeamHoleTotal(map, 1, 1)).toBe(9); // 4 + 5
    expect(getTeamHoleBalls(map, 1, 1)).toEqual([4, 5]); // ordered by ball_index
  });

  it("keeps teams separate (no cross-team bleed)", () => {
    const rows: TeamScoreRow[] = [
      { team_number: 2, hole_number: 1, ball_index: 1, strokes: 7 },
      { team_number: 1, hole_number: 1, ball_index: 1, strokes: 4 },
    ];
    const map = buildTeamScoreMap(rows);
    expect(getTeamHoleTotal(map, 1, 1)).toBe(4);
    expect(getTeamHoleTotal(map, 2, 1)).toBe(7);
  });

  it("getTeamHoleTotal returns null for an unscored hole", () => {
    const map = buildTeamScoreMap([
      { team_number: 1, hole_number: 1, ball_index: 1, strokes: 4 },
    ]);
    expect(getTeamHoleTotal(map, 1, 2)).toBeNull();
    expect(getTeamHoleTotal(map, 9, 1)).toBeNull(); // unknown team
    expect(getTeamHoleBalls(map, 1, 2)).toEqual([]);
  });

  it("holesScoredForTeam counts holes with any score (thru N)", () => {
    const rows: TeamScoreRow[] = [
      { team_number: 1, hole_number: 1, ball_index: 1, strokes: 4 },
      { team_number: 1, hole_number: 1, ball_index: 2, strokes: 5 }, // same hole, 2nd ball
      { team_number: 1, hole_number: 2, ball_index: 1, strokes: 6 },
      { team_number: 1, hole_number: 5, ball_index: 1, strokes: 3 },
    ];
    const map = buildTeamScoreMap(rows);
    // 3 distinct holes scored (1, 2, 5) — the second ball on hole 1 must NOT
    // inflate the count.
    expect(holesScoredForTeam(map, 1)).toBe(3);
    expect(holesScoredForTeam(map, 2)).toBe(0);
  });

  it("getTeamTotal sums every scored hole's total", () => {
    const rows: TeamScoreRow[] = [
      { team_number: 1, hole_number: 1, ball_index: 1, strokes: 4 },
      { team_number: 1, hole_number: 1, ball_index: 2, strokes: 5 }, // hole 1 total = 9
      { team_number: 1, hole_number: 2, ball_index: 1, strokes: 6 }, // hole 2 total = 6
    ];
    const map = buildTeamScoreMap(rows);
    expect(getTeamTotal(map, 1)).toBe(15); // 9 + 6
    expect(getTeamTotal(map, 2)).toBe(0);
  });

  it("a duplicate ball_index row overwrites rather than double-counts", () => {
    const rows: TeamScoreRow[] = [
      { team_number: 1, hole_number: 1, ball_index: 1, strokes: 4 },
      { team_number: 1, hole_number: 1, ball_index: 1, strokes: 7 }, // later wins
    ];
    const map = buildTeamScoreMap(rows);
    expect(getTeamHoleTotal(map, 1, 1)).toBe(7);
    expect(getTeamHoleBalls(map, 1, 1)).toEqual([7]);
  });

  it("empty input yields empty aggregates", () => {
    const map = buildTeamScoreMap([]);
    expect(holesScoredForTeam(map, 1)).toBe(0);
    expect(getTeamTotal(map, 1)).toBe(0);
    expect(getTeamHoleTotal(map, 1, 1)).toBeNull();
  });
});
