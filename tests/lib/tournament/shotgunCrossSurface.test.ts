// Cross-surface agreement for shotgun (migration 039). A match's order-agnostic
// "thru N" + margin must READ THE SAME on the scorecard header and the dashboard
// row — both derive from ONE MatchState (no surface recompute). Also asserts the
// SSOT: the scorecard's live recompute reproduces the loader's state byte-for-
// byte for a rotated start (same play order in both).

import { describe, it, expect } from "vitest";
import { makeLoaded } from "../../support/matchFixture";
import {
  thruDisplay,
  marginWithSide,
  finishBanner,
  recomputeState,
  initOptimisticScores,
} from "@/lib/tournament/matchScorecard";
import { matchStatusLine } from "@/lib/tournament/dashboardFormat";

describe("shotgun cross-surface agreement (039)", () => {
  it("in-progress start-7 match: scorecard header 'thru N' === dashboard row", () => {
    // Play order from hole 7. A wins hole 7, halves hole 8 → 1 UP, thru 2.
    const m = makeLoaded({
      format: "singles_match",
      startHole: 7,
      a: [{ playerId: 1, ch: 0, scored: { 7: 3, 8: 4 } }],
      b: [{ playerId: 2, ch: 0, scored: { 7: 4, 8: 4 } }],
    });

    expect(m.state.thru).toBe(2);
    expect(m.state.holesUp).toBe(1);
    expect(thruDisplay(m.state)).toBe(2);

    // The scorecard header builds "{margin} · thru {thruDisplay}" (page.tsx).
    const scorecardHeader = `${marginWithSide(m.state, m)} · thru ${thruDisplay(m.state)} holes`;
    // The dashboard builds the SAME line from the same state.
    const dashboard = matchStatusLine(m).text;

    expect(scorecardHeader).toBe("USA 1 UP · thru 2 holes");
    expect(dashboard).toBe(scorecardHeader); // agreement, not just "each renders"
  });

  it("decided start-7 match: both surfaces read the same 5&4", () => {
    // Play order 7,8,…,18,1,2,(3,4,5,6). A wins 7-11, rest halved → 5&4, clinched
    // on the 14th played hole (hole 2).
    const m = makeLoaded({
      format: "singles_match",
      startHole: 7,
      a: [
        {
          playerId: 1,
          ch: 0,
          scored: { 7: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 4, 13: 4, 14: 4, 15: 4, 16: 4, 17: 4, 18: 4, 1: 4, 2: 4 },
        },
      ],
      b: [
        {
          playerId: 2,
          ch: 0,
          scored: { 7: 4, 8: 4, 9: 4, 10: 4, 11: 4, 12: 4, 13: 4, 14: 4, 15: 4, 16: 4, 17: 4, 18: 4, 1: 4, 2: 4 },
        },
      ],
    });

    expect(m.state.result).toBe("side_a");
    expect(m.state.margin).toBe("5&4");
    expect(m.state.closedOutHole).toBe(2); // the clinch hole number in the rotation

    // Dashboard: "USA wins 5&4"; scorecard finish banner: won / "5&4".
    expect(matchStatusLine(m).text).toBe("USA wins 5&4");
    const banner = finishBanner(m.state, m);
    expect(banner).toEqual({ kind: "won", sideName: "USA", marginText: "5&4" });
  });

  it("SSOT: the live recompute reproduces the loader's state for a rotated start", () => {
    const m = makeLoaded({
      format: "singles_match",
      startHole: 12,
      a: [{ playerId: 1, ch: 0, scored: { 12: 3, 13: 4, 14: 3 } }],
      b: [{ playerId: 2, ch: 0, scored: { 12: 4, 13: 4, 14: 4 } }],
    });
    // recomputeState walks buildMatchInput → startHole from loaded.match.start_hole.
    expect(recomputeState(m, initOptimisticScores(m))).toEqual(m.state);
  });
});
