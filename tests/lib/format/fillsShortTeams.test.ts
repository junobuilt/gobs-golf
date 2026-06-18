// Spec 2 (migration 029) — the canonical policy predicate for blind draw.
//
// fillsShortTeams(format) = !isTeamCardFormat(format) is THE single source of
// truth for "does blind draw fill a short team in this format?". This test
// pins the policy for all 9 formats so a future format addition has to make a
// deliberate choice here, and asserts the predicate is INDEPENDENT of the
// completion-floor family (allowsIncompleteClose) — relaxed close and
// blind-draw eligibility are orthogonal.

import { describe, it, expect } from "vitest";
import {
  fillsShortTeams,
  isTeamCardFormat,
  allowsIncompleteClose,
} from "@/lib/format/helpers";
import { FORMAT_ORDER } from "@/lib/format/copy";
import type { Format } from "@/lib/scoring/types";

// The locked policy matrix from the spec.
const FILLS: Record<Format, boolean> = {
  "2_ball": true,
  "3_ball": true,
  best_ball: true,
  stableford_standard: true,
  gobs_stableford: true,
  par_competition: true,
  shambles: true,
  texas_scramble: false,
  alternate_shot: false,
};

describe("fillsShortTeams — blind-draw policy predicate", () => {
  it("covers every format in FORMAT_ORDER (no format left unclassified)", () => {
    for (const f of FORMAT_ORDER) {
      expect(FILLS).toHaveProperty(f);
    }
    expect(FORMAT_ORDER).toHaveLength(Object.keys(FILLS).length);
  });

  it("matches the locked policy matrix for all 9 formats", () => {
    for (const f of FORMAT_ORDER) {
      expect(fillsShortTeams(f)).toBe(FILLS[f]);
    }
  });

  it("is exactly the negation of isTeamCardFormat", () => {
    for (const f of FORMAT_ORDER) {
      expect(fillsShortTeams(f)).toBe(!isTeamCardFormat(f));
    }
  });

  it("is independent of the completion-floor family — relaxed-close formats STILL fill", () => {
    // par_competition + shambles are BOTH relaxed-close AND fill short teams.
    // The two concepts must not be conflated (the original bug was routing
    // relaxed → a draw-less finalize).
    expect(allowsIncompleteClose("par_competition")).toBe(true);
    expect(fillsShortTeams("par_competition")).toBe(true);
    expect(allowsIncompleteClose("shambles")).toBe(true);
    expect(fillsShortTeams("shambles")).toBe(true);
  });
});
