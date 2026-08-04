// Change 2 — the ONE completion-detection source. Matches are built through the
// REAL engine (makeLoaded → computeMatchState), so `isMatchComplete` is asserted
// over genuine resolved results, not hand-set fields. The final block is the SSOT
// guard: the cup's `decided` count and the day-status helper read the SAME
// predicate, so "day complete" and "cup banked N" can never disagree.

import { describe, it, expect } from "vitest";
import { isMatchComplete, isDayComplete, dayTag } from "@/lib/tournament/completion";
import { deriveCupBar, type CupBar } from "@/lib/tournament/cup";
import type { DashboardData } from "@/lib/tournament/loadDashboard";
import { makeLoaded } from "../../support/matchFixture";
import type { LoadedMatch, Tournament } from "@/lib/tournament/types";

function singles(id: number, aScored: Record<number, number>, bScored: Record<number, number>): LoadedMatch {
  return makeLoaded({ id, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: aScored }], b: [{ playerId: 2, ch: 0, scored: bScored }] });
}
const flat = (g: number) => Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, g]));

// A wins every hole → engine walk-off → resolved.result set → COMPLETE.
const done1 = singles(1, flat(4), flat(5));
const done2 = singles(2, flat(4), flat(5));
// Only hole 1 scored → no result → still in play.
const live = singles(3, { 1: 4 }, { 1: 5 });

describe("isMatchComplete / isDayComplete", () => {
  it("a decided match is complete; an in-play match is not", () => {
    expect(isMatchComplete(done1)).toBe(true);
    expect(isMatchComplete(live)).toBe(false);
  });

  it("a day is complete only when it has matches AND every one is complete", () => {
    expect(isDayComplete([])).toBe(false); // no pairings yet ≠ done
    expect(isDayComplete([live])).toBe(false);
    expect(isDayComplete([done1, live])).toBe(false);
    expect(isDayComplete([done1])).toBe(true);
    expect(isDayComplete([done1, done2])).toBe(true);
  });
});

describe("dayTag — precedence COMPLETE > LIVE > UPCOMING", () => {
  it("all complete → COMPLETE regardless of the date (fixes UPCOMING-while-scored)", () => {
    expect(dayTag([done1, done2], true)).toBe("COMPLETE"); // beats LIVE
    expect(dayTag([done1, done2], false)).toBe("COMPLETE"); // beats UPCOMING
  });

  it("not complete → today is LIVE, any other day is UPCOMING", () => {
    expect(dayTag([done1, live], true)).toBe("LIVE");
    expect(dayTag([done1, live], false)).toBe("UPCOMING");
  });

  it("an unpaired day (no matches) is LIVE today / UPCOMING otherwise, never COMPLETE", () => {
    expect(dayTag([], true)).toBe("LIVE");
    expect(dayTag([], false)).toBe("UPCOMING");
  });
});

describe("SSOT: the cup and the day tag read the same completion predicate", () => {
  const tournament = { side_a_name: "USA", side_b_name: "Canada", holder_side: "b" } as Tournament;
  const barFor = (matches: LoadedMatch[]): CupBar => {
    const data: DashboardData = {
      // deriveCupBar only reads data.days[*].matches + data.standings.banked.
      days: [{ session: {} as never, matches, error: false }],
      standings: { banked: { a: 0, b: 0 }, projected: { a: 0, b: 0 }, inPlay: [] },
      adjustments: [],
    };
    return deriveCupBar(data, tournament);
  };

  it("cup `decided` === matches counted complete by isMatchComplete", () => {
    const matches = [done1, done2, live];
    const bar = barFor(matches);
    expect(bar.total).toBe(3);
    expect(bar.decided).toBe(matches.filter(isMatchComplete).length); // 2, one predicate
  });

  it("when isDayComplete is true, the cup banks every match (decided === total)", () => {
    const matches = [done1, done2];
    expect(isDayComplete(matches)).toBe(true);
    const bar = barFor(matches);
    expect(bar.decided).toBe(bar.total);
  });
});
