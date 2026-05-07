import { describe, it, expect } from "vitest";
import { computeHoleResult } from "@/lib/scoring/engine";
import type { HoleInput } from "@/lib/scoring/types";

// B3.2: when the admin selects "gross" as the persistent scoring basis, the
// integration trick is to pass courseHandicap=0 for every player at the call
// site. The engine's net pathway then produces gross-equivalent values, which
// matters most for Stableford (where the engine has no internal `basis`
// branch). This test pins down that contract at the engine layer so a future
// refactor that breaks the trick fails loudly.

describe("gross-mode-via-zero-handicaps trick", () => {
  it("Stableford Standard with courseHandicap=0 returns gross-equivalent points", () => {
    // Par 4 hole, stroke index 1. Two players:
    //   A: gross 4 (par), high real handicap → would score 1 stroke → net 3 (birdie, 3 pts)
    //   B: gross 5 (bogey), real handicap 0 → net 5 (bogey, 1 pt)
    // With actual handicaps: team total = 3 + 1 = 4 points.
    // With courseHandicap=0 for both (gross mode): A nets 4 (par, 2 pts), B nets 5 (bogey, 1 pt)
    // → team total = 3 points. This proves the zero-handicap trick collapses
    // net-vs-gross for Stableford to the gross result.
    const grossInput: HoleInput = {
      format: "stableford_standard",
      formatConfig: { basis: "net", override_holes: [] },
      hole: { holeNumber: 1, par: 4, strokeIndex: 1 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
      ],
    };
    const grossResult = computeHoleResult(grossInput);
    expect(grossResult.teamScore).toBe(3); // 2 (par) + 1 (bogey)

    // Sanity check: the same scores with non-zero handicap on A would score
    // higher (birdie via stroke). This confirms the zero-handicap path is
    // genuinely producing gross-equivalent output, not coincidentally equal.
    const netInput: HoleInput = {
      ...grossInput,
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 18 }, // 1 stroke on SI 1
        { playerId: "B", grossScore: 5, courseHandicap: 0 },
      ],
    };
    const netResult = computeHoleResult(netInput);
    expect(netResult.teamScore).toBe(4); // 3 (birdie via stroke) + 1 (bogey)
  });

  it("2-Ball best-2 with courseHandicap=0 collapses net to gross", () => {
    // Three players, par 4, stroke index 1. With handicaps zeroed, net == gross
    // and best 2 of (4, 5, 6) gross = 4 + 5 = 9. Same value should appear under
    // both basis: "gross" (engine reads gross) and basis: "net" (handicaps = 0).
    const players = [
      { playerId: "A", grossScore: 4, courseHandicap: 0 },
      { playerId: "B", grossScore: 5, courseHandicap: 0 },
      { playerId: "C", grossScore: 6, courseHandicap: 0 },
    ];
    const baseHole = { holeNumber: 1, par: 4, strokeIndex: 1 };

    const asNet = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "net", best_n: 2, override_holes: [] },
      hole: baseHole,
      players,
    });
    const asGross = computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: "gross", best_n: 2, override_holes: [] },
      hole: baseHole,
      players,
    });
    expect(asNet.teamScore).toBe(9);
    expect(asGross.teamScore).toBe(9);
  });
});
