import { describe, it, expect } from "vitest";
import {
  roundNeedsFormat,
  isFormatLocked,
  defaultConfigFor,
  getScoringBasis,
  getOverrideHoles,
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
