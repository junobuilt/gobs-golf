// Phase 4 Commit C — self-serve safe teardown. deleteTournament calls the 035
// SECURITY DEFINER RPC (delete_tournament_cascade). The FakeSupabase models that
// RPC's leak-safe cascade (rounds-first, scoped to the tournament id). THE
// ISOLATION GUARANTEE: a league round + its scores MUST survive a teardown — the
// teardown can never reach a round it doesn't own.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { deleteTournament } from "@/lib/tournament/mutations";

// A LEAGUE round (900, tournament_id null) with a player + a score, AND a
// tournament (1) with a round (50), session, match, a player + a score, plus a
// point adjustment. Teardown must remove everything tournament-owned and leave
// the league round wholly intact.
function seed(): FakeData {
  return {
    rounds: [
      { id: 900, played_on: "2026-07-01", course_id: 1, tournament_id: null, season_id: 2, is_complete: true },
      { id: 50, played_on: "2026-08-01", course_id: 1, tournament_id: 1, season_id: null, is_complete: true },
    ],
    tees: [],
    holes: [],
    players: [
      { id: 1, full_name: "League Larry", display_name: "Larry", handicap_index: 10, is_active: true },
      { id: 2, full_name: "Cup Carl", display_name: "Carl", handicap_index: 10, is_active: true },
    ],
    round_players: [
      { id: 9001, round_id: 900, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
      { id: 5001, round_id: 50, player_id: 2, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
    ],
    scores: [
      { id: 70001, round_player_id: 9001, hole_number: 1, strokes: 4 }, // league score — must survive
      { id: 70002, round_player_id: 5001, hole_number: 1, strokes: 5 }, // tournament score — must die
    ],
    team_scores: [{ id: 80001, round_id: 50, team_number: 1, hole_number: 1, ball_index: 1, strokes: 5 }],
    tournaments: [{ id: 1, name: "Cup", is_active: true, is_published: true, started_on: "2026-08-01", side_a_name: "USA", side_b_name: "Canada", holder_side: "b", season_id: null, ended_on: null, notes: null }],
    tournament_players: [{ id: 1, tournament_id: 1, player_id: 2, side: "a" }],
    tournament_sessions: [{ id: 9, tournament_id: 1, round_id: 50, day_number: 1, name: "Day 1", format: "singles_match", played_on: "2026-08-01", is_locked: false }],
    tournament_matches: [{ id: 500, tournament_id: 1, session_id: 9, match_number: 1, group_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, flagged_hole: null, admin_note: null }],
    tournament_point_adjustments: [{ id: 1, tournament_id: 1, side: "a", points: 0.5, reason: "envelope", created_at: "2026-08-01T00:00:00Z" }],
  };
}

beforeEach(() => {
  fakeRef.current = new FakeSupabase(seed());
});

const D = () => fakeRef.current.data as FakeData;
const ids = (rows: any[] | undefined) => (rows ?? []).map((r) => r.id);

describe("deleteTournament — safe teardown via the RPC", () => {
  it("calls delete_tournament_cascade with the tournament id and returns its counts", async () => {
    const res = await deleteTournament(1);
    const call = fakeRef.current.rpcCalls.find((c: any) => c.name === "delete_tournament_cascade");
    expect(call).toBeTruthy();
    expect(call.args).toEqual({ p_tournament_id: 1 });
    expect(res).toEqual({ roundsDeleted: 1, tournamentDeleted: true });
  });

  it("removes the tournament and ALL its owned rows (rounds, scores, sessions, matches, players, adjustments)", async () => {
    await deleteTournament(1);
    expect(ids(D().tournaments)).not.toContain(1);
    expect(ids(D().rounds)).not.toContain(50);
    expect(ids(D().round_players)).not.toContain(5001);
    expect(ids(D().scores)).not.toContain(70002);
    expect(ids(D().team_scores)).not.toContain(80001);
    expect(ids(D().tournament_sessions)).not.toContain(9);
    expect(ids(D().tournament_matches)).not.toContain(500);
    expect(ids(D().tournament_players)).toHaveLength(0);
    expect(ids(D().tournament_point_adjustments)).toHaveLength(0);
  });

  it("ISOLATION: the league round and its scores survive untouched", async () => {
    await deleteTournament(1);
    // The league round is still present…
    expect(ids(D().rounds)).toContain(900);
    // …and was NOT orphaned (leak): it keeps tournament_id null, never re-owned.
    expect(D().rounds!.find((r) => r.id === 900)!.tournament_id).toBeNull();
    // Its player + score are intact.
    expect(ids(D().round_players)).toContain(9001);
    expect(ids(D().scores)).toContain(70001);
  });

  it("leak-safe: no tournament round is left orphaned with a NULL tournament_id", async () => {
    await deleteTournament(1);
    // The only remaining round is the pre-existing league one; the tournament's
    // round was DELETED, never SET NULL (the leak that ON DELETE SET NULL causes
    // if you delete the tournament first).
    expect(ids(D().rounds)).toEqual([900]);
  });
});
