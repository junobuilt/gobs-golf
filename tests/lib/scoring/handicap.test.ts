import { describe, it, expect } from "vitest";
import { getHandicapStrokes, computeCourseHandicap } from "@/lib/scoring/handicap";

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
});
