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
// Flights (Session 1): format moved off rounds.format onto the round's primary
// flight. fetchPlayerStats now resolves format via getPrimaryFlightByRound, so
// the mock must serve a `flights` table keyed by round_id.
const flightsRef = vi.hoisted(() => ({ current: [] as any[] }));

vi.mock("@/lib/supabase", () => {
  function makeBuilder(table: string): any {
    const b: any = {
      select: () => b,
      eq: () => b,
      gte: () => b,
      lte: () => b,
      in: () => b,
      order: () => b,
      then: (onF: any) => {
        const data = table === "flights" ? flightsRef.current : rowsRef.current;
        return Promise.resolve({ data, error: null }).then(onF);
      },
    };
    return b;
  }
  return { supabase: { from: (t: string) => makeBuilder(t) } };
});

import { fetchPlayerStats } from "@/lib/playerStats";

// One primary flight per round, carrying the format the round used to hold.
const flight = (round_id: number, format: string) => ({
  id: 9000 + round_id, round_id, name: "Flight A", sort_order: 1,
  format, format_config: { basis: "net" }, format_locked_at: null,
});

const scores = (strokes: number) => Array.from({ length: 18 }, () => ({ strokes }));

describe("fetchPlayerStats — team-card exclusion", () => {
  it("excludes a Shambles round even when it carries per-player score rows", async () => {
    flightsRef.current = [flight(1, "2_ball"), flight(2, "shambles")];
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
    flightsRef.current = [flight(2, "shambles")];
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
