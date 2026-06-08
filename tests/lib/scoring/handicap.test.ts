import { describe, it, expect } from "vitest";
import { getHandicapStrokes, computeCourseHandicap, getPlayingStrokes } from "@/lib/scoring/handicap";

describe("getHandicapStrokes", () => {
  it("returns 0 for scratch player", () => {
    expect(getHandicapStrokes(0, 1)).toBe(0);
    expect(getHandicapStrokes(0, 18)).toBe(0);
  });

  it("returns 0 when course handicap is null", () => {
    expect(getHandicapStrokes(null, 1)).toBe(0);
  });

  it("gives 1 stroke per hole on the 15 hardest holes for CH=15", () => {
    expect(getHandicapStrokes(15, 1)).toBe(1);
    expect(getHandicapStrokes(15, 15)).toBe(1);
    expect(getHandicapStrokes(15, 16)).toBe(0);
    expect(getHandicapStrokes(15, 18)).toBe(0);
  });

  it("gives 2 strokes on SI 1-4 and 1 stroke on SI 5-18 for CH=22", () => {
    expect(getHandicapStrokes(22, 1)).toBe(2);
    expect(getHandicapStrokes(22, 4)).toBe(2);
    expect(getHandicapStrokes(22, 5)).toBe(1);
    expect(getHandicapStrokes(22, 18)).toBe(1);
  });

  it("gives 1 stroke on every hole for CH=18", () => {
    for (let si = 1; si <= 18; si++) {
      expect(getHandicapStrokes(18, si)).toBe(1);
    }
  });
});

describe("getPlayingStrokes (Wave 1A handicap allowance)", () => {
  it("is the identity at 100%", () => {
    expect(getPlayingStrokes(8, 100)).toBe(8);
    expect(getPlayingStrokes(0, 100)).toBe(0);
    expect(getPlayingStrokes(36, 100)).toBe(36);
  });

  it("80% of 8 = 6 (6.4 rounds to 6)", () => {
    expect(getPlayingStrokes(8, 80)).toBe(6);
  });

  it("80% of 9 = 7 (7.2 rounds down to 7)", () => {
    expect(getPlayingStrokes(9, 80)).toBe(7);
  });

  it("rounds a .5 boundary up (90% of 5 = 4.5 → 5)", () => {
    expect(getPlayingStrokes(5, 90)).toBe(5);
    // 50% of 9 = 4.5 → 5 as well
    expect(getPlayingStrokes(9, 50)).toBe(5);
  });

  it("returns null when raw CH is null", () => {
    expect(getPlayingStrokes(null, 80)).toBe(null);
    expect(getPlayingStrokes(null, 100)).toBe(null);
  });

  it("scales a larger handicap (80% of 22 = 18 from 17.6)", () => {
    expect(getPlayingStrokes(22, 80)).toBe(18);
  });
});

describe("computeCourseHandicap", () => {
  it("returns null when handicap index is null", () => {
    expect(computeCourseHandicap(null, 113, 72, 72)).toBe(null);
  });

  it("equals handicap index (rounded) when slope=113 and rating=par", () => {
    expect(computeCourseHandicap(12.4, 113, 72, 72)).toBe(12);
    expect(computeCourseHandicap(12.5, 113, 72, 72)).toBe(13);
  });

  it("scales by slope/113", () => {
    expect(computeCourseHandicap(10, 130, 72, 72)).toBe(Math.round(10 * 130 / 113));
  });

  // LT1 regression anchors (2026-05-09). Documented values from the May 8
  // first-live-course test: Semiahmoo white/yellow combo tee uses estimated
  // slope 120 and rating 67.6 (par 72) until pro shop confirms. Kevin's
  // current HI is 12.5 → 9; Wayne's is 20.1 → 17. The scorecard previously
  // displayed cached values (6 and 14) computed from older HIs before
  // admin updates. Recompute-on-load now produces these values directly.
  it("matches Kevin's documented Course Handicap on the white/yellow combo", () => {
    expect(computeCourseHandicap(12.5, 120, 67.6, 72)).toBe(9);
  });

  it("matches Wayne's documented Course Handicap on the white/yellow combo", () => {
    expect(computeCourseHandicap(20.1, 120, 67.6, 72)).toBe(17);
  });
});
