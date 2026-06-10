// F.1 — dedicated unit coverage for the EXTRACTED shared team-total helpers
// (src/lib/round/teamTotals.ts). These are the single definition of a team's
// headline total, called by BOTH loadRoundResults (detail) and loadRoundsList
// (History list). Tested here in isolation (pure functions, no Supabase) so a
// regression in the math surfaces directly — not only via the cross-loader
// parity test. Goldens are hand-derived from the rule; each has a negative
// control so the assertion can't pass on a no-op.

import { describe, it, expect } from "vitest";
import type { HoleInfo } from "@/lib/scoring";
import { buildTeamScoreMap, type TeamScoreRow } from "@/lib/round/teamScores";
import {
  buildEnginePerTeam,
  individualTeamTotal,
  teamCardScalars,
  type TeamEngineCache,
} from "@/lib/round/teamTotals";

const par4Holes = (): HoleInfo[] =>
  Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }));

describe("individualTeamTotal — the headline-total arithmetic", () => {
  // Pure function of the engine cache: total = teamScore + blindDrawTotal − teamPar.
  // Constructing the cache directly isolates the arithmetic from the engine.
  const cacheOf = (teamScore: number, teamParAtScored: number, blindDrawTotal: number): TeamEngineCache =>
    ({ engine: { teamScore, teamParAtScored, blindDrawTotal } as any, parByHole: {} });

  it("best-N: delta vs par (blindDrawTotal 0)", () => {
    expect(individualTeamTotal(cacheOf(70, 72, 0))).toEqual({ rawTeamScore: 70, teamPar: 72, total: -2 });
    // Negative control: a +1 round must NOT read as the −2 above.
    expect(individualTeamTotal(cacheOf(73, 72, 0)).total).toBe(1);
  });

  it("Stableford: teamPar 0 → total is points (incl. blind-draw points)", () => {
    expect(individualTeamTotal(cacheOf(31, 0, 2))).toEqual({ rawTeamScore: 31, teamPar: 0, total: 33 });
  });

  it("best-N with blind-draw accumulator folded in", () => {
    // teamScore 70, +1 blind-draw stroke effect, par 72 → −1.
    expect(individualTeamTotal(cacheOf(70, 72, 1)).total).toBe(-1);
  });
});

describe("buildEnginePerTeam + individualTeamTotal — end-to-end through the engine", () => {
  it("Best Ball, 1 player CH 0: one bogey → team total +1 (golden)", () => {
    const scores: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) scores[h] = h === 5 ? 5 : 4; // 17×4 + 1×5 = 73, par 72
    const teamMap = { 1: [{ id: 101, tee_id: 1, course_handicap: 0 }] };

    const cache = buildEnginePerTeam({
      format: "best_ball",
      formatConfig: { basis: "net", override_holes: [] } as any,
      teamMap,
      holesByTee: { 1: par4Holes() },
      scoresByRpId: { 101: scores },
      blindDrawRows: [],
      rps: teamMap[1],
      playerLookup: {},
    });

    const { rawTeamScore, teamPar, total } = individualTeamTotal(cache[1]);
    expect(rawTeamScore).toBe(73);
    expect(teamPar).toBe(72);
    expect(total).toBe(1);
  });

  it("an all-pars team reads E (0), not the bogey case above", () => {
    const scores: Record<number, number> = {};
    for (let h = 1; h <= 18; h++) scores[h] = 4; // even par
    const teamMap = { 1: [{ id: 201, tee_id: 1, course_handicap: 0 }] };
    const cache = buildEnginePerTeam({
      format: "best_ball",
      formatConfig: { basis: "net", override_holes: [] } as any,
      teamMap,
      holesByTee: { 1: par4Holes() },
      scoresByRpId: { 201: scores },
      blindDrawRows: [],
      rps: teamMap[1],
      playerLookup: {},
    });
    expect(individualTeamTotal(cache[1]).total).toBe(0);
  });
});

describe("teamCardScalars — NET team-card total (golden + gross≠net control)", () => {
  it("Texas Scramble: gross 80, team HCP 6 → net 74 → +2 vs par (NOT the +8 gross delta)", () => {
    // 14 holes of 4 (56) + 4 holes of 6 (24) = gross 80 over 18 par-4 holes.
    const rows: TeamScoreRow[] = Array.from({ length: 18 }, (_, i) => ({
      team_number: 1,
      hole_number: i + 1,
      ball_index: 1,
      strokes: i < 4 ? 6 : 4,
    }));
    const tsMap = buildTeamScoreMap(rows);

    // Members CH [10, 14] → Scramble 2p weights [.35,.15] asc: 10*.35 + 14*.15
    // = 5.6 → .5-up → 6. teamNet = 80 − 6 = 74. teamPar = 72. total = +2.
    const sc = teamCardScalars({
      format: "texas_scramble",
      teamNum: 1,
      teamPlayers: [{ course_handicap: 10 }, { course_handicap: 14 }],
      teamHoles: par4Holes(),
      tsMap,
    });

    expect(sc.rawTeamScore).toBe(80);
    expect(sc.teamPar).toBe(72);
    expect(sc.teamHandicap).toBe(6);
    expect(sc.teamNet).toBe(74);
    expect(sc.total).toBe(2); // NET delta
    // Negative control: the GROSS delta (80 − 72 = +8) must NOT be the headline.
    expect(sc.total).not.toBe(sc.rawTeamScore - sc.teamPar);
    expect(sc.thru).toBe(18);
  });
});
