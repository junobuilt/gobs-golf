// Flights Track, Session 3 — loadRoundResults on a TWO-FLIGHT round with
// DIFFERENT formats. Proves:
//   * per-flight team rankings (each flight ranked under its own format),
//   * the additive flightSections shape (ordered by sort_order; teams tagged),
//   * the mixed-format round-wide Individual Rankings rule: when the non-empty
//     flights have differing formats, EVERY individual-format player is ranked
//     by NET STROKES — including the Stableford flight's players, whose points
//     do NOT drive this list — each under their own flight's allowance.
//
// All expected values are computed BY HAND in the fixture comments below, never
// read back from the engine. Every player has course_handicap 0, so playing CH
// is 0 and net strokes == gross total — the net-stroke ordering is transparent.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { loadRoundResults } from "@/lib/round/results";
import { loadRoundsList } from "@/lib/round/loadRoundsList";

// 18 holes, par 4, stroke_index = hole number. Two flights:
//   Flight A (sort 1) = 2_ball (best-2, net): Team 1 {Alice,Bob}, Team 2 {Eve,Frank}
//   Flight B (sort 2) = gobs_stableford:      Team 3 {Carol,Dan}, Team 4 {Grace,Henry}
//
// Gross totals (CH 0 → net strokes == gross):
//   Alice  201  all 4                       → 72
//   Bob    202  holes 1–4 = 3, rest 4       → 68   (4 birdies)
//   Eve    205  all 4                       → 72
//   Frank  206  all 4                       → 72
//   Carol  203  all 4                       → 72
//   Dan    204  holes 1–3 = 3, rest 4       → 69   (3 birdies)
//   Grace  207  all 4                       → 72
//   Henry  208  all 5                       → 90   (all bogeys)
//
// Flight A team net deltas (best-2 of 2 = both): Team 1 = 0 + (−4) = −4;
//   Team 2 = 0. → Team 1 ranks 1st, Team 2 2nd.
// Flight B (points, higher wins): Team 3 has 3 birdies, Team 4 has 18 bogeys →
//   Team 3 ranks 1st, Team 4 2nd.
//
// Mixed formats (2_ball ≠ gobs_stableford) → Individual Rankings mode
// "net_strokes", ascending by net strokes (= gross here):
//   1 Bob 68 · 2 Dan 69 · 3 (tie) Alice/Eve/Frank/Carol/Grace 72 · 8 Henry 90
//   (skip-tie: five at rank 3 → Henry is rank 8). Bob (flight A) then Dan
//   (flight B Stableford) lead — the Stableford player ranks by STROKES, not pts.
function seed(): FakeData {
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    holes.push({ id: n, tee_id: 1, hole_number: n, par: 4, yardage: 350, stroke_index: n });
  }

  const players = [
    { id: 201, full_name: "Alice A", display_name: "Alice A", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    { id: 202, full_name: "Bob B", display_name: "Bob B", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    { id: 205, full_name: "Eve E", display_name: "Eve E", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    { id: 206, full_name: "Frank F", display_name: "Frank F", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    { id: 203, full_name: "Carol C", display_name: "Carol C", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    { id: 204, full_name: "Dan D", display_name: "Dan D", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    { id: 207, full_name: "Grace G", display_name: "Grace G", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    { id: 208, full_name: "Henry H", display_name: "Henry H", handicap_index: 0, preferred_tee_id: 1, is_active: true },
  ];

  const round_players = [
    { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
    { id: 102, round_id: 1, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
    { id: 105, round_id: 1, player_id: 205, tee_id: 1, team_number: 2, course_handicap: 0, dropped_after_hole: null },
    { id: 106, round_id: 1, player_id: 206, tee_id: 1, team_number: 2, course_handicap: 0, dropped_after_hole: null },
    { id: 103, round_id: 1, player_id: 203, tee_id: 1, team_number: 3, course_handicap: 0, dropped_after_hole: null },
    { id: 104, round_id: 1, player_id: 204, tee_id: 1, team_number: 3, course_handicap: 0, dropped_after_hole: null },
    { id: 107, round_id: 1, player_id: 207, tee_id: 1, team_number: 4, course_handicap: 0, dropped_after_hole: null },
    { id: 108, round_id: 1, player_id: 208, tee_id: 1, team_number: 4, course_handicap: 0, dropped_after_hole: null },
  ];

  // Per-player gross: rpId → (holeNumber → strokes). CH 0 throughout.
  const grossByRp: Record<number, (n: number) => number> = {
    101: () => 4,                       // Alice 72
    102: (n) => (n <= 4 ? 3 : 4),       // Bob 68
    105: () => 4,                       // Eve 72
    106: () => 4,                       // Frank 72
    103: () => 4,                       // Carol 72
    104: (n) => (n <= 3 ? 3 : 4),       // Dan 69
    107: () => 4,                       // Grace 72
    108: () => 5,                       // Henry 90
  };
  const scores: any[] = [];
  let sId = 1;
  for (const rp of round_players) {
    for (let n = 1; n <= 18; n++) {
      scores.push({ id: sId++, round_player_id: rp.id, hole_number: n, strokes: grossByRp[rp.id](n) });
    }
  }

  return {
    rounds: [{ id: 1, played_on: "2026-06-11", course_id: 1, is_complete: true, created_at: "2026-06-11T00:00:00Z" }],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes,
    players,
    round_players,
    scores,
    flights: [
      { id: 10, round_id: 1, name: "Flight A", sort_order: 1, format: "2_ball",
        format_config: { scoring_basis: "net", best_n: 2 }, format_locked_at: null },
      { id: 20, round_id: 1, name: "Flight B", sort_order: 2, format: "gobs_stableford",
        format_config: { scoring_basis: "net" }, format_locked_at: null },
    ],
    flight_teams: [
      { id: 1, flight_id: 10, round_id: 1, team_number: 1 },
      { id: 2, flight_id: 10, round_id: 1, team_number: 2 },
      { id: 3, flight_id: 20, round_id: 1, team_number: 3 },
      { id: 4, flight_id: 20, round_id: 1, team_number: 4 },
    ],
  };
}

beforeEach(() => { fakeRef.current = new FakeSupabase(seed()); });

describe("loadRoundResults — two flights, differing formats", () => {
  it("builds one ordered section per flight, ranked within the flight", async () => {
    const outcome = await loadRoundResults(1);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    const { flightSections } = outcome.data;

    expect(flightSections).toHaveLength(2);

    const [a, b] = flightSections;
    expect(a).toMatchObject({ flightId: 10, flightName: "Flight A", format: "2_ball" });
    expect(b).toMatchObject({ flightId: 20, flightName: "Flight B", format: "gobs_stableford" });

    // Flight A: Team 1 (−4) beats Team 2 (0).
    expect(a.teams.map(t => t.id)).toEqual([1, 2]);
    expect(a.teams[0]).toMatchObject({ id: 1, rank: 1 });
    expect(a.teams[1]).toMatchObject({ id: 2, rank: 2 });

    // Flight B: Team 3 (more points) beats Team 4.
    expect(b.teams.map(t => t.id)).toEqual([3, 4]);
    expect(b.teams[0]).toMatchObject({ id: 3, rank: 1 });
    expect(b.teams[1]).toMatchObject({ id: 4, rank: 2 });

    // Every team is tagged with its flight; ranks repeat per flight (two rank-1s).
    expect(outcome.data.teams.filter(t => t.rank === 1).map(t => t.id).sort()).toEqual([1, 3]);
    for (const t of a.teams) expect(t.flightId).toBe(10);
    for (const t of b.teams) expect(t.flightId).toBe(20);
  });

  it("Individual Rankings: mixed formats ⇒ net_strokes mode, Stableford players ranked by STROKES", async () => {
    const outcome = await loadRoundResults(1);
    if (outcome.status !== "ok") return;
    const { individualRankings: ir, individualRankingsMode } = outcome.data;

    expect(individualRankingsMode).toBe("net_strokes");
    expect(ir).toHaveLength(8);

    // Order + net strokes are hand-computed (CH 0 → net strokes == gross).
    expect(ir[0]).toMatchObject({ playerId: 202, netStrokes: 68, rank: 1 }); // Bob (flight A)
    expect(ir[1]).toMatchObject({ playerId: 204, netStrokes: 69, rank: 2 }); // Dan (flight B, Stableford!)

    // Five players tie at 72 → all rank 3 (skip-tie); Henry (90) is rank 8.
    const at72 = ir.filter(r => r.netStrokes === 72);
    expect(at72.map(r => r.playerId).sort((x, y) => x - y)).toEqual([201, 203, 205, 206, 207]);
    expect(at72.every(r => r.rank === 3)).toBe(true);

    const henry = ir.find(r => r.playerId === 208)!;
    expect(henry).toMatchObject({ netStrokes: 90, rank: 8 });

    // The Stableford players appear here by NET STROKES, not points: Dan (flight
    // B) is 2nd overall on 69 strokes even though points would order differently.
    expect(ir.find(r => r.playerId === 204)!.flightId).toBe(20);
  });
});

describe("cross-surface agreement (Flights S3)", () => {
  it("History list sections === results flightSections (same teams per flight, EQUAL)", async () => {
    const results = await loadRoundResults(1);
    if (results.status !== "ok") return;
    const list = await loadRoundsList();
    const row = list.find(r => r.roundId === 1)!;

    // Same number of sections, same flight identity + order, same team sets +
    // ranks — the History row is a projection of the SAME flightSections.
    expect(row.sections.map(s => s.flightId)).toEqual(
      results.data.flightSections.map(s => s.flightId),
    );
    for (let i = 0; i < row.sections.length; i++) {
      const ls = row.sections[i];
      const rs = results.data.flightSections[i];
      expect(ls.flightName).toBe(rs.flightName);
      expect(ls.format).toBe(rs.format);
      expect(ls.teams.map(t => [t.teamNumber, t.rank])).toEqual(
        rs.teams.map(t => [t.id, t.rank]),
      );
    }
  });
});

// Flights S4 — CROSS-FLIGHT blind-draw display. A short team in flight A is
// filled by a player drawn from flight B; the fill's value must be computed
// under the RECEIVING flight's (A) format + allowance, NOT the source flight's.
// Flight A = 2_ball @ 100%, Flight B = 2_ball @ 50%. The drawn player (Dan, CH
// 10, all pars, SI = hole) nets −10 under A's 100% (PH 10 → a stroke on holes
// SI 1..10: 10×net-3 + 8×net-4 = 62 vs par 72), but would net −5 under B's 50%
// (PH 5). The pill must read −10, proving the receiving-flight recompute.
function seedCrossFlightDraw(): FakeData {
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    holes.push({ id: n, tee_id: 1, hole_number: n, par: 4, yardage: 350, stroke_index: n });
  }
  const players = [
    { id: 201, full_name: "Alice A", display_name: "Alice A", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    { id: 202, full_name: "Bob B", display_name: "Bob B", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    { id: 203, full_name: "Carol C", display_name: "Carol C", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    { id: 204, full_name: "Dan D", display_name: "Dan D", handicap_index: 10, preferred_tee_id: 1, is_active: true },
    { id: 205, full_name: "Eve E", display_name: "Eve E", handicap_index: 0, preferred_tee_id: 1, is_active: true },
  ];
  // Flight A: Team 1 = {Alice} (SHORT — 1 player vs flight-A max 2), Team 2 =
  // {Bob, Carol}. Flight B: Team 3 = {Dan, Eve}. Team 1 drew Dan (cross-flight).
  const round_players = [
    { id: 101, round_id: 2, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
    { id: 102, round_id: 2, player_id: 202, tee_id: 1, team_number: 2, course_handicap: 0, dropped_after_hole: null },
    { id: 103, round_id: 2, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 0, dropped_after_hole: null },
    { id: 104, round_id: 2, player_id: 204, tee_id: 1, team_number: 3, course_handicap: 10, dropped_after_hole: null },
    { id: 105, round_id: 2, player_id: 205, tee_id: 1, team_number: 3, course_handicap: 0, dropped_after_hole: null },
  ];
  const scores: any[] = [];
  let sId = 1;
  for (const rp of round_players) {
    for (let n = 1; n <= 18; n++) scores.push({ id: sId++, round_player_id: rp.id, hole_number: n, strokes: 4 });
  }
  return {
    rounds: [{ id: 2, played_on: "2026-06-11", course_id: 1, is_complete: true, created_at: "2026-06-11T00:00:00Z" }],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes, players, round_players, scores,
    flights: [
      { id: 10, round_id: 2, name: "Flight A", sort_order: 1, format: "2_ball",
        format_config: { scoring_basis: "net", best_n: 2, handicap_allowance: 100 }, format_locked_at: null },
      { id: 20, round_id: 2, name: "Flight B", sort_order: 2, format: "2_ball",
        format_config: { scoring_basis: "net", best_n: 2, handicap_allowance: 50 }, format_locked_at: null },
    ],
    flight_teams: [
      { id: 1, flight_id: 10, round_id: 2, team_number: 1 },
      { id: 2, flight_id: 10, round_id: 2, team_number: 2 },
      { id: 3, flight_id: 20, round_id: 2, team_number: 3 },
    ],
    blind_draws: [
      { id: 1, round_id: 2, short_team_number: 1, drawn_player_id: 204,
        hole_range_start: 1, hole_range_end: 18, random_seed: 123 },
    ],
  };
}

describe("cross-flight blind draw fill (Flights S4)", () => {
  it("fill value uses the RECEIVING flight's allowance (−10 @ A's 100%, not −5 @ B's 50%)", async () => {
    fakeRef.current = new FakeSupabase(seedCrossFlightDraw());
    const outcome = await loadRoundResults(2);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;

    const flightA = outcome.data.flightSections.find(s => s.flightId === 10)!;
    const team1 = flightA.teams.find(t => t.id === 1)!;
    expect(team1.blindDraws).toHaveLength(1);
    const fill = team1.blindDraws[0];
    expect(fill.drawnPlayerName).toBe("Dan D");
    expect(fill.fromTeamNumber).toBe(3);          // Dan's own (flight B) team
    expect(fill.drawnPlayerNetValue).toBe(-10);   // receiving A @ 100% (NOT −5)
  });
});
