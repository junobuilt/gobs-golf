import { describe, it, expect } from "vitest";
import { computeHoleResult, computeRoundResult, getStablefordPoints } from "@/lib/scoring/engine";
import type { HoleInput, FormatConfig } from "@/lib/scoring/types";

const STANDARD_TABLE = {
  doubleBogeyOrWorse: 0,
  bogey: 1,
  par: 2,
  birdie: 3,
  eagle: 4,
  albatross: 5,
};

function holeInput(format: HoleInput["format"], overrides: Partial<HoleInput> & Pick<HoleInput, "players" | "hole">): HoleInput {
  return {
    format,
    formatConfig: { basis: "net", override_holes: [] },
    ...overrides,
  };
}

// ─── getStablefordPoints helper ─────────────────────────────────────────────

describe("getStablefordPoints (Standard table)", () => {
  it("returns 2 for net par (delta 0)", () => {
    expect(getStablefordPoints(4, 4, STANDARD_TABLE)).toBe(2);
  });

  it("returns 3 for net birdie (delta -1)", () => {
    expect(getStablefordPoints(3, 4, STANDARD_TABLE)).toBe(3);
  });

  it("returns 4 for net eagle (delta -2)", () => {
    expect(getStablefordPoints(2, 4, STANDARD_TABLE)).toBe(4);
  });

  it("returns 5 for net albatross (delta -3)", () => {
    expect(getStablefordPoints(1, 4, STANDARD_TABLE)).toBe(5);
  });

  it("caps at albatross for any score better than albatross (delta <= -3)", () => {
    expect(getStablefordPoints(0, 5, STANDARD_TABLE)).toBe(5); // delta -5
  });

  it("returns 1 for net bogey (delta +1)", () => {
    expect(getStablefordPoints(5, 4, STANDARD_TABLE)).toBe(1);
  });

  it("returns 0 for net double bogey (delta +2)", () => {
    expect(getStablefordPoints(6, 4, STANDARD_TABLE)).toBe(0);
  });

  it("returns 0 for net triple bogey or worse (delta >= +2 still gets DB bucket)", () => {
    expect(getStablefordPoints(7, 4, STANDARD_TABLE)).toBe(0);
    expect(getStablefordPoints(10, 4, STANDARD_TABLE)).toBe(0);
  });
});

// ─── Stableford Standard hole ───────────────────────────────────────────────

describe("computeHoleResult — Stableford Standard", () => {
  it("sums all 4 players' points (par + birdie + bogey + double bogey = 2+3+1+0 = 6)", () => {
    const result = computeHoleResult(holeInput("stableford_standard", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },  // par → 2
        { playerId: "B", grossScore: 3, courseHandicap: 0 },  // birdie → 3
        { playerId: "C", grossScore: 5, courseHandicap: 0 },  // bogey → 1
        { playerId: "D", grossScore: 6, courseHandicap: 0 },  // dbl bogey → 0
      ],
    }));
    expect(result.teamScore).toBe(6);
    expect(result.contributingPlayerIds).toEqual(["A", "B", "C", "D"]);
    const a = result.perPlayer.find(p => p.playerId === "A");
    const b = result.perPlayer.find(p => p.playerId === "B");
    const c = result.perPlayer.find(p => p.playerId === "C");
    const d = result.perPlayer.find(p => p.playerId === "D");
    expect(a?.points).toBe(2);
    expect(b?.points).toBe(3);
    expect(c?.points).toBe(1);
    expect(d?.points).toBe(0);
  });

  it("applies handicap stroke before lookup (gross 5 + 1 stroke → net 4 = par → 2 points)", () => {
    const result = computeHoleResult(holeInput("stableford_standard", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 1 },
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 18 }, // 1 stroke; net 4 = par → 2
      ],
    }));
    expect(result.teamScore).toBe(2);
    const a = result.perPlayer.find(p => p.playerId === "A");
    expect(a?.handicapStrokes).toBe(1);
    expect(a?.netScore).toBe(4);
    expect(a?.points).toBe(2);
  });

  it("one player has null score — contributes 0 (excluded from sum, points=null)", () => {
    const result = computeHoleResult(holeInput("stableford_standard", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },     // par → 2
        { playerId: "B", grossScore: null, courseHandicap: 0 },  // null
        { playerId: "C", grossScore: 3, courseHandicap: 0 },     // birdie → 3
      ],
    }));
    expect(result.teamScore).toBe(5); // 2 + 3
    expect(result.contributingPlayerIds).toEqual(["A", "C"]);
    const b = result.perPlayer.find(p => p.playerId === "B");
    expect(b?.points).toBe(null);
    expect(b?.isContributing).toBe(false);
  });

  it("all players null — teamScore is null", () => {
    const result = computeHoleResult(holeInput("stableford_standard", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: null, courseHandicap: 0 },
        { playerId: "B", grossScore: null, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(null);
    expect(result.contributingPlayerIds).toEqual([]);
  });
});

// ─── Stableford Modified hole ───────────────────────────────────────────────

describe("computeHoleResult — Stableford Modified", () => {
  it("custom point_values override defaults", () => {
    const config: FormatConfig = {
      basis: "net",
      override_holes: [],
      point_values: { birdie: 5, eagle: 8 }, // partial override
    };
    const result = computeHoleResult({
      format: "stableford_modified",
      formatConfig: config,
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 3, courseHandicap: 0 },  // birdie → 5 (custom)
        { playerId: "B", grossScore: 2, courseHandicap: 0 },  // eagle → 8 (custom)
      ],
    });
    expect(result.teamScore).toBe(13);
    expect(result.perPlayer.find(p => p.playerId === "A")?.points).toBe(5);
    expect(result.perPlayer.find(p => p.playerId === "B")?.points).toBe(8);
  });

  it("partial overrides leave non-overridden buckets at default", () => {
    const config: FormatConfig = {
      basis: "net",
      override_holes: [],
      point_values: { birdie: 5 }, // only birdie overridden
    };
    const result = computeHoleResult({
      format: "stableford_modified",
      formatConfig: config,
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },  // par → 2 (default)
        { playerId: "B", grossScore: 3, courseHandicap: 0 },  // birdie → 5 (custom)
        { playerId: "C", grossScore: 5, courseHandicap: 0 },  // bogey → 1 (default)
      ],
    });
    expect(result.teamScore).toBe(8); // 2 + 5 + 1
  });

  it("falls back to Standard when no point_values provided", () => {
    const result = computeHoleResult({
      format: "stableford_modified",
      formatConfig: { basis: "net", override_holes: [] }, // no point_values
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 3, courseHandicap: 0 }, // birdie → 3 (Standard default)
      ],
    });
    expect(result.teamScore).toBe(3);
  });
});

// ─── GOBS House hole ────────────────────────────────────────────────────────

describe("computeHoleResult — GOBS House", () => {
  it("net double bogey returns -1 instead of 0", () => {
    const result = computeHoleResult(holeInput("gobs_house", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 6, courseHandicap: 0 }, // double bogey
      ],
    }));
    expect(result.teamScore).toBe(-1);
    expect(result.perPlayer.find(p => p.playerId === "A")?.points).toBe(-1);
  });

  it("net triple bogey also returns -1 (flat penalty regardless of how bad)", () => {
    const result = computeHoleResult(holeInput("gobs_house", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 7, courseHandicap: 0 }, // triple bogey
        { playerId: "B", grossScore: 9, courseHandicap: 0 }, // quintuple+
      ],
    }));
    expect(result.teamScore).toBe(-2);
    expect(result.perPlayer.find(p => p.playerId === "A")?.points).toBe(-1);
    expect(result.perPlayer.find(p => p.playerId === "B")?.points).toBe(-1);
  });

  it("team total can go negative when multiple players blow up", () => {
    const result = computeHoleResult(holeInput("gobs_house", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 6, courseHandicap: 0 },
        { playerId: "B", grossScore: 7, courseHandicap: 0 },
        { playerId: "C", grossScore: 8, courseHandicap: 0 },
        { playerId: "D", grossScore: 9, courseHandicap: 0 },
      ],
    }));
    expect(result.teamScore).toBe(-4);
  });

  it("mixed team — par/birdie/double bogey/triple bogey = 2+3-1-1 = 3", () => {
    const result = computeHoleResult(holeInput("gobs_house", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 }, // par
        { playerId: "B", grossScore: 3, courseHandicap: 0 }, // birdie
        { playerId: "C", grossScore: 6, courseHandicap: 0 }, // dbl bogey
        { playerId: "D", grossScore: 7, courseHandicap: 0 }, // triple bogey
      ],
    }));
    expect(result.teamScore).toBe(3);
  });

  it("net par/birdie/eagle/albatross are unchanged from Standard (only DB+ differs)", () => {
    const result = computeHoleResult(holeInput("gobs_house", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 }, // par → 2
        { playerId: "B", grossScore: 3, courseHandicap: 0 }, // birdie → 3
        { playerId: "C", grossScore: 2, courseHandicap: 0 }, // eagle → 4
        { playerId: "D", grossScore: 1, courseHandicap: 0 }, // albatross → 5
      ],
    }));
    expect(result.teamScore).toBe(14); // 2+3+4+5
  });
});

// ─── Round-level integration ────────────────────────────────────────────────

describe("computeRoundResult — Stableford", () => {
  it("Stableford Standard round sums hole points; teamParAtScored stays at 0", () => {
    const result = computeRoundResult({
      format: "stableford_standard",
      formatConfig: { basis: "net", override_holes: [] },
      holes: [
        { holeNumber: 1, par: 4, strokeIndex: 10 },
        { holeNumber: 2, par: 4, strokeIndex: 5 },
        { holeNumber: 3, par: 4, strokeIndex: 1 },
      ],
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: { 1: 4, 2: 3, 3: 5 } }, // 2 + 3 + 1 = 6
        { playerId: "B", courseHandicap: 0, grossScores: { 1: 5, 2: 4, 3: 6 } }, // 1 + 2 + 0 = 3
      ],
    });
    expect(result.teamScore).toBe(9);
    expect(result.holesScored).toBe(3);
    expect(result.teamParAtScored).toBe(0);
  });

  it("GOBS House round can have negative team total", () => {
    const result = computeRoundResult({
      format: "gobs_house",
      formatConfig: { basis: "net", override_holes: [] },
      holes: [
        { holeNumber: 1, par: 4, strokeIndex: 10 },
        { holeNumber: 2, par: 4, strokeIndex: 5 },
      ],
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: { 1: 7, 2: 8 } }, // -1, -1
        { playerId: "B", courseHandicap: 0, grossScores: { 1: 6, 2: 7 } }, // -1, -1
      ],
    });
    expect(result.teamScore).toBe(-4);
  });
});
