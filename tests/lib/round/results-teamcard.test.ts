// Wave 1B follow-up — loadRoundResults for the REBUILT Shambles (individual
// best-ball NET, relaxed close). Shambles left the team-card spine: it now flows
// through the per-player engine branch, NOT the team_scores branch. This test
// proves loadRoundResults builds team rows from per-player `scores` (best-1 net
// per hole), tolerates a picked-up player (relaxed close: best-available), ranks
// ascending, and IGNORES the `team_scores` table entirely.
//
// NEGATIVE CONTROL: the seed carries bogus `team_scores` (all 9s). If
// loadRoundResults wrongly still read them, team totals would blow up — the
// assertions below (driven by the per-player scores) would fail.

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

// All holes par 4 on tee 1, stroke_index = hole number. Course handicaps are 0
// so net == gross (net-flip behavior is covered by the engine-shambles unit
// test). Count-1 (best single net ball per hole). Seeded team-1-first but team 2
// finishes BETTER, so a correct ascending rank must reorder them.
//   Team 1: h1 best(5,4)=4, h2 best(6,7)=6 → raw 10, par 8 → +2, thru 2
//   Team 2: h1 best(4,5)=4, h2 best(4,5)=4, h3 best-available(4)=4 (p104 picked
//           up) → raw 12, par 12 → E, thru 2 (h3 has one scorer)
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
        format_config: { basis: "net", scoring_basis: "net", team_ball_count: 1, override_holes: [] },
        format_locked_at: "2026-05-20T00:00:00Z",
        created_at: "2026-05-20T00:00:00Z",
      },
    ],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes,
    round_players: [
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
      { id: 102, round_id: 1, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
      { id: 103, round_id: 1, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 0, dropped_after_hole: null },
      { id: 104, round_id: 1, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 0, dropped_after_hole: null },
    ],
    players: [
      { id: 201, full_name: "Alice A", display_name: "Alice A", handicap_index: 0, preferred_tee_id: 1, is_active: true },
      { id: 202, full_name: "Bob B", display_name: "Bob B", handicap_index: 0, preferred_tee_id: 1, is_active: true },
      { id: 203, full_name: "Carol C", display_name: "Carol C", handicap_index: 0, preferred_tee_id: 1, is_active: true },
      { id: 204, full_name: "Dan D", display_name: "Dan D", handicap_index: 0, preferred_tee_id: 1, is_active: true },
    ],
    // Per-player scores (Shambles is individual now). Player 104 picked up after
    // hole 2 → no hole-3 score (relaxed close).
    scores: [
      { id: 1, round_player_id: 101, hole_number: 1, strokes: 5 },
      { id: 2, round_player_id: 101, hole_number: 2, strokes: 6 },
      { id: 3, round_player_id: 102, hole_number: 1, strokes: 4 },
      { id: 4, round_player_id: 102, hole_number: 2, strokes: 7 },
      { id: 5, round_player_id: 103, hole_number: 1, strokes: 4 },
      { id: 6, round_player_id: 103, hole_number: 2, strokes: 4 },
      { id: 7, round_player_id: 103, hole_number: 3, strokes: 4 },
      { id: 8, round_player_id: 104, hole_number: 1, strokes: 5 },
      { id: 9, round_player_id: 104, hole_number: 2, strokes: 5 },
    ],
    // Bogus team_scores — must be IGNORED by the rebuilt (individual) Shambles.
    team_scores: [
      { id: 1, round_id: 1, team_number: 1, hole_number: 1, ball_index: 1, strokes: 9 },
      { id: 2, round_id: 1, team_number: 2, hole_number: 1, ball_index: 1, strokes: 9 },
    ],
  };
}

describe("loadRoundResults — Shambles (rebuilt: individual best-ball net)", () => {
  beforeEach(() => {
    fakeRef.current = new FakeSupabase(seed());
  });

  it("builds team totals from per-player best-1 net (ignoring team_scores)", async () => {
    const outcome = await loadRoundResults(1);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;

    const teams = outcome.data.teams;
    expect(teams).toHaveLength(2);

    const t2 = teams.find(t => t.id === 2)!;
    expect(t2.rawTeamScore).toBe(12); // 4 + 4 + 4 (NOT 9s from team_scores)
    expect(t2.teamPar).toBe(12);
    expect(t2.total).toBe(0);

    const t1 = teams.find(t => t.id === 1)!;
    expect(t1.rawTeamScore).toBe(10); // 4 + 6
    expect(t1.teamPar).toBe(8);
    expect(t1.total).toBe(2);
  });

  it("relaxed close: a hole with one picked-up player still scores (best-available)", async () => {
    const outcome = await loadRoundResults(1);
    if (outcome.status !== "ok") return;
    const t2 = outcome.data.teams.find(t => t.id === 2)!;
    // Hole 3 counted via Carol's lone score (Dan picked up) → raw includes it.
    expect(t2.rawTeamScore).toBe(12);
  });

  it("ranks ascending by net total (negative control: seeded team-1-first)", async () => {
    const outcome = await loadRoundResults(1);
    if (outcome.status !== "ok") return;
    const ranked = outcome.data.teams;
    expect(ranked[0].id).toBe(2); // E beats +2
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].id).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });

  it("players carry their own scores + holesPlayed (feeds Individual Rankings)", async () => {
    const outcome = await loadRoundResults(1);
    if (outcome.status !== "ok") return;
    const t2 = outcome.data.teams.find(t => t.id === 2)!;
    const carol = t2.players.find(p => p.rpId === 103)!;
    const dan = t2.players.find(p => p.rpId === 104)!;
    expect(carol.holesPlayed).toBe(3);
    expect(dan.holesPlayed).toBe(2); // picked up after hole 2
    expect(carol.scores[2]).toBe(4); // hole 3 present
    expect(dan.scores[2]).toBeNull(); // hole 3 absent
    expect(t2.blindDraws).toEqual([]); // no blind draws for Shambles
  });
});
