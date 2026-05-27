import { describe, it, expect } from "vitest";
import {
  computeHoleResult,
  computeRoundResult,
  getStablefordPoints,
  STABLEFORD_STANDARD_POINTS,
  GOBS_STABLEFORD_POINTS,
} from "@/lib/scoring/engine";
import type { HoleInput, FormatConfig, HoleInfo } from "@/lib/scoring/types";

// Locked point tables (2026-05-10). Mirror the engine constants explicitly so
// any drift between the test pin and the engine constant flags here, not
// elsewhere.
const STANDARD_TABLE = {
  doubleBogeyOrWorse: 0,
  bogey: 1,
  par: 2,
  birdie: 3,
  eagle: 5,
  albatross: 8,
};

const GOBS_DEFAULT_TABLE = {
  doubleBogeyOrWorse: -1,
  bogey: 0,
  par: 2,
  birdie: 3,
  eagle: 5,
  albatross: 8,
};

describe("Stableford locked tables (2026-05-10 values)", () => {
  it("STABLEFORD_STANDARD_POINTS matches the locked table", () => {
    expect(STABLEFORD_STANDARD_POINTS).toEqual(STANDARD_TABLE);
  });

  it("GOBS_STABLEFORD_POINTS matches the locked GOBS defaults", () => {
    expect(GOBS_STABLEFORD_POINTS).toEqual(GOBS_DEFAULT_TABLE);
  });
});

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

  it("returns 5 for net eagle (delta -2)", () => {
    expect(getStablefordPoints(2, 4, STANDARD_TABLE)).toBe(5);
  });

  it("returns 8 for net albatross (delta -3)", () => {
    expect(getStablefordPoints(1, 4, STANDARD_TABLE)).toBe(8);
  });

  it("caps at albatross for any score better than albatross (delta <= -3)", () => {
    expect(getStablefordPoints(0, 5, STANDARD_TABLE)).toBe(8); // delta -5
  });

  it("returns 1 for net bogey (delta +1)", () => {
    expect(getStablefordPoints(5, 4, STANDARD_TABLE)).toBe(1);
  });

  it("returns 0 for net double bogey (delta +2)", () => {
    expect(getStablefordPoints(6, 4, STANDARD_TABLE)).toBe(0);
  });

  it("returns 0 for net triple bogey or worse (delta >= +2 collapses to DB bucket)", () => {
    expect(getStablefordPoints(7, 4, STANDARD_TABLE)).toBe(0);
    expect(getStablefordPoints(10, 4, STANDARD_TABLE)).toBe(0);
  });
});

describe("getStablefordPoints (GOBS defaults)", () => {
  it("returns -1 for net double bogey (delta +2) under GOBS defaults", () => {
    expect(getStablefordPoints(6, 4, GOBS_DEFAULT_TABLE)).toBe(-1);
  });

  it("returns -1 for any net result worse than DB (delta >= +2 collapses)", () => {
    expect(getStablefordPoints(8, 4, GOBS_DEFAULT_TABLE)).toBe(-1);
    expect(getStablefordPoints(12, 4, GOBS_DEFAULT_TABLE)).toBe(-1);
  });

  it("returns 0 for net bogey (delta +1) under GOBS defaults", () => {
    expect(getStablefordPoints(5, 4, GOBS_DEFAULT_TABLE)).toBe(0);
  });

  it("returns 2 for net par (delta 0)", () => {
    expect(getStablefordPoints(4, 4, GOBS_DEFAULT_TABLE)).toBe(2);
  });
});

// ─── Stableford Standard hole ───────────────────────────────────────────────

describe("computeHoleResult — Stableford Standard", () => {
  it("sums all 4 players' points (par+birdie+bogey+double = 2+3+1+0 = 6)", () => {
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

  it("eagle scores 5 and albatross scores 8 under new Standard table", () => {
    const result = computeHoleResult(holeInput("stableford_standard", {
      hole: { holeNumber: 1, par: 5, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 3, courseHandicap: 0 }, // eagle → 5
        { playerId: "B", grossScore: 2, courseHandicap: 0 }, // albatross → 8
      ],
    }));
    expect(result.perPlayer.find(p => p.playerId === "A")?.points).toBe(5);
    expect(result.perPlayer.find(p => p.playerId === "B")?.points).toBe(8);
    expect(result.teamScore).toBe(13);
  });

  it("applies handicap stroke before lookup (gross 5 + 1 stroke → net 4 = par → 2)", () => {
    const result = computeHoleResult(holeInput("stableford_standard", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 1 },
      players: [
        { playerId: "A", grossScore: 5, courseHandicap: 18 },
      ],
    }));
    expect(result.teamScore).toBe(2);
    const a = result.perPlayer.find(p => p.playerId === "A");
    expect(a?.handicapStrokes).toBe(1);
    expect(a?.netScore).toBe(4);
    expect(a?.points).toBe(2);
  });

  it("one player has null score — excluded from sum, points=null", () => {
    const result = computeHoleResult(holeInput("stableford_standard", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 },     // par → 2
        { playerId: "B", grossScore: null, courseHandicap: 0 },  // null
        { playerId: "C", grossScore: 3, courseHandicap: 0 },     // birdie → 3
      ],
    }));
    expect(result.teamScore).toBe(5);
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

// ─── GOBS Stableford hole (with optional point_values overrides) ───────────

describe("computeHoleResult — GOBS Stableford", () => {
  it("uses league defaults when no point_values override is given", () => {
    const result = computeHoleResult(holeInput("gobs_stableford", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 }, // par → 2
        { playerId: "B", grossScore: 3, courseHandicap: 0 }, // birdie → 3
        { playerId: "C", grossScore: 5, courseHandicap: 0 }, // bogey → 0
        { playerId: "D", grossScore: 6, courseHandicap: 0 }, // dbl bogey → -1
      ],
    }));
    expect(result.teamScore).toBe(4); // 2+3+0+(-1)
    expect(result.perPlayer.find(p => p.playerId === "C")?.points).toBe(0);
    expect(result.perPlayer.find(p => p.playerId === "D")?.points).toBe(-1);
  });

  it("custom point_values override defaults (per-round admin edit)", () => {
    const config: FormatConfig = {
      basis: "net",
      override_holes: [],
      point_values: { birdie: 6, eagle: 9 },
    };
    const result = computeHoleResult({
      format: "gobs_stableford",
      formatConfig: config,
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 3, courseHandicap: 0 },  // birdie → 6 (custom)
        { playerId: "B", grossScore: 2, courseHandicap: 0 },  // eagle → 9 (custom)
        { playerId: "C", grossScore: 6, courseHandicap: 0 },  // dbl bogey → -1 (GOBS default)
      ],
    });
    expect(result.teamScore).toBe(14); // 6 + 9 + (-1)
    expect(result.perPlayer.find(p => p.playerId === "A")?.points).toBe(6);
    expect(result.perPlayer.find(p => p.playerId === "B")?.points).toBe(9);
    expect(result.perPlayer.find(p => p.playerId === "C")?.points).toBe(-1);
  });

  it("partial overrides leave unspecified buckets at GOBS defaults", () => {
    const config: FormatConfig = {
      basis: "net",
      override_holes: [],
      point_values: { birdie: 6 },
    };
    const result = computeHoleResult({
      format: "gobs_stableford",
      formatConfig: config,
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 4, courseHandicap: 0 }, // par → 2 (default)
        { playerId: "B", grossScore: 3, courseHandicap: 0 }, // birdie → 6 (custom)
        { playerId: "C", grossScore: 5, courseHandicap: 0 }, // bogey → 0 (default)
      ],
    });
    expect(result.teamScore).toBe(8); // 2 + 6 + 0
  });

  it("any net result worse than DB collapses to the DB bucket (delta >= +2)", () => {
    const result = computeHoleResult(holeInput("gobs_stableford", {
      hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
      players: [
        { playerId: "A", grossScore: 8, courseHandicap: 0 },  // quad bogey
        { playerId: "B", grossScore: 12, courseHandicap: 0 }, // octuple bogey
      ],
    }));
    // Both map to doubleBogeyOrWorse = -1 under GOBS defaults
    expect(result.perPlayer.find(p => p.playerId === "A")?.points).toBe(-1);
    expect(result.perPlayer.find(p => p.playerId === "B")?.points).toBe(-1);
    expect(result.teamScore).toBe(-2);
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
    // Blind-draw accumulators default to 0/{} when no fills are provided.
    expect(result.blindDrawTotal).toBe(0);
    expect(result.blindDrawPerHole).toEqual({});
  });

  it("GOBS Stableford round can have negative team total (DB+ = -1)", () => {
    const result = computeRoundResult({
      format: "gobs_stableford",
      formatConfig: { basis: "net", override_holes: [] },
      holes: [
        { holeNumber: 1, par: 4, strokeIndex: 10 },
        { holeNumber: 2, par: 4, strokeIndex: 5 },
      ],
      players: [
        // Both players double bogey both holes → -1 × 4 = -4
        { playerId: "A", courseHandicap: 0, grossScores: { 1: 6, 2: 6 } },
        { playerId: "B", courseHandicap: 0, grossScores: { 1: 6, 2: 6 } },
      ],
    });
    expect(result.teamScore).toBe(-4);
    expect(result.teamParAtScored).toBe(0);
  });
});

// ─── Stableford team total includes blind-draw points (D.1 follow-up) ──────
// Round 155 (2026-05-25) shipped wrong because the engine ignored
// blind_draws fills entirely. These tests pin the engine's contract:
//   - result.teamScore stays = team's own players' points (perHole invariant
//     preserved: teamScore = sum of perPlayer.points on that hole).
//   - result.blindDrawTotal carries the drawn player's points over the fill
//     range; callers add it into the headline team total.
//   - result.blindDrawPerHole[h] carries the per-hole contribution; callers
//     add it into F9/B9 leg totals over the relevant nine.
//
// Fixture design notes (CLAUDE.md engineering principle #3 — test fixtures
// must not accidentally pass): every drawn-player score is chosen so the
// drawn player's contribution is NONZERO. Without the new engine code,
// blindDrawTotal would default to 0 and the assertions below would fail —
// i.e. the test does real work.

describe("computeRoundResult — Stableford with blind draws", () => {
  // Reused 18-hole layout (par 4, SI distributed 18..1). All fixtures use
  // courseHandicap 0 so net = gross — keeps the math obvious.
  const eighteenPar4: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({
    holeNumber: i + 1,
    par: 4,
    strokeIndex: 18 - i,
  }));

  it("Stableford Standard: 3-player team + 1 blind draw (1..18) adds drawn player's points", () => {
    // Team A,B,C all par every hole → 2 pts × 18 × 3 = 108.
    const teamScoresPar: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) teamScoresPar[h] = 4;
    // Drawn player D birdies every hole → 3 pts × 18 = 54.
    const drawnScores: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) drawnScores[h] = 3;

    const result = computeRoundResult({
      format: "stableford_standard",
      formatConfig: { basis: "net", override_holes: [] },
      holes: eighteenPar4,
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: { ...teamScoresPar } },
        { playerId: "B", courseHandicap: 0, grossScores: { ...teamScoresPar } },
        { playerId: "C", courseHandicap: 0, grossScores: { ...teamScoresPar } },
      ],
      blindDraws: [
        {
          drawnPlayerId: "D",
          drawnPlayerCourseHandicap: 0,
          drawnPlayerScores: drawnScores,
          drawnPlayerHoles: eighteenPar4,
          holeRangeStart: 1,
          holeRangeEnd: 18,
        },
      ],
    });

    // Team's own players unchanged (invariant preserved).
    expect(result.teamScore).toBe(108);
    // Drawn player's 54 pts live on the separate accumulator.
    expect(result.blindDrawTotal).toBe(54);
    // Per-hole contribution: 3 pts on every hole.
    for (let h = 1; h <= 18; h++) {
      expect(result.blindDrawPerHole[h]).toBe(3);
    }
  });

  it("GOBS Stableford: drawn-player points use the GOBS table (eagle=5)", () => {
    const teamScoresPar: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) teamScoresPar[h] = 4; // par → 2 pts each
    // Drawn player eagles hole 1 (gross 2 on par 4) and pars the rest.
    // Standard table eagle = 5; GOBS default eagle is also 5 → same number,
    // but we additionally assert it's NOT 3 (birdie) to confirm the lookup
    // ran. Use a custom point_values override to make GOBS distinct from
    // Standard: birdie=6 instead of 3. Then drawn player birdies hole 2.
    const drawnScores: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) drawnScores[h] = 4;
    drawnScores[1] = 2; // eagle
    drawnScores[2] = 3; // birdie

    const result = computeRoundResult({
      format: "gobs_stableford",
      formatConfig: {
        basis: "net",
        override_holes: [],
        point_values: { birdie: 6 },
      },
      holes: eighteenPar4,
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: { ...teamScoresPar } },
        { playerId: "B", courseHandicap: 0, grossScores: { ...teamScoresPar } },
        { playerId: "C", courseHandicap: 0, grossScores: { ...teamScoresPar } },
      ],
      blindDraws: [
        {
          drawnPlayerId: "D",
          drawnPlayerCourseHandicap: 0,
          drawnPlayerScores: drawnScores,
          drawnPlayerHoles: eighteenPar4,
          holeRangeStart: 1,
          holeRangeEnd: 18,
        },
      ],
    });

    // 3 players × 18 holes × 2 pts (par, GOBS default) = 108.
    expect(result.teamScore).toBe(108);
    // Drawn player: eagle(5) + birdie(6 under override) + 16 pars(2 each)
    // = 5 + 6 + 32 = 43.
    expect(result.blindDrawTotal).toBe(43);
    expect(result.blindDrawPerHole[1]).toBe(5);
    expect(result.blindDrawPerHole[2]).toBe(6);
    expect(result.blindDrawPerHole[3]).toBe(2);
  });

  it("Mid-round dropout: drawn player covers only holes 11..18, no double count", () => {
    // 4-player team. D dropped after hole 10 — scores only 1..10.
    // A/B/C par every hole. D pars 1..10, no scores past that.
    const fullPar: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) fullPar[h] = 4;
    const dropoutScores: Record<number, number> = {};
    for (let h = 1; h <= 10; h++) dropoutScores[h] = 4;
    // Drawn player E covers holes 11..18 with birdies (3 pts each → 24 total).
    // Fixture seeds E's full 18 but the engine should only count 11..18.
    const drawnScores: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) drawnScores[h] = 3;

    const result = computeRoundResult({
      format: "stableford_standard",
      formatConfig: { basis: "net", override_holes: [] },
      holes: eighteenPar4,
      players: [
        { playerId: "A", courseHandicap: 0, grossScores: { ...fullPar } },
        { playerId: "B", courseHandicap: 0, grossScores: { ...fullPar } },
        { playerId: "C", courseHandicap: 0, grossScores: { ...fullPar } },
        { playerId: "D", courseHandicap: 0, grossScores: dropoutScores },
      ],
      blindDraws: [
        {
          drawnPlayerId: "E",
          drawnPlayerCourseHandicap: 0,
          drawnPlayerScores: drawnScores,
          drawnPlayerHoles: eighteenPar4,
          holeRangeStart: 11,
          holeRangeEnd: 18,
        },
      ],
    });

    // Team-only points: A 36 + B 36 + C 36 + D 20 = 128.
    // (D contributes par×10 holes = 2×10 = 20; D scored null on 11..18
    // so they don't appear in those holes' team totals — no double-count.)
    expect(result.teamScore).toBe(128);
    // Drawn player birdies × 8 holes (11..18) = 24.
    expect(result.blindDrawTotal).toBe(24);
    // Per-hole keys exist for 11..18 only.
    for (let h = 1; h <= 10; h++) {
      expect(result.blindDrawPerHole[h]).toBeUndefined();
    }
    for (let h = 11; h <= 18; h++) {
      expect(result.blindDrawPerHole[h]).toBe(3);
    }
  });
});
