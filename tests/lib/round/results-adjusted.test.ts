// Wave 1A — verifies loadRoundResults populates PlayerRow.adjScores with
// Net-Double-Bogey-capped per-hole scores (the data feeding the summary /
// leaderboard PlayerHoleGrid Adj column). Expected values are computed from
// the rule, not snapshotted from app output, and include a negative control.

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

// One player, CH=9 (→ 1 stroke on SI 1..9, 0 on SI 10..18; caps: F9 holes 7,
// B9 holes 6). All holes par 4, stroke_index = hole number. Hole 10 (SI 10) is
// a blow-up 9 that caps to 6; every other hole is an even par 4 (under cap).
function seed(): FakeData {
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    holes.push({ id: n, tee_id: 1, hole_number: n, par: 4, yardage: 350, stroke_index: n });
  }
  const scores = [];
  let sid = 1;
  for (let n = 1; n <= 18; n++) {
    scores.push({ id: sid++, round_player_id: 101, hole_number: n, strokes: n === 10 ? 9 : 4 });
  }
  return {
    rounds: [
      {
        id: 1,
        played_on: "2026-05-13",
        course_id: 1,
        is_complete: true,
        format: "2_ball",
        format_config: { basis: "net", best_n: 2, override_holes: [] },
        format_locked_at: "2026-05-13T00:00:00Z",
        created_at: "2026-05-13T00:00:00Z",
      },
    ],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes,
    round_players: [
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 9, dropped_after_hole: null },
    ],
    players: [
      { id: 201, full_name: "Cap Tester", display_name: "Cap", handicap_index: 9, preferred_tee_id: 1, is_active: true },
    ],
    scores,
  };
}

const sum = (a: (number | null)[]) =>
  a.reduce((t: number, v) => t + (v ?? 0), 0);

describe("loadRoundResults — GHIN adjusted scores", () => {
  beforeEach(() => {
    fakeRef.current = new FakeSupabase(seed());
  });

  it("caps the blow-up hole and leaves the rest untouched", async () => {
    const outcome = await loadRoundResults(1);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;

    const player = outcome.data.teams[0].players[0];

    // Hole 10 (index 9): actual 9, cap = 4 + 2 + 0 = 6 → adjusted 6.
    expect(player.scores[9]).toBe(9);
    expect(player.adjScores[9]).toBe(6);
    // Hole 1 (index 0): actual 4, cap = 4 + 2 + 1 = 7 → unchanged.
    expect(player.adjScores[0]).toBe(4);

    const actualTotal = sum(player.scores); // 17×4 + 9 = 77
    const adjTotal = sum(player.adjScores); // 17×4 + 6 = 74
    expect(actualTotal).toBe(77);
    expect(adjTotal).toBe(74);

    // NEGATIVE CONTROL: adjScores must not merely mirror scores.
    expect(adjTotal).not.toBe(actualTotal);
    // Exactly one hole changed.
    expect(player.adjScores.filter((v, i) => v !== player.scores[i]).length).toBe(1);
  });
});
