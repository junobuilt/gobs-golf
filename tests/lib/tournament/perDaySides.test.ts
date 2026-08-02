// Per-day team assignment (migration 038 — "alternates") against FakeSupabase.
//
// Guards the SSOT contract for the per-day side resolver:
//   (a) resolver === match-implied side === pool bucket for every built pairing
//   (b) home fallback fires when no override row exists
//   (c) an override never grants membership (player must already have a
//       tournament_players row)
// plus the sparse-override write contract (setPlayerDaySide) and that createGroup
// validation honours the per-day override rather than the raw home side.

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
  PlayerNotInTournamentError,
  PlayerSideMismatchError,
  setPlayerDaySide,
} from "@/lib/tournament/mutations";
import {
  getDaySideAssignments,
  getPlayerTeamForDay,
} from "@/lib/tournament/queries";
import { loadSessionMatches } from "@/lib/tournament/loadMatch";

// tee 1: slope 113, rating = par ⇒ CH === HI. Home sides: players 1–3 = a,
// players 4–6 = b. Session 9 / round 50 is a Best-Ball (four_ball_match) day.
function seed(): FakeData {
  const holes = Array.from({ length: 18 }, (_, i) => ({ id: 100 + i, tee_id: 1, hole_number: i + 1, par: 4, stroke_index: i + 1 }));
  return {
    rounds: [{ id: 50, played_on: "2026-08-01", course_id: 1, tournament_id: 1, season_id: null }],
    tees: [{ id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 }],
    holes,
    round_players: [],
    players: [1, 2, 3, 4, 5, 6].map((id) => ({ id, full_name: `P${id}`, display_name: `P${id}`, handicap_index: 10 + id, is_active: true, preferred_tee_id: 1 })),
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
    tournament_sessions: [{ id: 9, tournament_id: 1, round_id: 50, day_number: 1, name: "Day", format: "four_ball_match", played_on: "2026-08-01", is_locked: false }],
    tournament_matches: [],
    tournament_day_sides: [],
  } as FakeData;
}

const daySideRows = () => fakeRef.current.data.tournament_day_sides as any[];

beforeEach(() => {
  fakeRef.current = new FakeSupabase(seed());
});

describe("resolver — home fallback (b)", () => {
  it("with NO overrides, every player resolves to their home side", async () => {
    const map = await getDaySideAssignments(1, 9);
    expect([...map.entries()].sort()).toEqual([
      [1, "a"], [2, "a"], [3, "a"], [4, "b"], [5, "b"], [6, "b"],
    ]);
    expect(await getPlayerTeamForDay(1, 9, 1)).toBe("a");
    expect(await getPlayerTeamForDay(1, 9, 4)).toBe("b");
  });
});

describe("setPlayerDaySide — sparse override write contract", () => {
  it("overriding to the non-home side creates ONE row and re-sides only that player", async () => {
    await setPlayerDaySide(1, 9, 1, "b"); // P1 home a → b for this day
    expect(daySideRows()).toHaveLength(1);
    expect(daySideRows()[0]).toMatchObject({ tournament_id: 1, session_id: 9, player_id: 1, side: "b" });

    const map = await getDaySideAssignments(1, 9);
    expect(map.get(1)).toBe("b"); // overridden
    expect(map.get(2)).toBe("a"); // untouched
    expect(await getPlayerTeamForDay(1, 9, 1)).toBe("b");
  });

  it("setting the side back to HOME clears the row (no row = home)", async () => {
    await setPlayerDaySide(1, 9, 1, "b");
    expect(daySideRows()).toHaveLength(1);
    await setPlayerDaySide(1, 9, 1, "a"); // a == home ⇒ clear
    expect(daySideRows()).toHaveLength(0);
    expect(await getPlayerTeamForDay(1, 9, 1)).toBe("a");
  });

  it("passing null clears the override", async () => {
    await setPlayerDaySide(1, 9, 1, "b");
    await setPlayerDaySide(1, 9, 1, null);
    expect(daySideRows()).toHaveLength(0);
    expect(await getPlayerTeamForDay(1, 9, 1)).toBe("a");
  });

  it("re-overriding the same day updates in place (UNIQUE session_id,player_id)", async () => {
    await setPlayerDaySide(1, 9, 1, "b");
    await setPlayerDaySide(1, 9, 1, "b");
    expect(daySideRows()).toHaveLength(1);
  });
});

describe("override never grants membership (c)", () => {
  it("setPlayerDaySide for a non-member throws PlayerNotInTournamentError and writes nothing", async () => {
    await expect(setPlayerDaySide(1, 9, 999, "a")).rejects.toBeInstanceOf(PlayerNotInTournamentError);
    expect(daySideRows()).toHaveLength(0);
  });

  it("a STRAY override row for a non-member is ignored by the resolver", async () => {
    daySideRows().push({ id: 77, tournament_id: 1, session_id: 9, player_id: 999, side: "a" });
    const map = await getDaySideAssignments(1, 9);
    expect(map.has(999)).toBe(false);
    expect(await getPlayerTeamForDay(1, 9, 999)).toBeNull();
  });
});

describe("createGroup honours the per-day override + three-way agreement (a)", () => {
  it("WITHOUT an override, placing a home-'a' player on side B is rejected", async () => {
    await expect(
      createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [2, 3], sideBPlayerIds: [1, 4], teeId: 1 }),
    ).rejects.toBeInstanceOf(PlayerSideMismatchError);
  });

  it("WITH an override, the same placement succeeds and resolver === match-implied === pool bucket for every built player", async () => {
    await setPlayerDaySide(1, 9, 1, "b"); // P1 becomes an alternate on side B today

    await createGroup({ sessionId: 9, format: "four_ball_match", sideAPlayerIds: [2, 3], sideBPlayerIds: [1, 4], teeId: 1 });

    const matches = await loadSessionMatches(9);
    expect(matches).toHaveLength(1);
    const m = matches[0];

    // pool bucket = the effective side map the pairing pool filters on.
    const poolBucket = await getDaySideAssignments(1, 9);

    const matchImplied = (playerId: number): "a" | "b" | null =>
      m.sideA.players.some((p) => p.playerId === playerId)
        ? "a"
        : m.sideB.players.some((p) => p.playerId === playerId)
          ? "b"
          : null;

    for (const playerId of [1, 2, 3, 4]) {
      const resolver = await getPlayerTeamForDay(1, 9, playerId);
      expect(resolver).not.toBeNull();
      expect(matchImplied(playerId)).toBe(resolver); // resolver === match-implied
      expect(poolBucket.get(playerId)).toBe(resolver); // resolver === pool bucket
    }

    // And concretely: the alternate landed on side B, home-'a' players on side A.
    expect(matchImplied(1)).toBe("b");
    expect(matchImplied(2)).toBe("a");
    expect(matchImplied(4)).toBe("b");
  });
});
