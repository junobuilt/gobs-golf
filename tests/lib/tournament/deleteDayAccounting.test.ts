// Accounting: after a day is force-deleted (unpublished escape hatch), the cup's
// created-match count and totals must reflect the removed matches — no orphan
// counting. Runs the REAL loadDashboard + deriveCupBar before/after the delete
// (not a hand-built bar), so the drop is a projection of the canonical loader.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { loadDashboard } from "@/lib/tournament/loadDashboard";
import { deriveCupBar } from "@/lib/tournament/cup";
import { deleteSession } from "@/lib/tournament/mutations";

function holes(teeId = 1) {
  return Array.from({ length: 18 }, (_, i) => ({
    id: teeId * 100 + i + 1,
    tee_id: teeId,
    hole_number: i + 1,
    par: 4,
    stroke_index: i + 1,
    yardage: 300 + i * 10,
  }));
}
function gross(rpId: number, g: number, startId: number, upto = 18) {
  return Array.from({ length: upto }, (_, i) => ({ id: startId + i, round_player_id: rpId, hole_number: i + 1, strokes: g }));
}
function rp(id: number, roundId: number, playerId: number, team: number, ch: number) {
  return { id, round_id: roundId, player_id: playerId, team_number: team, tee_id: 1, course_handicap: ch, handicap_index_snapshot: ch };
}
function match(id: number, session_id: number, match_number: number, aTeam: number, bTeam: number) {
  return { id, tournament_id: 1, session_id, match_number, group_number: match_number, side_a_team_number: aTeam, side_b_team_number: bTeam, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, flagged_holes: [], admin_note: null, is_voided: false };
}

// UNPUBLISHED tournament, planned_match_total null (so the cup total tracks the
// created count). Two singles days: Day 1 (session 9, round 50) = M500 + M501;
// Day 2 (session 10, round 60) = M502 + M503. Both days fully scored.
const TOURN = {
  id: 1, name: "Cup", is_active: true, is_published: false, planned_match_total: null,
  started_on: "2026-08-01", side_a_name: "USA", side_b_name: "Canada", holder_side: "b",
  season_id: null, ended_on: null, notes: null,
};

function seed(): FakeData {
  return {
    rounds: [
      { id: 50, played_on: "2026-08-01", course_id: 1, tournament_id: 1, season_id: null },
      { id: 60, played_on: "2026-08-02", course_id: 1, tournament_id: 1, season_id: null },
    ],
    tees: [],
    holes: holes(1),
    players: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, full_name: `P${i + 1}`, display_name: `P${i + 1}`, handicap_index: 10, is_active: true })),
    round_players: [
      rp(101, 50, 1, 1, 10), rp(102, 50, 2, 2, 10),
      rp(103, 50, 3, 3, 10), rp(104, 50, 4, 4, 10),
      rp(201, 60, 5, 1, 10), rp(202, 60, 6, 2, 10),
      rp(203, 60, 7, 3, 10), rp(204, 60, 8, 4, 10),
    ],
    scores: [
      ...gross(101, 4, 1000), ...gross(102, 4, 1100), ...gross(103, 4, 1200), ...gross(104, 4, 1300),
      ...gross(201, 4, 2000), ...gross(202, 4, 2100), ...gross(203, 4, 2200), ...gross(204, 4, 2300),
    ],
    team_scores: [],
    tournaments: [TOURN],
    tournament_players: [],
    tournament_sessions: [
      { id: 9, tournament_id: 1, round_id: 50, day_number: 1, name: "Day 1", format: "singles_match", played_on: "2026-08-01", is_locked: false },
      { id: 10, tournament_id: 1, round_id: 60, day_number: 2, name: "Day 2", format: "singles_match", played_on: "2026-08-02", is_locked: false },
    ],
    tournament_matches: [match(500, 9, 1, 1, 2), match(501, 9, 2, 3, 4), match(502, 10, 1, 1, 2), match(503, 10, 2, 3, 4)],
    tournament_point_adjustments: [],
  };
}

beforeEach(() => {
  fakeRef.current = new FakeSupabase(seed());
});

describe("force-deleting a day — cup accounting", () => {
  it("createdCount + cup total drop by the removed day's matches, with no orphan counting", async () => {
    const before = deriveCupBar(await loadDashboard(1), TOURN as any);
    expect(before.createdCount).toBe(4);
    expect(before.total).toBe(4); // planned null → total tracks created
    expect(before.toWin).toBe(2.5);

    // Force-delete Day 1 (2 matches).
    const res = await deleteSession(9, { allowScores: true });
    expect(res).toEqual({ roundDeleted: true });

    const dashboard = await loadDashboard(1);
    const after = deriveCupBar(dashboard, TOURN as any);
    expect(after.createdCount).toBe(2);
    expect(after.total).toBe(2);
    expect(after.toWin).toBe(1.5);

    // The removed matches are gone entirely — not counted as orphans anywhere.
    const remaining = dashboard.days.flatMap((d) => d.matches).map((m) => m.match.id).sort((a, b) => a - b);
    expect(remaining).toEqual([502, 503]);
  });
});
