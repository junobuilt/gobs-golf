import { describe, it, expect } from "vitest";
import { resolveResumeHole, pickInitialHole, isValidHole } from "@/lib/scorecard/resumeHole";

// Helper: build an isScored predicate from a set of scored hole numbers.
const scored = (holes: number[]) => (h: number) => holes.includes(h);

describe("resolveResumeHole — play-order first-unscored", () => {
  it("shotgun start 12, scored 12–15 → next in play order is 16 (NOT numeric 1)", () => {
    expect(
      resolveResumeHole({ startHole: 12, isScored: scored([12, 13, 14, 15]) }),
    ).toBe(16);
  });

  it("start 1 behaves as ordinary numeric first-unscored", () => {
    expect(resolveResumeHole({ startHole: 1, isScored: scored([1, 2, 3]) })).toBe(4);
  });

  it("start 1, nothing scored → hole 1", () => {
    expect(resolveResumeHole({ startHole: 1, isScored: scored([]) })).toBe(1);
  });

  it("shotgun start 12, nothing scored → the start hole 12", () => {
    expect(resolveResumeHole({ startHole: 12, isScored: scored([]) })).toBe(12);
  });

  it("wraps past 18: start 16, scored 16–18 → 1", () => {
    expect(
      resolveResumeHole({ startHole: 16, isScored: scored([16, 17, 18]) }),
    ).toBe(1);
  });

  it("wraps past 18: start 16, scored 16,17,18,1,2 → 3", () => {
    expect(
      resolveResumeHole({ startHole: 16, isScored: scored([16, 17, 18, 1, 2]) }),
    ).toBe(3);
  });

  it("all 18 scored (start 12) → last hole in play order = 11", () => {
    const all = Array.from({ length: 18 }, (_, i) => i + 1);
    expect(resolveResumeHole({ startHole: 12, isScored: scored(all) })).toBe(11);
  });

  it("all 18 scored (start 1) → last hole in play order = 18", () => {
    const all = Array.from({ length: 18 }, (_, i) => i + 1);
    expect(resolveResumeHole({ startHole: 1, isScored: scored(all) })).toBe(18);
  });

  it("skips an already-scored start hole to the first gap in play order", () => {
    // Start 12, scored 12 and 14 (13 skipped by the entry) → resume 13.
    expect(
      resolveResumeHole({ startHole: 12, isScored: scored([12, 14]) }),
    ).toBe(13);
  });
});

describe("isValidHole", () => {
  it("accepts 1..18, rejects out-of-range / non-integers / non-numbers", () => {
    expect(isValidHole(1)).toBe(true);
    expect(isValidHole(18)).toBe(true);
    expect(isValidHole(0)).toBe(false);
    expect(isValidHole(19)).toBe(false);
    expect(isValidHole(4.5)).toBe(false);
    expect(isValidHole(null)).toBe(false);
    expect(isValidHole("7")).toBe(false);
    expect(isValidHole(NaN)).toBe(false);
  });
});

describe("pickInitialHole — restore vs fallback", () => {
  it("honors a valid saved hole on mount (fallback resolver NOT consulted)", () => {
    let consulted = false;
    const result = pickInitialHole({
      savedHole: 9,
      startHole: 12,
      hasAnyScore: true,
      isScored: h => {
        consulted = true;
        return scored([12, 13])(h);
      },
    });
    expect(result).toBe(9);
    expect(consulted).toBe(false);
  });

  it("runs the play-order fallback when no hole is saved", () => {
    expect(
      pickInitialHole({ savedHole: null, startHole: 12, hasAnyScore: true, isScored: scored([12, 13, 14, 15]) }),
    ).toBe(16);
  });

  it("runs the fallback when the saved hole is invalid (corrupt / out of range)", () => {
    expect(
      pickInitialHole({ savedHole: 99, startHole: 1, hasAnyScore: true, isScored: scored([1, 2]) }),
    ).toBe(3);
  });
});

// The start-hole-change trap: an admin edits a group's start hole (16 → 12);
// every device that already opened that card holds a stale saved hole (16). A
// BLANK card must ignore that saved hole and fall back to the (new) start hole.
describe("pickInitialHole — hasAnyScore gates the restore", () => {
  it("no scores + saved hole 16 + start hole 12 → returns 12 (ignores stale saved hole)", () => {
    expect(
      pickInitialHole({ savedHole: 16, startHole: 12, hasAnyScore: false, isScored: scored([]) }),
    ).toBe(12);
  });

  it("scores present + saved hole 16 + start hole 12 → returns 16 (restore honored)", () => {
    expect(
      pickInitialHole({ savedHole: 16, startHole: 12, hasAnyScore: true, isScored: scored([12, 13]) }),
    ).toBe(16);
  });

  it("no scores + no saved hole + start hole 12 → returns 12", () => {
    expect(
      pickInitialHole({ savedHole: null, startHole: 12, hasAnyScore: false, isScored: scored([]) }),
    ).toBe(12);
  });

  it("every hole scored → still returns the last hole in play order (existing behavior preserved)", () => {
    const all = Array.from({ length: 18 }, (_, i) => i + 1);
    expect(
      pickInitialHole({ savedHole: null, startHole: 12, hasAnyScore: true, isScored: scored(all) }),
    ).toBe(11);
  });
});
