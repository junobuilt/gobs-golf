import { describe, it, expect } from "vitest";
import { sumCourseHandicaps } from "@/lib/round/teamCourseHandicap";

describe("sumCourseHandicaps (admin Round Setup 'Team CH' label, display-only)", () => {
  it("sums every player's course handicap", () => {
    // Negative control: fixture differs from each element, so a no-op (e.g.
    // returning the first value) would fail.
    expect(sumCourseHandicaps([12, 8])).toBe(20);
    expect(sumCourseHandicaps([12, 8, 5, 21])).toBe(46);
  });

  it("returns null when ANY player's course handicap is null (→ '—', not a partial sum)", () => {
    expect(sumCourseHandicaps([12, null])).toBeNull();
    expect(sumCourseHandicaps([null, 8])).toBeNull();
    expect(sumCourseHandicaps([12, null, 5])).toBeNull();
  });

  it("returns 0 for an empty roster (no players → no '—')", () => {
    expect(sumCourseHandicaps([])).toBe(0);
  });

  it("handles a single player", () => {
    expect(sumCourseHandicaps([17])).toBe(17);
    expect(sumCourseHandicaps([null])).toBeNull();
  });
});
