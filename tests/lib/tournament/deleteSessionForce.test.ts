// Self-serve "Delete Day" for UNPUBLISHED tournaments (partial R3). deleteSession
// gains an opt-in escape hatch: { allowScores: true } force-deletes a sandbox day
// even WITH scores, but only after re-verifying — server-side, in the mutation —
// that the tournament is unpublished, the round is tournament-owned (never a
// league round), and no sibling session shares the round. The whole day then goes
// via ONE atomic cascading `rounds` delete (FK cascade, mig 032). The published
// guard (SessionHasScoresError) is unchanged.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import {
  deleteSession,
  NotTournamentRoundError,
  SessionHasScoresError,
  SharedRoundError,
  TournamentPublishedError,
} from "@/lib/tournament/mutations";

// Unpublished tournament (1) with TWO days:
//   Day 1 (session 9, round 50) — WITH scores + team_score + 2 matches + a day-side. TARGET.
//   Day 2 (session 10, round 51) — WITH a score + a match + a day-side. MUST SURVIVE.
// Plus a LEAGUE round (901, tournament_id null) reached by an anomalous session 11
// (round_id points at the league round) — the league guard must abort on it.
function seed(): FakeData {
  return {
    rounds: [
      { id: 50, played_on: "2026-08-01", course_id: 1, tournament_id: 1, season_id: null, is_complete: false },
      { id: 51, played_on: "2026-08-02", course_id: 1, tournament_id: 1, season_id: null, is_complete: false },
      { id: 901, played_on: "2026-07-01", course_id: 1, tournament_id: null, season_id: 2, is_complete: true },
    ],
    tees: [],
    holes: [],
    players: [
      { id: 2, full_name: "Cup Carl", display_name: "Carl", handicap_index: 10, is_active: true },
      { id: 3, full_name: "Cup Cathy", display_name: "Cathy", handicap_index: 12, is_active: true },
      { id: 1, full_name: "League Larry", display_name: "Larry", handicap_index: 10, is_active: true },
    ],
    round_players: [
      { id: 5001, round_id: 50, player_id: 2, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
      { id: 5002, round_id: 50, player_id: 3, team_number: 2, tee_id: 1, course_handicap: 12, handicap_index_snapshot: 12 },
      { id: 5101, round_id: 51, player_id: 2, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
      { id: 9011, round_id: 901, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
    ],
    scores: [
      { id: 70001, round_player_id: 5001, hole_number: 1, strokes: 4 }, // day1 — dies
      { id: 70002, round_player_id: 5002, hole_number: 1, strokes: 5 }, // day1 — dies
      { id: 70101, round_player_id: 5101, hole_number: 1, strokes: 4 }, // day2 — survives
      { id: 79011, round_player_id: 9011, hole_number: 1, strokes: 4 }, // league — survives
    ],
    team_scores: [{ id: 80001, round_id: 50, team_number: 1, hole_number: 1, ball_index: 1, strokes: 5 }],
    tournaments: [
      { id: 1, name: "Cup", is_active: true, is_published: false, started_on: "2026-08-01", side_a_name: "USA", side_b_name: "Canada", holder_side: "b", season_id: null, ended_on: null, notes: null },
    ],
    tournament_players: [],
    tournament_sessions: [
      { id: 9, tournament_id: 1, round_id: 50, day_number: 1, name: "Day 1", format: "four_ball_match", played_on: "2026-08-01", is_locked: false },
      { id: 10, tournament_id: 1, round_id: 51, day_number: 2, name: "Day 2", format: "singles_match", played_on: "2026-08-02", is_locked: false },
      { id: 11, tournament_id: 1, round_id: 901, day_number: 3, name: "Day 3", format: "singles_match", played_on: "2026-07-01", is_locked: false },
    ],
    tournament_matches: [
      { id: 500, tournament_id: 1, session_id: 9, match_number: 1, group_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, flagged_holes: [], admin_note: null },
      { id: 501, tournament_id: 1, session_id: 9, match_number: 2, group_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, flagged_holes: [], admin_note: null },
      { id: 510, tournament_id: 1, session_id: 10, match_number: 1, group_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, flagged_holes: [], admin_note: null },
    ],
    tournament_point_adjustments: [],
    tournament_day_sides: [
      { id: 6001, tournament_id: 1, session_id: 9, player_id: 2, side: "a", created_at: "2026-08-01T00:00:00Z" },
      { id: 6002, tournament_id: 1, session_id: 10, player_id: 2, side: "a", created_at: "2026-08-02T00:00:00Z" },
    ],
  };
}

beforeEach(() => {
  fakeRef.current = new FakeSupabase(seed());
});

const D = () => fakeRef.current.data as FakeData;
const ids = (rows: any[] | undefined) => (rows ?? []).map((r) => r.id);

describe("deleteSession — unpublished escape hatch ({ allowScores: true })", () => {
  it("full cascade: unpublished day WITH scores → day/round/players/scores/matches/day-sides all gone", async () => {
    const res = await deleteSession(9, { allowScores: true });
    expect(res).toEqual({ roundDeleted: true });

    // Day 1 wiped entirely.
    expect(ids(D().rounds)).not.toContain(50);
    expect(ids(D().round_players)).not.toContain(5001);
    expect(ids(D().round_players)).not.toContain(5002);
    expect(ids(D().scores)).not.toContain(70001);
    expect(ids(D().scores)).not.toContain(70002);
    expect(ids(D().team_scores)).not.toContain(80001);
    expect(ids(D().tournament_sessions)).not.toContain(9);
    expect(ids(D().tournament_matches)).not.toContain(500);
    expect(ids(D().tournament_matches)).not.toContain(501);
    expect(ids(D().tournament_day_sides)).not.toContain(6001);
  });

  it("leaves the OTHER day (Day 2) completely intact", async () => {
    await deleteSession(9, { allowScores: true });
    expect(ids(D().rounds)).toContain(51);
    expect(ids(D().round_players)).toContain(5101);
    expect(ids(D().scores)).toContain(70101);
    expect(ids(D().tournament_sessions)).toContain(10);
    expect(ids(D().tournament_matches)).toContain(510);
    expect(ids(D().tournament_day_sides)).toContain(6002);
  });

  it("refuses when the tournament is PUBLISHED at mutation time (guard holds even if called directly)", async () => {
    D().tournaments![0].is_published = true; // flipped after the UI opened
    await expect(deleteSession(9, { allowScores: true })).rejects.toBeInstanceOf(TournamentPublishedError);
    // Nothing deleted.
    expect(ids(D().rounds)).toContain(50);
    expect(ids(D().scores)).toContain(70001);
    expect(ids(D().tournament_sessions)).toContain(9);
    expect(ids(D().tournament_matches)).toContain(500);
  });

  it("without allowScores, a day with scores still throws SessionHasScoresError (unchanged R3 guard)", async () => {
    await expect(deleteSession(9)).rejects.toBeInstanceOf(SessionHasScoresError);
    expect(ids(D().rounds)).toContain(50);
    expect(ids(D().scores)).toContain(70001);
  });

  it("LEAGUE guard: aborts (deletes nothing) when the day's round is a league round", async () => {
    // Session 11 points at league round 901 (tournament_id null).
    await expect(deleteSession(11, { allowScores: true })).rejects.toBeInstanceOf(NotTournamentRoundError);
    expect(ids(D().rounds)).toContain(901);
    expect(ids(D().round_players)).toContain(9011);
    expect(ids(D().scores)).toContain(79011);
  });

  it("SHARED-round guard: aborts when another session references the same round", async () => {
    // Anomalous sibling session sharing round 50.
    D().tournament_sessions!.push({ id: 12, tournament_id: 1, round_id: 50, day_number: 4, name: "Day 4", format: "four_ball_match", played_on: "2026-08-03", is_locked: false });
    await expect(deleteSession(9, { allowScores: true })).rejects.toBeInstanceOf(SharedRoundError);
    expect(ids(D().rounds)).toContain(50);
    expect(ids(D().scores)).toContain(70001);
    expect(ids(D().tournament_sessions)).toContain(9);
  });

  it("rollback: if the round delete fails, NOTHING is partially deleted (single atomic statement)", async () => {
    fakeRef.current.setOptions({ failWrite: (op: any) => op.table === "rounds" });
    await expect(deleteSession(9, { allowScores: true })).rejects.toThrow();
    // Every Day-1 row survives — no half-deleted day.
    expect(ids(D().rounds)).toContain(50);
    expect(ids(D().round_players)).toEqual(expect.arrayContaining([5001, 5002]));
    expect(ids(D().scores)).toEqual(expect.arrayContaining([70001, 70002]));
    expect(ids(D().team_scores)).toContain(80001);
    expect(ids(D().tournament_sessions)).toContain(9);
    expect(ids(D().tournament_matches)).toEqual(expect.arrayContaining([500, 501]));
    expect(ids(D().tournament_day_sides)).toContain(6001);
  });
});
