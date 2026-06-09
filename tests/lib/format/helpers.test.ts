import { describe, it, expect } from "vitest";
import {
  roundNeedsFormat,
  isFormatLocked,
  defaultConfigFor,
  getScoringBasis,
  getOverrideHoles,
  getHandicapAllowance,
  getPlayingCourseHandicap,
  isTeamCardFormat,
  excludedFromIndividualStats,
  allowsIncompleteClose,
  getTeamBallCount,
} from "@/lib/format/helpers";
import { getHandicapStrokes } from "@/lib/scoring/handicap";
import { FORMAT_ORDER } from "@/lib/format/copy";
import type { Format } from "@/lib/scoring/types";

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

describe("isTeamCardFormat (Phase 1C — Scramble + Alt-Shot live)", () => {
  it("returns false for shambles (an individual best-ball format)", () => {
    expect(isTeamCardFormat("shambles")).toBe(false);
  });

  it("returns true ONLY for the NET team-card formats", () => {
    const teamCard = new Set<Format>(["texas_scramble", "alternate_shot"]);
    for (const f of FORMAT_ORDER) {
      expect(isTeamCardFormat(f)).toBe(teamCard.has(f));
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

  it("excludes the team-card formats (no per-player scores)", () => {
    expect(excludedFromIndividualStats("texas_scramble")).toBe(true);
    expect(excludedFromIndividualStats("alternate_shot")).toBe(true);
  });

  it("includes every individual stroke/Stableford format", () => {
    const excluded = new Set<Format>(["shambles", "texas_scramble", "alternate_shot"]);
    for (const f of FORMAT_ORDER.filter((x) => !excluded.has(x))) {
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

  it("is false for every full-completion format (incl. the team-card formats)", () => {
    // Texas Scramble / Alternate Shot are team-card but NOT relaxed-close —
    // every team scores every hole, finalized via finalize_round_team_card.
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

// 2026-06-09 — the single allowance-adjusted playing-CH accessor + the stroke
// allocation the dots derive from. Golden values are hand-derived literals (per
// CLAUDE.md engineering principle #3): the EXPECTED numbers are typed by hand,
// NOT computed by calling the app's own handicap function, so a bug in that
// function can't make the assertion pass with a wrong value.
describe("getPlayingCourseHandicap", () => {
  it("scales the live round-174 case: raw CH 24 at 80% → 19 (round(19.2))", () => {
    expect(getPlayingCourseHandicap(24, { basis: "net", handicap_allowance: 80 })).toBe(19);
  });

  it("scales the fixture case: raw CH 20 at 80% → 16 (round(16.0))", () => {
    expect(getPlayingCourseHandicap(20, { basis: "net", handicap_allowance: 80 })).toBe(16);
  });

  it("is the identity at 100% (raw CH passes through)", () => {
    expect(getPlayingCourseHandicap(24, { basis: "net", handicap_allowance: 100 })).toBe(24);
  });

  it("treats a missing allowance as 100% (back-compat)", () => {
    expect(getPlayingCourseHandicap(24, null)).toBe(24);
    expect(getPlayingCourseHandicap(24, undefined)).toBe(24);
    expect(getPlayingCourseHandicap(24, { basis: "net" })).toBe(24);
  });

  it("keeps a null course handicap null", () => {
    expect(getPlayingCourseHandicap(null, { basis: "net", handicap_allowance: 80 })).toBeNull();
  });
});

describe("stroke-dot allocation distinguishes 80% from 100% (negative control)", () => {
  // For each stroke index 1..18, how many strokes the player receives at a
  // given playing CH. This is exactly what the grid dot row counts.
  const allocationBySI = (playingCH: number): number[] =>
    Array.from({ length: 18 }, (_, i) => getHandicapStrokes(playingCH, i + 1));

  it("at 80% (playing CH 19 = 18 + 1) exactly ONE stroke index gets a 2nd stroke — SI 1", () => {
    const playingCH = getPlayingCourseHandicap(24, { basis: "net", handicap_allowance: 80 });
    expect(playingCH).toBe(19); // golden literal
    const alloc = allocationBySI(playingCH!);
    const doubles = alloc.filter(n => n === 2).length;
    expect(doubles).toBe(1); // hand-derived: 19 = 18 + 1
    expect(alloc[0]).toBe(2); // SI 1 (= hole 4 on tee 4) double-dotted
    expect(alloc[1]).toBe(1); // SI 2 single
  });

  it("at 100% (raw CH 24 = 18 + 6) exactly SIX get a 2nd stroke — a DIFFERENT pattern", () => {
    const alloc = allocationBySI(24);
    const doubles = alloc.filter(n => n === 2).length;
    expect(doubles).toBe(6); // hand-derived: 24 = 18 + 6
    // The two patterns are genuinely distinct (1 vs 6 double-stroke holes), so
    // a test that "passes" under either would be caught here.
    expect(doubles).not.toBe(1);
  });
});
