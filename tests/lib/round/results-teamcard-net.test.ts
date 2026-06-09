// Phase 1C — loadRoundResults for the NET team-card formats (Texas Scramble /
// Alternate Shot). These flow through the team_scores branch: the team's gross
// is summed from team_scores, a single team-handicap deduction is applied
// (computeTeamHandicap on members' raw CHs), and teams rank by NET delta vs par.
//
// NEGATIVE CONTROL: the seed is ordered so the GROSS order (Team 1 lower gross)
// is the OPPOSITE of the NET order (Team 2 lower net, thanks to its bigger team
// handicap). A correct net ranking must reorder them — if the code ranked on
// gross (or skipped the handicap), Team 1 would wrongly rank first.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { loadRoundResults } from "@/lib/round/results";

// All 18 holes par 4 (team par = 72). Two teams of two.
//   Team 1 CHs [4, 8]  → Scramble 2p: 0.35*4 + 0.15*8  = 2.6  → HCP 3
//   Team 2 CHs [20,30] → Scramble 2p: 0.35*20 + 0.15*30 = 11.5 → HCP 12 (.5 up)
//   Team 1 gross: holes 1–9 all 4 (=36), holes 10–16 = 4, 17–18 = 5 (=38) → 74
//     net = 74 − 3 = 71; net delta = 71 − 72 = −1
//   Team 2 gross: holes 1–10 = 4 (=40), holes 11–18 = 5 (=40) → 80
//     net = 80 − 12 = 68; net delta = 68 − 72 = −4
//   GROSS order: Team 1 (74) < Team 2 (80). NET order: Team 2 (−4) < Team 1 (−1).
function seed(): FakeData {
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    holes.push({ id: n, tee_id: 1, hole_number: n, par: 4, yardage: 350, stroke_index: n });
  }

  const teamScores: any[] = [];
  let tsId = 1;
  for (let n = 1; n <= 18; n++) {
    const t1 = n <= 16 ? 4 : 5; // 16×4 + 2×5 = 74
    const t2 = n <= 10 ? 4 : 5; // 10×4 + 8×5 = 80
    teamScores.push({ id: tsId++, round_id: 1, team_number: 1, hole_number: n, ball_index: 1, strokes: t1 });
    teamScores.push({ id: tsId++, round_id: 1, team_number: 2, hole_number: n, ball_index: 1, strokes: t2 });
  }

  return {
    rounds: [
      {
        id: 1,
        played_on: "2026-06-09",
        course_id: 1,
        is_complete: true,
        format: "texas_scramble",
        format_config: { basis: "net", scoring_basis: "net", override_holes: [] },
        format_locked_at: "2026-06-09T00:00:00Z",
        created_at: "2026-06-09T00:00:00Z",
      },
    ],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes,
    round_players: [
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 4, dropped_after_hole: null },
      { id: 102, round_id: 1, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 8, dropped_after_hole: null },
      { id: 103, round_id: 1, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 20, dropped_after_hole: null },
      { id: 104, round_id: 1, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 30, dropped_after_hole: null },
    ],
    players: [
      { id: 201, full_name: "Alice A", display_name: "Alice A", handicap_index: 4, preferred_tee_id: 1, is_active: true },
      { id: 202, full_name: "Bob B", display_name: "Bob B", handicap_index: 8, preferred_tee_id: 1, is_active: true },
      { id: 203, full_name: "Carol C", display_name: "Carol C", handicap_index: 20, preferred_tee_id: 1, is_active: true },
      { id: 204, full_name: "Dan D", display_name: "Dan D", handicap_index: 30, preferred_tee_id: 1, is_active: true },
    ],
    scores: [], // team-card: no per-player scores
    team_scores: teamScores,
  };
}

describe("loadRoundResults — NET team-card (Texas Scramble)", () => {
  beforeEach(() => {
    fakeRef.current = new FakeSupabase(seed());
  });

  it("applies the team handicap as a single deduction and ranks by NET delta", async () => {
    const outcome = await loadRoundResults(1);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;

    const teams = outcome.data.teams;
    expect(teams).toHaveLength(2);

    const t1 = teams.find(t => t.id === 1)!;
    expect(t1.rawTeamScore).toBe(74); // gross unchanged
    expect(t1.teamHandicap).toBe(3);
    expect(t1.teamNet).toBe(71); // 74 − 3
    expect(t1.teamPar).toBe(72);
    expect(t1.total).toBe(-1); // net delta vs par

    const t2 = teams.find(t => t.id === 2)!;
    expect(t2.rawTeamScore).toBe(80);
    expect(t2.teamHandicap).toBe(12); // 11.5 rounds UP
    expect(t2.teamNet).toBe(68); // 80 − 12
    expect(t2.total).toBe(-4);
  });

  it("ranks ascending by net (negative control: seeded team-1-first, lower GROSS)", async () => {
    const outcome = await loadRoundResults(1);
    if (outcome.status !== "ok") return;
    const ranked = outcome.data.teams;
    // Team 2 wins on NET (−4) despite Team 1's lower GROSS (74 vs 80).
    expect(ranked[0].id).toBe(2);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].id).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });

  it("F9 / B9 legs stay GROSS (deduction is total-level only)", async () => {
    const outcome = await loadRoundResults(1);
    if (outcome.status !== "ok") return;
    const t1 = outcome.data.teams.find(t => t.id === 1)!;
    // Team 1 F9: holes 1–9 all 4 → gross 36 − par 36 = 0 (NOT net-adjusted).
    expect(t1.f9Total).toBe(0);
    // Team 1 B9: holes 10–16 = 4 (7×4=28), 17–18 = 5 (10) → 38 − par 36 = +2.
    expect(t1.b9Total).toBe(2);
    // The team grid carries the raw gross hole scores, not net.
    expect(t1.teamGrid?.scores[0]).toBe(4);
    expect(t1.teamGrid?.scores[16]).toBe(5);
  });
});
