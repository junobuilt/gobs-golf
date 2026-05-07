import { describe, it, expect } from "vitest";
import { roundNeedsFormat, defaultConfigFor } from "@/lib/format/helpers";
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

  it("returns point_values only for stableford_modified", () => {
    expect(defaultConfigFor("stableford_modified").point_values).toBeDefined();
    expect(defaultConfigFor("stableford_standard").point_values).toBeUndefined();
    expect(defaultConfigFor("gobs_house").point_values).toBeUndefined();
    expect(defaultConfigFor("2_ball").point_values).toBeUndefined();
    expect(defaultConfigFor("3_ball").point_values).toBeUndefined();
  });

  it("covers all five formats with no missing keys", () => {
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
});
