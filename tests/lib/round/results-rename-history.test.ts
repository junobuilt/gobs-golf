// History-intact proof for the Admin Edit-Player-Name feature.
//
// round_players stores NO name column — every results surface joins to
// `players` by player_id and there is no name snapshot. So renaming a player
// must (a) make finalized rounds render the NEW name on next load and (b)
// leave the round's scores / gross totals completely untouched.
//
// This test drives the shared data layer (loadRoundResults) — the single
// source of names for /leaderboard and /round/[id]/summary. We rename a player
// in place (touching ONLY players.full_name, never round_players or scores),
// reload, and assert the new short name surfaces while grossTotal is unchanged.

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

// Finalized 2-ball round. Two players on team 1 with UNIQUE first names, each
// shooting 4 on every hole (gross 72). "Mike Williams" is the rename target.
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
    players: [
      { id: 201, full_name: "Mike Williams", display_name: "Mikey", handicap_index: 10, preferred_tee_id: 1, is_active: true },
      { id: 202, full_name: "Bob Brown", display_name: "Bob", handicap_index: 12, preferred_tee_id: 1, is_active: true },
    ],
    scores,
  };
}

async function loadTeam() {
  const outcome = await loadRoundResults(1);
  expect(outcome.status).toBe("ok");
  if (outcome.status !== "ok") throw new Error("load failed");
  return outcome.data.teams[0];
}

describe("loadRoundResults — rename leaves history intact", () => {
  beforeEach(() => {
    fakeRef.current = new FakeSupabase(seed());
  });

  it("renders the NEW name after a rename, with gross totals unchanged", async () => {
    // Before: unique first name → single initial.
    const before = await loadTeam();
    const mikeBefore = before.players.find((p) => p.playerId === 201)!;
    expect(mikeBefore.displayName).toBe("Mike W");
    expect(mikeBefore.grossTotal).toBe(72);

    // Rename in place — touch ONLY players.full_name. No round_players / scores
    // change, exactly like the admin UPDATE.
    fakeRef.current.data.players.find((p: any) => p.id === 201).full_name = "Michael Williams";

    const after = await loadTeam();
    const mikeAfter = after.players.find((p) => p.playerId === 201)!;
    // New name surfaces purely via the join-by-id path (no stale snapshot).
    expect(mikeAfter.displayName).toBe("Michael W");
    // History untouched: same gross total, scores intact.
    expect(mikeAfter.grossTotal).toBe(72);

    // The un-renamed teammate is unaffected.
    const bob = after.players.find((p) => p.playerId === 202)!;
    expect(bob.displayName).toBe("Bob B");
    expect(bob.grossTotal).toBe(72);
  });
});
