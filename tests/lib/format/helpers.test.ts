import { describe, it, expect } from "vitest";
import {
  roundNeedsFormat,
  isFormatLocked,
  defaultConfigFor,
  getScoringBasis,
  getOverrideHoles,
  getHandicapAllowance,
  isTeamCardFormat,
  excludedFromIndividualStats,
  allowsIncompleteClose,
  getTeamBallCount,
} from "@/lib/format/helpers";
import { FORMAT_ORDER } from "@/lib/format/copy";

describe("roundNeedsFormat", () => {
  it("returns false when round is null", () => {
    expect(roundNeedsFormat(null)).toBe(false);
  });

  it("returns true when round has null format and is not complete", () => {
    expect(roundNeedsFormat({ format: null, is_complete: false })).toBe(true);
  });

  it("returns false when format is set", () => {
    expect(roundNeedsFormat({ format: "2_ball", is_complete: false })).toBe(false);
  });

  it("returns false when round is complete (even with null format)", () => {
    expect(roundNeedsFormat({ format: null, is_complete: true })).toBe(false);
  });
});

describe("isFormatLocked", () => {
  it("returns false when round has null format_locked_at", () => {
    expect(isFormatLocked({ format_locked_at: null })).toBe(false);
  });

  it("returns true when format_locked_at holds a timestamp", () => {
    expect(isFormatLocked({ format_locked_at: "2026-05-07T17:00:00Z" })).toBe(true);
  });
});

describe("defaultConfigFor", () => {
  it("returns best_n=2 for 2_ball", () => {
    expect(defaultConfigFor("2_ball").best_n).toBe(2);
  });

  it("returns best_n=3 for 3_ball", () => {
    expect(defaultConfigFor("3_ball").best_n).toBe(3);
  });

  it("returns net basis for every format", () => {
    // Wave 1B follow-up: Shambles is now net best-ball (no longer team-card /
    // gross), so every selectable format defaults to net.
    for (const f of FORMAT_ORDER) {
      expect(defaultConfigFor(f).basis).toBe("net");
    }
  });

  it("returns point_values only for gobs_stableford", () => {
    expect(defaultConfigFor("gobs_stableford").point_values).toBeDefined();
    expect(defaultConfigFor("stableford_standard").point_values).toBeUndefined();
    expect(defaultConfigFor("2_ball").point_values).toBeUndefined();
    expect(defaultConfigFor("3_ball").point_values).toBeUndefined();
    expect(defaultConfigFor("best_ball").point_values).toBeUndefined();
  });

  it("best_ball default has best_n=1", () => {
    expect(defaultConfigFor("best_ball").best_n).toBe(1);
  });

  it("covers every format with no missing keys", () => {
    for (const f of FORMAT_ORDER) {
      const cfg = defaultConfigFor(f);
      expect(cfg).toBeDefined();
      expect(cfg.override_holes).toEqual([]);
    }
  });

  it("returns a fresh object each call (no shared mutable state)", () => {
    const a = defaultConfigFor("2_ball");
    const b = defaultConfigFor("2_ball");
    expect(a).not.toBe(b);
    a.best_n = 99;
    expect(b.best_n).toBe(2);
  });

  it("seeds scoring_basis to 'net' for every format", () => {
    // Wave 1B follow-up: Shambles is net best-ball now, so all formats seed net.
    for (const f of FORMAT_ORDER) {
      expect(defaultConfigFor(f).scoring_basis).toBe("net");
    }
  });
});

describe("getScoringBasis", () => {
  it("returns 'net' for null config (backward compat for pre-B3.2 rounds)", () => {
    expect(getScoringBasis(null)).toBe("net");
  });

  it("returns 'net' for undefined config", () => {
    expect(getScoringBasis(undefined)).toBe("net");
  });

  it("returns 'net' when scoring_basis key is missing from config", () => {
    expect(getScoringBasis({ basis: "net", override_holes: [] })).toBe("net");
  });

  it("returns 'gross' when scoring_basis is set to 'gross'", () => {
    expect(getScoringBasis({ basis: "net", scoring_basis: "gross", override_holes: [] })).toBe("gross");
  });

  it("returns 'net' when scoring_basis is explicitly 'net'", () => {
    expect(getScoringBasis({ basis: "net", scoring_basis: "net", override_holes: [] })).toBe("net");
  });
});

describe("getOverrideHoles", () => {
  it("returns [] for null/undefined config", () => {
    expect(getOverrideHoles(null)).toEqual([]);
    expect(getOverrideHoles(undefined)).toEqual([]);
  });

  it("returns [] when override_holes key is missing", () => {
    expect(getOverrideHoles({ basis: "net" })).toEqual([]);
  });

  it("returns the array as-is when present", () => {
    expect(getOverrideHoles({ basis: "net", override_holes: [9, 18] })).toEqual([9, 18]);
  });
});

describe("getHandicapAllowance (Wave 1A)", () => {
  it("defaults to 100 for null/undefined config (back-compat for pre-1A rounds)", () => {
    expect(getHandicapAllowance(null)).toBe(100);
    expect(getHandicapAllowance(undefined)).toBe(100);
  });

  it("defaults to 100 when the key is absent", () => {
    expect(getHandicapAllowance({ basis: "net", override_holes: [] })).toBe(100);
  });

  it("returns the stored percent when present", () => {
    expect(getHandicapAllowance({ basis: "net", handicap_allowance: 80 })).toBe(80);
    expect(getHandicapAllowance({ basis: "net", handicap_allowance: 100 })).toBe(100);
    expect(getHandicapAllowance({ basis: "net", handicap_allowance: 10 })).toBe(10);
  });

  it("defaults to 100 for a non-finite / non-number value", () => {
    expect(getHandicapAllowance({ basis: "net", handicap_allowance: NaN })).toBe(100);
    // @ts-expect-error — defending against malformed JSON in the column
    expect(getHandicapAllowance({ basis: "net", handicap_allowance: "80" })).toBe(100);
  });

  it("clamps defensively to [10, 100]", () => {
    expect(getHandicapAllowance({ basis: "net", handicap_allowance: 0 })).toBe(10);
    expect(getHandicapAllowance({ basis: "net", handicap_allowance: 5 })).toBe(10);
    expect(getHandicapAllowance({ basis: "net", handicap_allowance: 150 })).toBe(100);
  });
});

describe("isTeamCardFormat (Wave 1B follow-up — Shambles removed)", () => {
  it("returns false for shambles (now an individual best-ball format)", () => {
    expect(isTeamCardFormat("shambles")).toBe(false);
  });

  it("returns false for every currently-selectable format", () => {
    // The team-card spine stays for future Scramble/Alt-Shot, but no format
    // routes to it today — the set is empty.
    expect(FORMAT_ORDER).toContain("shambles");
    for (const f of FORMAT_ORDER) {
      expect(isTeamCardFormat(f)).toBe(false);
    }
  });

  it("returns false for null/undefined", () => {
    expect(isTeamCardFormat(null)).toBe(false);
    expect(isTeamCardFormat(undefined)).toBe(false);
  });
});

describe("excludedFromIndividualStats (Wave 1B follow-up)", () => {
  it("excludes shambles (scores exist but aren't authoritative)", () => {
    expect(excludedFromIndividualStats("shambles")).toBe(true);
  });

  it("includes every individual stroke/Stableford format", () => {
    for (const f of FORMAT_ORDER.filter((x) => x !== "shambles")) {
      expect(excludedFromIndividualStats(f)).toBe(false);
    }
  });

  it("returns false for null/undefined", () => {
    expect(excludedFromIndividualStats(null)).toBe(false);
    expect(excludedFromIndividualStats(undefined)).toBe(false);
  });
});

describe("allowsIncompleteClose (Wave 1B follow-up)", () => {
  it("is true for shambles (relaxed close — players pick up)", () => {
    expect(allowsIncompleteClose("shambles")).toBe(true);
  });

  it("is false for every blind-draw (full-completion) format", () => {
    for (const f of FORMAT_ORDER.filter((x) => x !== "shambles")) {
      expect(allowsIncompleteClose(f)).toBe(false);
    }
  });

  it("returns false for null/undefined", () => {
    expect(allowsIncompleteClose(null)).toBe(false);
    expect(allowsIncompleteClose(undefined)).toBe(false);
  });
});

describe("getTeamBallCount (Wave 1B)", () => {
  it("defaults to 1 for null/undefined config (non-team-card / pre-1B rounds)", () => {
    expect(getTeamBallCount(null)).toBe(1);
    expect(getTeamBallCount(undefined)).toBe(1);
  });

  it("defaults to 1 when the key is absent", () => {
    expect(getTeamBallCount({ basis: "gross" })).toBe(1);
  });

  it("returns the stored count when present", () => {
    expect(getTeamBallCount({ basis: "gross", team_ball_count: 1 })).toBe(1);
    expect(getTeamBallCount({ basis: "gross", team_ball_count: 2 })).toBe(2);
  });

  it("defaults to 1 for a non-finite / non-number value", () => {
    expect(getTeamBallCount({ basis: "gross", team_ball_count: NaN })).toBe(1);
    // @ts-expect-error — defending against malformed JSON in the column
    expect(getTeamBallCount({ basis: "gross", team_ball_count: "2" })).toBe(1);
  });

  it("clamps defensively to [1, 2]", () => {
    expect(getTeamBallCount({ basis: "gross", team_ball_count: 0 })).toBe(1);
    expect(getTeamBallCount({ basis: "gross", team_ball_count: 3 })).toBe(2);
    expect(getTeamBallCount({ basis: "gross", team_ball_count: 5 })).toBe(2);
  });
});

describe("defaultConfigFor (Wave 1B follow-up — shambles)", () => {
  it("seeds shambles with team_ball_count = 1", () => {
    expect(defaultConfigFor("shambles").team_ball_count).toBe(1);
  });

  it("seeds shambles as net best-ball (locked net like Best Ball)", () => {
    expect(defaultConfigFor("shambles").scoring_basis).toBe("net");
    expect(defaultConfigFor("shambles").basis).toBe("net");
  });
});
