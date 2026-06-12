// Per-team handicap allowance OVERRIDE — through loadRoundResults (the engine).
//
// Proves the override changes ONLY the overridden team's net math, leaves the
// other team untouched, surfaces the effective allowance on TeamRow, and (for a
// blind draw) scores the fill under the RECEIVING team's effective allowance —
// NOT the fill player's own team's. Every expected value is hand-computed.
//
// Setup: one flight, 2-ball NET best-2, par-4 × 18, stroke_index = hole number.
// Every player has course_handicap 18 and shoots gross 4 on every hole.
//   • At 100% allowance: PH 18 → every hole gets 1 stroke → net 3/hole →
//     net strokes 54, net delta vs par −18.
//   • At 50% allowance:  PH 9  → holes SI 1–9 get a stroke (net 3), 10–18 net 4 →
//     net strokes 27 + 36 = 63, net delta −9.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { loadRoundResults } from "@/lib/round/results";

const HOLES = Array.from({ length: 18 }, (_, i) => ({
  id: i + 1, tee_id: 1, hole_number: i + 1, par: 4, yardage: 350, stroke_index: i + 1,
}));

// Two 2-player teams; pass a team-1 override (% or null).
function seedTwoTeams(team1Override: number | null): FakeData {
  const players = [201, 202, 203, 204].map(id => ({
    id, full_name: `P${id}`, display_name: `P${id}`, handicap_index: 18, preferred_tee_id: 1, is_active: true,
  }));
  const round_players = [
    { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 18, dropped_after_hole: null },
    { id: 102, round_id: 1, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 18, dropped_after_hole: null },
    { id: 103, round_id: 1, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 18, dropped_after_hole: null },
    { id: 104, round_id: 1, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 18, dropped_after_hole: null },
  ];
  const scores: any[] = [];
  let sId = 1;
  for (const rp of round_players) {
    for (let n = 1; n <= 18; n++) scores.push({ id: sId++, round_player_id: rp.id, hole_number: n, strokes: 4 });
  }
  const flight_teams: any[] = [
    { id: 1, flight_id: 10, round_id: 1, team_number: 1, handicap_allowance: team1Override },
    { id: 2, flight_id: 10, round_id: 1, team_number: 2, handicap_allowance: null },
  ];
  return {
    rounds: [{ id: 1, played_on: "2026-06-11", course_id: 1, is_complete: true, created_at: "2026-06-11T00:00:00Z" }],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes: HOLES,
    players,
    round_players,
    scores,
    flights: [
      { id: 10, round_id: 1, name: "Flight A", sort_order: 1, format: "2_ball",
        format_config: { scoring_basis: "net", best_n: 2, handicap_allowance: 100 }, format_locked_at: null },
    ],
    flight_teams,
  };
}

function okData(res: Awaited<ReturnType<typeof loadRoundResults>>): any {
  if (res.status !== "ok") throw new Error("expected ok, got " + res.status);
  return res.data;
}
function playerNet(data: any, teamId: number) {
  const team = data.teams.find((t: any) => t.id === teamId);
  return { netStrokes: team.players[0].netStrokes, netValue: team.players[0].netValue, eff: team.effectiveAllowance, overridden: team.allowanceOverridden };
}

describe("loadRoundResults — per-team allowance override (net math)", () => {
  it("NO override: both teams' players net under the flight's 100% (net strokes 54, delta −18)", async () => {
    fakeRef.current = new FakeSupabase(seedTwoTeams(null));
    const res = await loadRoundResults(1);
    const data = okData(res);
    const t1 = playerNet(data, 1);
    const t2 = playerNet(data, 2);
    expect(t1.netStrokes).toBe(54);
    expect(t1.netValue).toBe(-18);
    expect(t2.netStrokes).toBe(54);
    expect(t1.eff).toBe(100);
    expect(t1.overridden).toBe(false);
  });

  it("Team 1 overridden to 50%: its players net at 50% (63 / −9); Team 2 UNCHANGED (54 / −18)", async () => {
    fakeRef.current = new FakeSupabase(seedTwoTeams(50));
    const res = await loadRoundResults(1);
    const data = okData(res);
    const t1 = playerNet(data, 1);
    const t2 = playerNet(data, 2);
    // Overridden team reflects 50%.
    expect(t1.netStrokes).toBe(63);
    expect(t1.netValue).toBe(-9);
    expect(t1.eff).toBe(50);
    expect(t1.overridden).toBe(true);
    // Non-overridden team is byte-for-byte the same as the no-override case.
    expect(t2.netStrokes).toBe(54);
    expect(t2.netValue).toBe(-18);
    expect(t2.eff).toBe(100);
    expect(t2.overridden).toBe(false);
    // Net changed → rank follows: Team 2 (−36 team delta) now beats Team 1 (−18).
    expect(data.teams.find((t: any) => t.id === 2).rank).toBe(1);
    expect(data.teams.find((t: any) => t.id === 1).rank).toBe(2);
  });
});

// Blind-draw fill: short Team 1 (1 real player P1) draws P3 (rostered on Team 2)
// to fill to size 2. The fill's value must use the RECEIVING team (Team 1)'s
// effective allowance — NOT Team 2's (the fill player's own team's) flight 100%.
function seedBlindDraw(team1Override: number | null): FakeData {
  const players = [201, 203, 204].map(id => ({
    id, full_name: `P${id}`, display_name: `P${id}`, handicap_index: 18, preferred_tee_id: 1, is_active: true,
  }));
  const round_players = [
    { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 18, dropped_after_hole: null },
    { id: 103, round_id: 1, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 18, dropped_after_hole: null },
    { id: 104, round_id: 1, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 18, dropped_after_hole: null },
  ];
  const scores: any[] = [];
  let sId = 1;
  for (const rp of round_players) {
    for (let n = 1; n <= 18; n++) scores.push({ id: sId++, round_player_id: rp.id, hole_number: n, strokes: 4 });
  }
  return {
    rounds: [{ id: 1, played_on: "2026-06-11", course_id: 1, is_complete: true, created_at: "2026-06-11T00:00:00Z" }],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes: HOLES,
    players,
    round_players,
    scores,
    flights: [
      { id: 10, round_id: 1, name: "Flight A", sort_order: 1, format: "2_ball",
        format_config: { scoring_basis: "net", best_n: 2, handicap_allowance: 100 }, format_locked_at: null },
    ],
    flight_teams: [
      { id: 1, flight_id: 10, round_id: 1, team_number: 1, handicap_allowance: team1Override },
      { id: 2, flight_id: 10, round_id: 1, team_number: 2, handicap_allowance: null },
    ],
    blind_draws: [
      { id: 1, round_id: 1, short_team_number: 1, drawn_player_id: 203, hole_range_start: 1, hole_range_end: 18 },
    ],
  };
}

describe("loadRoundResults — blind-draw fill uses the RECEIVING team's effective allowance", () => {
  it("INHERIT (no override): fill scored at the flight's 100% → drawnPlayerNetValue −18", async () => {
    fakeRef.current = new FakeSupabase(seedBlindDraw(null));
    const res = await loadRoundResults(1);
    const data = okData(res);
    const fill = data.teams.find((t: any) => t.id === 1).blindDraws[0];
    expect(fill.drawnPlayerNetValue).toBe(-18);
  });

  it("OVERRIDE: receiving Team 1 at 50% scores the fill at 50% → −9 (NOT the fill player's own team's 100%)", async () => {
    fakeRef.current = new FakeSupabase(seedBlindDraw(50));
    const res = await loadRoundResults(1);
    const data = okData(res);
    const fill = data.teams.find((t: any) => t.id === 1).blindDraws[0];
    expect(fill.drawnPlayerNetValue).toBe(-9);
  });
});
