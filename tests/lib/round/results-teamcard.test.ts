// Wave 1B C3a — loadRoundResults team-card branch (Shambles). Builds team rows
// from `team_scores` (not the per-player engine): team total = signed gross
// delta vs par, thru = holes scored, teamGrid = the team's hole-by-hole row,
// and `players` populated-but-score-less (holesPlayed 0). Includes a ranking
// negative control (teams seeded out of finishing order).

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

// All holes par 4 on tee 1. Two teams, seeded team-1-first but team 2 plays
// BETTER (so a correct ascending rank must reorder them).
//   Team 1: holes 1-2 = 6,6  → (12) − par(8)  = +4, thru 2
//   Team 2: holes 1-3 = 4,5,4 → (13) − par(12) = +1, thru 3
function seed(): FakeData {
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    holes.push({ id: n, tee_id: 1, hole_number: n, par: 4, yardage: 350, stroke_index: n });
  }
  return {
    rounds: [
      {
        id: 1,
        played_on: "2026-05-20",
        course_id: 1,
        is_complete: true,
        format: "shambles",
        format_config: { basis: "gross", scoring_basis: "gross", team_ball_count: 1, override_holes: [] },
        format_locked_at: "2026-05-20T00:00:00Z",
        created_at: "2026-05-20T00:00:00Z",
      },
    ],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes,
    round_players: [
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 10, dropped_after_hole: null },
      { id: 102, round_id: 1, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 12, dropped_after_hole: null },
      { id: 103, round_id: 1, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 8, dropped_after_hole: null },
      { id: 104, round_id: 1, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 14, dropped_after_hole: null },
    ],
    players: [
      { id: 201, full_name: "Alice A", display_name: "Alice A", handicap_index: 10, preferred_tee_id: 1, is_active: true },
      { id: 202, full_name: "Bob B", display_name: "Bob B", handicap_index: 12, preferred_tee_id: 1, is_active: true },
      { id: 203, full_name: "Carol C", display_name: "Carol C", handicap_index: 8, preferred_tee_id: 1, is_active: true },
      { id: 204, full_name: "Dan D", display_name: "Dan D", handicap_index: 14, preferred_tee_id: 1, is_active: true },
    ],
    scores: [], // team-card rounds have NO per-player scores
    team_scores: [
      { id: 1, round_id: 1, team_number: 1, hole_number: 1, ball_index: 1, strokes: 6 },
      { id: 2, round_id: 1, team_number: 1, hole_number: 2, ball_index: 1, strokes: 6 },
      { id: 3, round_id: 1, team_number: 2, hole_number: 1, ball_index: 1, strokes: 4 },
      { id: 4, round_id: 1, team_number: 2, hole_number: 2, ball_index: 1, strokes: 5 },
      { id: 5, round_id: 1, team_number: 2, hole_number: 3, ball_index: 1, strokes: 4 },
    ],
  };
}

describe("loadRoundResults — team-card (Shambles)", () => {
  beforeEach(() => {
    fakeRef.current = new FakeSupabase(seed());
  });

  it("builds team rows from team_scores with correct total / thru / teamGrid", async () => {
    const outcome = await loadRoundResults(1);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;

    const teams = outcome.data.teams;
    expect(teams).toHaveLength(2);

    const t2 = teams.find(t => t.id === 2)!;
    expect(t2.total).toBe(1); // 13 − 12
    expect(t2.rawTeamScore).toBe(13);
    expect(t2.teamPar).toBe(12);
    expect(t2.thru).toBe(3);
    // teamGrid: hole totals on 1-3, null thereafter; par all 4.
    expect(t2.teamGrid?.scores[0]).toBe(4);
    expect(t2.teamGrid?.scores[1]).toBe(5);
    expect(t2.teamGrid?.scores[2]).toBe(4);
    expect(t2.teamGrid?.scores[3]).toBeNull();
    expect(t2.teamGrid?.par[0]).toBe(4);

    const t1 = teams.find(t => t.id === 1)!;
    expect(t1.total).toBe(4); // 12 − 8
    expect(t1.thru).toBe(2);
  });

  it("ranks ascending by team total (negative control: seeded team-1-first)", async () => {
    const outcome = await loadRoundResults(1);
    if (outcome.status !== "ok") return;
    const ranked = outcome.data.teams;
    // Team 2 (+1) must outrank Team 1 (+4) despite being seeded second.
    expect(ranked[0].id).toBe(2);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].id).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });

  it("keeps players populated but score-less (roster for payout; excluded from rankings)", async () => {
    const outcome = await loadRoundResults(1);
    if (outcome.status !== "ok") return;
    const t2 = outcome.data.teams.find(t => t.id === 2)!;
    expect(t2.players).toHaveLength(2); // roster preserved → payout headcount works
    for (const p of t2.players) {
      expect(p.holesPlayed).toBe(0); // → excluded from cross-team Individual Rankings
      expect(p.scores.every(s => s === null)).toBe(true);
      expect(p.grossTotal).toBe(0);
    }
    expect(t2.blindDraws).toEqual([]);
  });
});
