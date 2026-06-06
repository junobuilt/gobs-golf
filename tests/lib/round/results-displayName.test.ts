// Verifies the shared round-results data layer (loadRoundResults) emits
// disambiguating short names ("Wayne H" / "Wayne V") for team rosters and
// per-player rows. This is the single source of names for both /leaderboard
// and /round/[id]/summary (via RoundResultsView), so one test covers both.

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

// Two Waynes on one team, plus a third active player who is NOT in the round —
// present only to prove the disambiguation universe is the full active roster.
function seed(): FakeData {
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    holes.push({ id: n, tee_id: 1, hole_number: n, par: 4, yardage: 350, stroke_index: n });
  }
  const scores = [];
  let sid = 1;
  for (const rpId of [101, 102]) {
    for (let n = 1; n <= 18; n++) {
      scores.push({ id: sid++, round_player_id: rpId, hole_number: n, strokes: 4 });
    }
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
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 10, dropped_after_hole: null },
      { id: 102, round_id: 1, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 12, dropped_after_hole: null },
    ],
    // display_name nicknames are intentionally "Wayne" for both — the helper
    // must ignore them and derive from full_name.
    players: [
      { id: 201, full_name: "Wayne Hashimoto", display_name: "Wayne", handicap_index: 10, preferred_tee_id: 1, is_active: true },
      { id: 202, full_name: "Wayne Vincent", display_name: "Wayne", handicap_index: 12, preferred_tee_id: 1, is_active: true },
      { id: 203, full_name: "Bill Carlson", display_name: "Bill", handicap_index: 8, preferred_tee_id: 1, is_active: true },
    ],
    scores,
  };
}

describe("loadRoundResults — disambiguating player names", () => {
  beforeEach(() => {
    fakeRef.current = new FakeSupabase(seed());
  });

  it("renders rosterDisplay and per-player names with minimum suffix", async () => {
    const outcome = await loadRoundResults(1);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;

    const team = outcome.data.teams[0];
    expect(team.rosterDisplay).toBe("Wayne H · Wayne V");

    const names = team.players.map((p) => p.displayName).sort();
    expect(names).toEqual(["Wayne H", "Wayne V"]);
  });
});
