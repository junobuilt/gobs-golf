// Wave 1B C3a + follow-up — the load-bearing season/profile exclusion contract:
// a finalized Shambles round must NOT move a player's per-player scoring stats.
//
// After the Shambles rebuild this is MORE load-bearing, not less: Shambles is now
// an individual best-ball format that genuinely DOES write per-player `scores`
// rows, so the scoreCount>0 guard no longer drops it — the format filter
// (excludedFromIndividualStats, formerly isTeamCardFormat) is the ONLY thing
// keeping it out of season averages.
//
// NEGATIVE CONTROL: the Shambles round here is seeded WITH per-player score rows
// (18×9). The fixture fails if the format filter is removed, proving the filter
// (not the score guard) carries the contract — exactly the leak we're preventing.

import { describe, it, expect, vi } from "vitest";

const rowsRef = vi.hoisted(() => ({ current: [] as any[] }));

vi.mock("@/lib/supabase", () => {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    then: (onF: any) => Promise.resolve({ data: rowsRef.current, error: null }).then(onF),
  };
  return { supabase: { from: () => builder } };
});

import { fetchPlayerStats } from "@/lib/playerStats";

const scores = (strokes: number) => Array.from({ length: 18 }, () => ({ strokes }));

describe("fetchPlayerStats — team-card exclusion", () => {
  it("excludes a Shambles round even when it carries per-player score rows", async () => {
    rowsRef.current = [
      // Individual round: 18×5 = 90.
      {
        round_id: 1,
        course_handicap: 10,
        rounds: { played_on: "2026-05-01", is_complete: true, format: "2_ball" },
        scores: scores(5),
      },
      // Shambles round seeded WITH scores (18×9 = 162) — only the format
      // filter should drop it.
      {
        round_id: 2,
        course_handicap: 10,
        rounds: { played_on: "2026-05-08", is_complete: true, format: "shambles" },
        scores: scores(9),
      },
    ];

    const stats = await fetchPlayerStats(201);

    // Only the individual round counts.
    expect(stats.roundsPlayed).toBe(1);
    expect(stats.avgGross).toBe(90);
    expect(stats.allTotals).toEqual([90]);
    // If the Shambles round leaked in, avgGross would be (90+162)/2 = 126.
    expect(stats.avgGross).not.toBe(126);
  });

  it("a player who only ever played Shambles has empty stats", async () => {
    rowsRef.current = [
      {
        round_id: 2,
        course_handicap: 10,
        rounds: { played_on: "2026-05-08", is_complete: true, format: "shambles" },
        scores: scores(9),
      },
    ];
    const stats = await fetchPlayerStats(201);
    expect(stats.roundsPlayed).toBe(0);
    expect(stats.avgGross).toBeNull();
  });
});
