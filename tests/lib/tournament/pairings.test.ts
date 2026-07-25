// Pairings data layer (Phase 2.2 §2) — createGroup / updateGroup / deleteGroup
// against the FakeSupabase. Covers team-number allocation, singles 4-teams /
// 2-matches, the singles-swap immunity (correction #3), every validation error,
// partial-group persistence + floor (§5), and the has-scores gate.

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
  createGroup,
  deleteGroup,
  EmptyGroupError,
  GroupHasScoresError,
  GroupOverfilledError,
  PlayerAlreadyGroupedError,
  PlayerNotAssignedToSideError,
  PlayerSideMismatchError,
  updateGroup,
} from "@/lib/tournament/mutations";
import { loadMatch } from "@/lib/tournament/loadMatch";

// tee 1: slope 113, rating = par ⇒ computeCourseHandicap(HI) === HI (clean).
function seed(format: "greensomes" | "four_ball_match" | "singles_match"): FakeData {
  return {
    rounds: [{ id: 50, played_on: "2026-08-01", course_id: 1, tournament_id: 1, season_id: null }],
    tees: [{ id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 }],
    holes: Array.from({ length: 18 }, (_, i) => ({ id: 100 + i, tee_id: 1, hole_number: i + 1, par: 4, stroke_index: i + 1 })),
    round_players: [],
    players: [
      { id: 1, full_name: "A1", display_name: "A1", handicap_index: 10, is_active: true, preferred_tee_id: 1 },
      { id: 2, full_name: "A2", display_name: "A2", handicap_index: 12, is_active: true, preferred_tee_id: 1 },
      { id: 3, full_name: "A3", display_name: "A3", handicap_index: 14, is_active: true, preferred_tee_id: 1 },
      { id: 4, full_name: "B1", display_name: "B1", handicap_index: 8, is_active: true, preferred_tee_id: 1 },
      { id: 5, full_name: "B2", display_name: "B2", handicap_index: 16, is_active: true, preferred_tee_id: 1 },
      { id: 6, full_name: "B3", display_name: "B3", handicap_index: 20, is_active: true, preferred_tee_id: 1 },
    ],
    scores: [],
    team_scores: [],
    tournaments: [{ id: 1, name: "Cup", is_active: true, started_on: "2026-08-01", side_a_name: "USA", side_b_name: "Canada", holder_side: "b", season_id: null, ended_on: null, notes: null }],
    tournament_players: [
      { id: 1, tournament_id: 1, player_id: 1, side: "a" },
      { id: 2, tournament_id: 1, player_id: 2, side: "a" },
      { id: 3, tournament_id: 1, player_id: 3, side: "a" },
      { id: 4, tournament_id: 1, player_id: 4, side: "b" },
      { id: 5, tournament_id: 1, player_id: 5, side: "b" },
      { id: 6, tournament_id: 1, player_id: 6, side: "b" },
    ],
    tournament_sessions: [{ id: 9, tournament_id: 1, round_id: 50, day_number: 1, name: "Day", format, played_on: "2026-08-01", is_locked: false }],
    tournament_matches: [],
  } as FakeData;
}

const rps = () => fakeRef.current.data.round_players as any[];
const matches = () => fakeRef.current.data.tournament_matches as any[];

describe("createGroup — team numbers & match creation", () => {
  it("greensomes: one match, two sequential team numbers, four round_players with CH snapshots", async () => {
    fakeRef.current = new FakeSupabase(seed("greensomes"));
    const { matches: created, teamNumbers } = await createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5] });

    expect(created).toHaveLength(1);
    expect(teamNumbers).toEqual([1, 2]);
    expect(created[0]).toMatchObject({ side_a_team_number: 1, side_b_team_number: 2, match_number: 1 });
    expect(rps()).toHaveLength(4);
    // CH computed from the tee (slope 113, rating=par) ⇒ CH === HI.
    expect(rps().find((r) => r.player_id === 1)).toMatchObject({ team_number: 1, course_handicap: 10, handicap_index_snapshot: 10, tee_id: 1 });
    expect(rps().find((r) => r.player_id === 5)).toMatchObject({ team_number: 2, course_handicap: 16 });
  });

  it("singles: a group of four produces 4 team numbers and 2 matches, paired by slot index", async () => {
    fakeRef.current = new FakeSupabase(seed("singles_match"));
    const { matches: created, teamNumbers } = await createGroup({ sessionId: 9, format: "singles_match", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5] });

    expect(teamNumbers).toEqual([1, 2, 3, 4]);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ side_a_team_number: 1, side_b_team_number: 2, match_number: 1 });
    expect(created[1]).toMatchObject({ side_a_team_number: 3, side_b_team_number: 4, match_number: 2 });
    // index pairing: a[0]=1 vs b[0]=4 in match 1; a[1]=2 vs b[1]=5 in match 2.
    expect(rps().find((r) => r.player_id === 1)!.team_number).toBe(1);
    expect(rps().find((r) => r.player_id === 4)!.team_number).toBe(2);
    expect(rps().find((r) => r.player_id === 2)!.team_number).toBe(3);
    expect(rps().find((r) => r.player_id === 5)!.team_number).toBe(4);
  });

  it("never reuses a team number across two groups in the same round", async () => {
    fakeRef.current = new FakeSupabase(seed("four_ball_match"));
    const g1 = await createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5] });
    const g2 = await createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [3], sideBPlayerIds: [6] });
    expect(g1.teamNumbers).toEqual([1, 2]);
    expect(g2.teamNumbers).toEqual([3, 4]);
    // match_number also advances.
    expect(g2.matches[0].match_number).toBe(2);
    // No team number allocated to group 1 is reused by group 2 (within a group,
    // a four-ball pair intentionally SHARES its side's number).
    const overlap = g1.teamNumbers.filter((t) => g2.teamNumbers.includes(t));
    expect(overlap).toEqual([]);
  });
});

describe("createGroup — §5 partial persistence & floor", () => {
  it("persists a group missing a player and the loader flags it incomplete", async () => {
    fakeRef.current = new FakeSupabase(seed("greensomes"));
    const { matches: created } = await createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [1, 2], sideBPlayerIds: [4] });
    expect(created).toHaveLength(1);
    expect(rps()).toHaveLength(3); // side B short one
    const m = await loadMatch(created[0].id);
    expect(m.isIncomplete).toBe(true);
  });

  it("rejects a group with zero players on both sides", async () => {
    fakeRef.current = new FakeSupabase(seed("greensomes"));
    await expect(createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [], sideBPlayerIds: [] })).rejects.toBeInstanceOf(EmptyGroupError);
    expect(matches()).toHaveLength(0);
  });
});

describe("createGroup — validation", () => {
  it("rejects an over-filled side (3 on a side)", async () => {
    fakeRef.current = new FakeSupabase(seed("four_ball_match"));
    await expect(createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [1, 2, 3], sideBPlayerIds: [4] })).rejects.toBeInstanceOf(GroupOverfilledError);
  });

  it("rejects a player not assigned to any side", async () => {
    const s = seed("greensomes");
    s.tournament_players = (s.tournament_players as any[]).filter((tp) => tp.player_id !== 1);
    fakeRef.current = new FakeSupabase(s);
    await expect(createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5] })).rejects.toBeInstanceOf(PlayerNotAssignedToSideError);
  });

  it("rejects a player placed on the wrong side", async () => {
    fakeRef.current = new FakeSupabase(seed("greensomes"));
    // player 4 is side b, but placed in slot A.
    await expect(createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [1, 4], sideBPlayerIds: [5, 6] })).rejects.toBeInstanceOf(PlayerSideMismatchError);
  });

  it("rejects a player already grouped that day", async () => {
    fakeRef.current = new FakeSupabase(seed("four_ball_match"));
    await createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5] });
    // player 1 again in a second group.
    await expect(createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [1, 3], sideBPlayerIds: [6] })).rejects.toBeInstanceOf(PlayerAlreadyGroupedError);
  });
});

describe("updateGroup — singles swap immunity (correction #3)", () => {
  it("swapping one player keeps both matches' team-number pairings intact", async () => {
    fakeRef.current = new FakeSupabase(seed("singles_match"));
    await createGroup({ sessionId: 9, format: "singles_match", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5] });
    const before = matches().map((m) => ({ id: m.id, a: m.side_a_team_number, b: m.side_b_team_number }));

    // Swap the occupant of team 1 (player 1, side a) for player 3 (side a, ungrouped).
    await updateGroup({ sessionId: 9, teamNumber: 1, fromPlayerId: 1, toPlayerId: 3 });

    // Matches unchanged — no re-pairing.
    const after = matches().map((m) => ({ id: m.id, a: m.side_a_team_number, b: m.side_b_team_number }));
    expect(after).toEqual(before);
    // Only team 1's occupant changed; team 3 (the other A seat) still holds player 2.
    expect(rps().find((r) => r.team_number === 1)!.player_id).toBe(3);
    expect(rps().find((r) => r.team_number === 3)!.player_id).toBe(2);
    // New snapshot for the incoming player (HI 14 ⇒ CH 14).
    expect(rps().find((r) => r.team_number === 1)!.course_handicap).toBe(14);
  });
});

describe("has-scores gate", () => {
  async function groupWithScore() {
    fakeRef.current = new FakeSupabase(seed("greensomes"));
    const { matches: created } = await createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5] });
    const rpId = rps().find((r: any) => r.player_id === 1 && r.team_number === 1).id;
    (fakeRef.current.data.scores as any[]).push({ id: 9999, round_player_id: rpId, hole_number: 1, strokes: 4 });
    return created;
  }

  it("blocks updateGroup once the team has a score", async () => {
    await groupWithScore();
    await expect(updateGroup({ sessionId: 9, teamNumber: 1, fromPlayerId: 1, toPlayerId: 3 })).rejects.toBeInstanceOf(GroupHasScoresError);
  });

  it("blocks deleteGroup once the group has a score, but allows it before", async () => {
    // Before scores: delete succeeds.
    fakeRef.current = new FakeSupabase(seed("greensomes"));
    const { matches: created } = await createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5] });
    await deleteGroup({ sessionId: 9, matchIds: [created[0].id] });
    expect(matches()).toHaveLength(0);
    expect(rps()).toHaveLength(0);

    // After scores: blocked.
    const created2 = await groupWithScore();
    await expect(deleteGroup({ sessionId: 9, matchIds: [created2[0].id] })).rejects.toBeInstanceOf(GroupHasScoresError);
    expect(matches()).toHaveLength(1);
  });
});
