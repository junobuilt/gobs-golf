// F.1 — the shared ranking core. Verifies rank + total string + tie-aware place
// label, the single surface both the History list and RoundResultsView read.

import { describe, it, expect } from "vitest";
import { rankAndFormatTeams, formatPlace } from "@/lib/leaderboard/rankAndFormat";

type T = { id: number; total: number };
const team = (id: number, total: number): T => ({ id, total });

describe("rankAndFormatTeams — best-N", () => {
  // Seeded in the WRONG order so the sort must do real work.
  const ranked = rankAndFormatTeams(
    [team(3, 3), team(1, -4), team(4, 0), team(2, -2)],
    "2_ball",
  );

  it("orders ascending (lowest delta wins) and assigns ranks", () => {
    expect(ranked.map(t => t.id)).toEqual([1, 2, 4, 3]);
    expect(ranked.map(t => t.rank)).toEqual([1, 2, 3, 4]);
  });

  it("formats the total string like the detail headline", () => {
    expect(ranked.map(t => t.totalLabel)).toEqual(["−4", "−2", "E", "+3"]);
  });

  it("labels place as ordinals when there are no ties", () => {
    expect(ranked.map(t => t.placeLabel)).toEqual([
      "1st of 4", "2nd of 4", "3rd of 4", "4th of 4",
    ]);
  });
});

describe("rankAndFormatTeams — tie-aware place", () => {
  it("uses T-notation for shared ranks (T2 of 4), not a naive index", () => {
    const ranked = rankAndFormatTeams(
      [team(1, -4), team(2, -2), team(3, -2), team(4, 0)],
      "2_ball",
    );
    expect(ranked.map(t => t.rank)).toEqual([1, 2, 2, 4]); // skip-tie numbering
    expect(ranked.map(t => t.placeLabel)).toEqual([
      "1st of 4", "T2 of 4", "T2 of 4", "4th of 4",
    ]);
  });
});

describe("rankAndFormatTeams — Stableford", () => {
  it("orders descending (highest points win) and formats as points", () => {
    const ranked = rankAndFormatTeams(
      [team(1, 8), team(2, 12), team(3, -1)],
      "gobs_stableford",
    );
    expect(ranked.map(t => t.id)).toEqual([2, 1, 3]);
    expect(ranked.map(t => t.totalLabel)).toEqual(["12 pts", "8 pts", "−1 pts"]);
    expect(ranked[0].placeLabel).toBe("1st of 3");
  });
});

describe("formatPlace", () => {
  it("handles 11th–13th ordinals", () => {
    expect(formatPlace(11, 20, false)).toBe("11th of 20");
    expect(formatPlace(12, 20, false)).toBe("12th of 20");
    expect(formatPlace(13, 20, false)).toBe("13th of 20");
    expect(formatPlace(21, 30, false)).toBe("21st of 30");
  });
});
