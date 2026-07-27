// Pairings data layer (Phase 2.2a §2 + 2.2b §1) — createGroup / updateGroup /
// deleteGroup against the FakeSupabase. Covers per-match tee stamping (mixed tees
// impossible by construction), group_number allocation, team-number allocation,
// singles 4-teams/2-matches sharing one group, singles-swap immunity, every
// validation error, partial-group persistence + floor, and the has-scores gate.

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

// tee 1: slope 113, rating = par ⇒ CH === HI. tee 2: slope 130 ⇒ CH = round(HI×130/113).
// Some players prefer tee 2, to prove the group tee OVERRIDES preferred_tee_id.
function seed(format: "greensomes" | "four_ball_match" | "singles_match"): FakeData {
  const holes = (teeId: number) => Array.from({ length: 18 }, (_, i) => ({ id: teeId * 100 + i, tee_id: teeId, hole_number: i + 1, par: 4, stroke_index: i + 1 }));
  return {
    rounds: [{ id: 50, played_on: "2026-08-01", course_id: 1, tournament_id: 1, season_id: null }],
    tees: [
      { id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 },
      { id: 2, color: "Blue", slope_rating: 130, course_rating: 72, par: 72, sort_order: 2 },
    ],
    holes: [...holes(1), ...holes(2)],
    round_players: [],
    players: [
      { id: 1, full_name: "A1", display_name: "A1", handicap_index: 10, is_active: true, preferred_tee_id: 2 },
      { id: 2, full_name: "A2", display_name: "A2", handicap_index: 12, is_active: true, preferred_tee_id: 1 },
      { id: 3, full_name: "A3", display_name: "A3", handicap_index: 14, is_active: true, preferred_tee_id: 2 },
      { id: 4, full_name: "B1", display_name: "B1", handicap_index: 8, is_active: true, preferred_tee_id: 1 },
      { id: 5, full_name: "B2", display_name: "B2", handicap_index: 16, is_active: true, preferred_tee_id: 2 },
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

describe("createGroup — team numbers, group_number & match creation", () => {
  it("greensomes: one match, two team numbers, group_number 1, four rows all stamped with the group tee", async () => {
    fakeRef.current = new FakeSupabase(seed("greensomes"));
    const { matches: created, teamNumbers, groupNumber } = await createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5], teeId: 1 });

    expect(created).toHaveLength(1);
    expect(teamNumbers).toEqual([1, 2]);
    expect(groupNumber).toBe(1);
    expect(created[0]).toMatchObject({ side_a_team_number: 1, side_b_team_number: 2, match_number: 1, group_number: 1 });
    expect(rps()).toHaveLength(4);
    // Every row stamped with tee 1 (overriding player 1/5's preferred tee 2); CH = HI at tee 1.
    expect(rps().every((r) => r.tee_id === 1)).toBe(true);
    expect(rps().find((r) => r.player_id === 1)).toMatchObject({ team_number: 1, course_handicap: 10 });
    expect(rps().find((r) => r.player_id === 5)).toMatchObject({ team_number: 2, course_handicap: 16 });
  });

  it("singles: four team numbers, two matches sharing ONE group_number, paired by slot index", async () => {
    fakeRef.current = new FakeSupabase(seed("singles_match"));
    const { matches: created, teamNumbers, groupNumber } = await createGroup({ sessionId: 9, format: "singles_match", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5], teeId: 1 });

    expect(teamNumbers).toEqual([1, 2, 3, 4]);
    expect(created).toHaveLength(2);
    expect(groupNumber).toBe(1);
    expect(created.every((m) => m.group_number === 1)).toBe(true); // both matches, one foursome
    expect(created[0]).toMatchObject({ side_a_team_number: 1, side_b_team_number: 2, match_number: 1 });
    expect(created[1]).toMatchObject({ side_a_team_number: 3, side_b_team_number: 4, match_number: 2 });
    expect(rps().find((r) => r.player_id === 1)!.team_number).toBe(1);
    expect(rps().find((r) => r.player_id === 4)!.team_number).toBe(2);
    expect(rps().find((r) => r.player_id === 2)!.team_number).toBe(3);
    expect(rps().find((r) => r.player_id === 5)!.team_number).toBe(4);
  });

  it("advances team_number and group_number across two groups; numbers never overlap", async () => {
    fakeRef.current = new FakeSupabase(seed("four_ball_match"));
    const g1 = await createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5], teeId: 1 });
    const g2 = await createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [3], sideBPlayerIds: [6], teeId: 1 });
    expect(g1.teamNumbers).toEqual([1, 2]);
    expect(g2.teamNumbers).toEqual([3, 4]);
    expect(g1.groupNumber).toBe(1);
    expect(g2.groupNumber).toBe(2);
    expect(g2.matches[0].match_number).toBe(2);
    expect(g1.teamNumbers.filter((t) => g2.teamNumbers.includes(t))).toEqual([]);
  });

  it("createGroup output can NEVER trigger MixedTeesInMatchError (loader loads clean)", async () => {
    fakeRef.current = new FakeSupabase(seed("four_ball_match"));
    // players 1 & 5 prefer tee 2; the group tee is 1, so every row is tee 1.
    const { matches: created } = await createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5], teeId: 1 });
    const m = await loadMatch(created[0].id); // would throw MixedTeesInMatchError if tees diverged
    expect(m.holes).toHaveLength(18);
    expect(new Set(rps().map((r) => r.tee_id))).toEqual(new Set([1]));
  });
});

describe("createGroup — §5 partial persistence & floor", () => {
  it("persists a group missing a player and the loader flags it incomplete", async () => {
    fakeRef.current = new FakeSupabase(seed("greensomes"));
    const { matches: created } = await createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [1, 2], sideBPlayerIds: [4], teeId: 1 });
    expect(created).toHaveLength(1);
    expect(rps()).toHaveLength(3);
    const m = await loadMatch(created[0].id);
    expect(m.isIncomplete).toBe(true);
  });

  it("rejects a group with zero players on both sides", async () => {
    fakeRef.current = new FakeSupabase(seed("greensomes"));
    await expect(createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [], sideBPlayerIds: [], teeId: 1 })).rejects.toBeInstanceOf(EmptyGroupError);
    expect(matches()).toHaveLength(0);
  });
});

describe("createGroup — validation", () => {
  it("rejects an over-filled side (3 on a side)", async () => {
    fakeRef.current = new FakeSupabase(seed("four_ball_match"));
    await expect(createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [1, 2, 3], sideBPlayerIds: [4], teeId: 1 })).rejects.toBeInstanceOf(GroupOverfilledError);
  });

  it("rejects a player not assigned to any side", async () => {
    const s = seed("greensomes");
    s.tournament_players = (s.tournament_players as any[]).filter((tp) => tp.player_id !== 1);
    fakeRef.current = new FakeSupabase(s);
    await expect(createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5], teeId: 1 })).rejects.toBeInstanceOf(PlayerNotAssignedToSideError);
  });

  it("rejects a player placed on the wrong side", async () => {
    fakeRef.current = new FakeSupabase(seed("greensomes"));
    await expect(createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [1, 4], sideBPlayerIds: [5, 6], teeId: 1 })).rejects.toBeInstanceOf(PlayerSideMismatchError);
  });

  it("rejects a player already grouped that day", async () => {
    fakeRef.current = new FakeSupabase(seed("four_ball_match"));
    await createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5], teeId: 1 });
    await expect(createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [1, 3], sideBPlayerIds: [6], teeId: 1 })).rejects.toBeInstanceOf(PlayerAlreadyGroupedError);
  });
});

describe("updateGroup — tee change restamps the whole group", () => {
  it("changing the tee restamps every row and recomputes course handicaps", async () => {
    fakeRef.current = new FakeSupabase(seed("four_ball_match"));
    const { groupNumber } = await createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5], teeId: 1 });
    expect(rps().every((r) => r.tee_id === 1)).toBe(true);

    await updateGroup({ sessionId: 9, groupNumber, teeId: 2 });

    expect(rps().every((r) => r.tee_id === 2)).toBe(true);
    // CH recomputed at tee 2 (slope 130): HI 10 → round(10×130/113)=12; HI 8 → 9.
    expect(rps().find((r) => r.player_id === 1)!.course_handicap).toBe(12);
    expect(rps().find((r) => r.player_id === 4)!.course_handicap).toBe(9);
  });
});

describe("updateGroup — singles swap immunity (correction #3)", () => {
  it("swapping one player keeps both matches' pairings intact", async () => {
    fakeRef.current = new FakeSupabase(seed("singles_match"));
    const { groupNumber } = await createGroup({ sessionId: 9, format: "singles_match", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5], teeId: 1 });
    const before = matches().map((m) => ({ id: m.id, a: m.side_a_team_number, b: m.side_b_team_number, g: m.group_number }));

    await updateGroup({ sessionId: 9, groupNumber, teamNumber: 1, fromPlayerId: 1, toPlayerId: 3 });

    const after = matches().map((m) => ({ id: m.id, a: m.side_a_team_number, b: m.side_b_team_number, g: m.group_number }));
    expect(after).toEqual(before);
    expect(rps().find((r) => r.team_number === 1)!.player_id).toBe(3);
    expect(rps().find((r) => r.team_number === 3)!.player_id).toBe(2);
    // Incoming player stamped with the group's tee (1), CH = HI 14 at tee 1.
    expect(rps().find((r) => r.team_number === 1)!.tee_id).toBe(1);
    expect(rps().find((r) => r.team_number === 1)!.course_handicap).toBe(14);
  });
});

describe("has-scores gate", () => {
  async function groupWithScore() {
    fakeRef.current = new FakeSupabase(seed("greensomes"));
    const { groupNumber } = await createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5], teeId: 1 });
    const rpId = rps().find((r: any) => r.player_id === 1 && r.team_number === 1).id;
    (fakeRef.current.data.scores as any[]).push({ id: 9999, round_player_id: rpId, hole_number: 1, strokes: 4 });
    return groupNumber;
  }

  it("blocks updateGroup once the group has a score", async () => {
    const groupNumber = await groupWithScore();
    await expect(updateGroup({ sessionId: 9, groupNumber, teamNumber: 1, fromPlayerId: 1, toPlayerId: 3 })).rejects.toBeInstanceOf(GroupHasScoresError);
  });

  it("blocks deleteGroup once the group has a score, but allows it before", async () => {
    fakeRef.current = new FakeSupabase(seed("greensomes"));
    const { groupNumber } = await createGroup({ sessionId: 9, format: "greensomes", sideAPlayerIds: [1, 2], sideBPlayerIds: [4, 5], teeId: 1 });
    await deleteGroup({ sessionId: 9, groupNumber });
    expect(matches()).toHaveLength(0);
    expect(rps()).toHaveLength(0);

    const g2 = await groupWithScore();
    await expect(deleteGroup({ sessionId: 9, groupNumber: g2 })).rejects.toBeInstanceOf(GroupHasScoresError);
    expect(matches()).toHaveLength(1);
  });
});
