// The one status formatter → approved vocabulary. Each state is built through
// the REAL engine (makeLoaded → computeMatchState), so these assert the DISPLAY
// mapping over genuine match states, not hand-set fields.

import { describe, it, expect } from "vitest";
import { matchStatus, matchSidePoints, spaceMargin } from "@/lib/tournament/matchStatus";
import { makeLoaded } from "../../support/matchFixture";
import type { LoadedMatch } from "@/lib/tournament/types";

// singles helper: USA gross map vs Canada gross map.
function m(id: number, aScored: Record<number, number>, bScored: Record<number, number>): LoadedMatch {
  return makeLoaded({ id, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: aScored }], b: [{ playerId: 2, ch: 0, scored: bScored }] });
}
const flat = (g: number, upto = 18) => Object.fromEntries(Array.from({ length: upto }, (_, i) => [i + 1, g]));

describe("spaceMargin", () => {
  it("spaces the ampersand form only", () => {
    expect(spaceMargin("3&2")).toBe("3 & 2");
    expect(spaceMargin("2 UP")).toBe("2 UP");
  });
});

describe("matchStatus vocabulary", () => {
  it("Not started (thru 0)", () => {
    const s = matchStatus(m(1, {}, {}));
    expect(s.text).toBe("Not started");
    expect(s.tone).toBe("pre");
    expect(s.decided).toBe(false);
    expect(s.thruText).toBe("Not started");
  });

  it("All Square (live tie) — supersedes 'Tied'", () => {
    // Holes 1..5 all halved.
    const s = matchStatus(m(2, flat(4, 5), flat(4, 5)));
    expect(s.text).toBe("All Square");
    expect(s.tone).toBe("square");
    expect(s.thruText).toBe("thru 5");
  });

  it("N UP (live, USA leading)", () => {
    // Holes 1,2 → USA (3 v 5); hole 3 halved (4 v 4).
    const s = matchStatus(m(3, { 1: 3, 2: 3, 3: 4 }, { 1: 5, 2: 5, 3: 4 }));
    expect(s.text).toBe("2 UP");
    expect(s.tone).toBe("usa");
    expect(s.leaderSide).toBe("a");
    expect(s.thruText).toBe("thru 3");
  });

  it("Dormie (lead === holes remaining, still live)", () => {
    // USA wins holes 1,2; holes 3..16 halved → up 2 thru 16, 2 remaining.
    const aScored: Record<number, number> = { 1: 3, 2: 3 };
    const bScored: Record<number, number> = { 1: 5, 2: 5 };
    for (let h = 3; h <= 16; h++) { aScored[h] = 4; bScored[h] = 4; }
    const s = matchStatus(m(4, aScored, bScored));
    expect(s.text).toBe("Dormie");
    expect(s.tone).toBe("usa");
    expect(s.decided).toBe(false);
  });

  it("decided early closeout → spaced margin '3 & 2' + winner sentence", () => {
    // USA wins 1,2,3; holes 4..16 halved → up 3 with 2 left → closes at 16 (3&2).
    const aScored: Record<number, number> = { 1: 3, 2: 3, 3: 3 };
    const bScored: Record<number, number> = { 1: 5, 2: 5, 3: 5 };
    for (let h = 4; h <= 16; h++) { aScored[h] = 4; bScored[h] = 4; }
    const s = matchStatus(m(5, aScored, bScored));
    expect(s.text).toBe("3 & 2");
    expect(s.tone).toBe("usa");
    expect(s.decided).toBe(true);
    expect(s.thruText).toBe("Final");
    expect(s.winnerSentence).toBe("USA wins 3 & 2");
  });

  it("decided on 18 → '1 UP' + winner sentence", () => {
    // USA wins hole 1; holes 2..18 halved → 1 up through 18 (complete).
    const aScored: Record<number, number> = { 1: 3 };
    const bScored: Record<number, number> = { 1: 5 };
    for (let h = 2; h <= 18; h++) { aScored[h] = 4; bScored[h] = 4; }
    const s = matchStatus(m(6, aScored, bScored));
    expect(s.text).toBe("1 UP");
    expect(s.decided).toBe(true);
    expect(s.thruText).toBe("Final");
    expect(s.winnerSentence).toBe("USA wins 1 UP");
  });

  it("Halved (decided, all square at 18)", () => {
    const s = matchStatus(m(7, flat(4), flat(4)));
    expect(s.text).toBe("Halved");
    expect(s.tone).toBe("square");
    expect(s.decided).toBe(true);
    expect(s.thruText).toBe("Final");
    expect(s.winnerSentence).toBe("Halved");
  });

  it("Canada leading uses the red tone", () => {
    const s = matchStatus(m(8, { 1: 5, 2: 5 }, { 1: 3, 2: 3 }));
    expect(s.text).toBe("2 UP");
    expect(s.tone).toBe("canada");
    expect(s.leaderSide).toBe("b");
  });
});

describe("matchSidePoints", () => {
  it("shows '—' before a match starts", () => {
    expect(matchSidePoints(m(9, {}, {}))).toEqual({ a: "—", b: "—" });
  });
  it("renders each side's holes-won + ½ per halve", () => {
    // USA wins 1,2; hole 3 halved → A = 2½, B = ½.
    const s = matchSidePoints(m(10, { 1: 3, 2: 3, 3: 4 }, { 1: 5, 2: 5, 3: 4 }));
    expect(s).toEqual({ a: "2½", b: "½" });
  });
});
