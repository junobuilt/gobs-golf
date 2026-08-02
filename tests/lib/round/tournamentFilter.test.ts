// Tournament isolation — loader-level guards (Ryder Cup track).
//
// `rounds.tournament_id` is NULL for ordinary league rounds and NON-NULL for
// rounds that belong to a tournament. Every LEAGUE-facing read must exclude
// tournament rounds so they can never surface on a league screen. These tests
// exercise the pure-function loaders directly; each has a NEGATIVE CONTROL that
// runs the same query shape WITHOUT the tournament filter and proves the
// tournament round WOULD appear — so the positive assertion is non-vacuous and
// the filter is load-bearing (CLAUDE.md engineering principle #3 + #7).
//
// The broad "no future from(\"rounds\") escapes the filter" guarantee lives in
// the source-scanning invariant test, tests/lib/round/roundsQueryGuard.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const sref = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return sref.current;
  },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { loadRoundsList } from "@/lib/round/loadRoundsList";
import { loadWinningsHistory } from "@/lib/payouts/loadWinnings";
import { loadPlayerWinnings } from "@/lib/payouts/loadPlayerWinnings";
import { fetchPlayedWithRows, fetchPairRounds } from "@/lib/playedWith/compute";
import {
  getRoundCountForSeason,
  getInProgressRoundsForSeason,
} from "@/lib/seasons/queries";

const LEAGUE = 1;
const TOURNEY = 9;

// ----------------------------------------------------------------------------
// A tiny dotted-path Supabase mock for the join-through loaders (round_payouts /
// round_players → rounds!inner). Rows carry their embedded `rounds` object, and
// dotted filter columns ("rounds.tournament_id") traverse into it — matching
// PostgREST's embedded-filter semantics on a 1:1 !inner join. Mirrors the mock
// in tests/lib/payouts/loadWinnings.test.ts, plus `.is()` for the null filter.
// ----------------------------------------------------------------------------
function getPath(row: any, path: string) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), row);
}
function makeDottedClient(data: Record<string, any[]>) {
  class Builder {
    private eqs: Array<[string, any]> = [];
    private iss: Array<[string, any]> = [];
    private ins: [string, any[]] | null = null;
    private gts: Array<[string, any]> = [];
    constructor(private table: string) {}
    select() { return this; }
    eq(col: string, val: any) { this.eqs.push([col, val]); return this; }
    is(col: string, val: any) { this.iss.push([col, val]); return this; }
    in(col: string, vals: any[]) { this.ins = [col, vals]; return this; }
    gt(col: string, val: any) { this.gts.push([col, val]); return this; }
    order() { return this; }
    limit() { return this; }
    run() {
      let rows = [...(data[this.table] ?? [])];
      for (const [c, v] of this.eqs) rows = rows.filter((r) => getPath(r, c) === v);
      for (const [c, v] of this.iss) rows = rows.filter((r) => getPath(r, c) === v);
      if (this.ins) rows = rows.filter((r) => this.ins![1].includes(getPath(r, this.ins![0])));
      for (const [c, v] of this.gts) rows = rows.filter((r) => getPath(r, c) > v);
      return { data: rows, error: null };
    }
    then<T>(onF: (v: { data: any; error: any }) => T) {
      return Promise.resolve(this.run()).then(onF);
    }
  }
  return { from: (t: string) => new Builder(t) };
}

// ----------------------------------------------------------------------------
// Full-engine seed for loadRoundsList: one league round (tournament_id: null)
// and one tournament round (tournament_id: TOURNEY-owner), BOTH finalized and
// fully loadable (2 teams, 18 holes of scores) so that absent the filter the
// tournament round WOULD rank into the list. tournament_id is set EXPLICITLY on
// every round — the fake's `.is(col, null)` matches `=== null`, so an undefined
// field would be wrongly excluded.
// ----------------------------------------------------------------------------
function holes() {
  return Array.from({ length: 18 }, (_, i) => ({
    id: i + 1, tee_id: 1, hole_number: i + 1, par: 4, yardage: 350, stroke_index: i + 1,
  }));
}
function scoresFor(rpId: number, gross: number, startId: number) {
  return Array.from({ length: 18 }, (_, i) => ({
    id: startId + i, round_player_id: rpId, hole_number: i + 1, strokes: gross,
  }));
}
function engineSeed(): FakeData {
  return {
    rounds: [
      {
        id: LEAGUE, played_on: "2026-05-13", course_id: 1, is_complete: true,
        tournament_id: null,
        format: "2_ball", format_config: { basis: "net", best_n: 2, override_holes: [] },
        format_locked_at: "2026-05-13T00:00:00Z", created_at: "2026-05-13T00:00:00Z",
      },
      {
        id: TOURNEY, played_on: "2026-06-20", course_id: 1, is_complete: true,
        tournament_id: 1, // belongs to a tournament → must NOT appear on league history
        format: "2_ball", format_config: { basis: "net", best_n: 2, override_holes: [] },
        format_locked_at: "2026-06-20T00:00:00Z", created_at: "2026-06-20T00:00:00Z",
      },
    ],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes: holes(),
    round_players: [
      { id: 101, round_id: LEAGUE, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 6, dropped_after_hole: null },
      { id: 102, round_id: LEAGUE, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 10, dropped_after_hole: null },
      { id: 103, round_id: LEAGUE, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 8, dropped_after_hole: null },
      { id: 104, round_id: LEAGUE, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 12, dropped_after_hole: null },
      { id: 901, round_id: TOURNEY, player_id: 901, tee_id: 1, team_number: 1, course_handicap: 6, dropped_after_hole: null },
      { id: 902, round_id: TOURNEY, player_id: 902, tee_id: 1, team_number: 1, course_handicap: 10, dropped_after_hole: null },
      { id: 903, round_id: TOURNEY, player_id: 903, tee_id: 1, team_number: 2, course_handicap: 8, dropped_after_hole: null },
      { id: 904, round_id: TOURNEY, player_id: 904, tee_id: 1, team_number: 2, course_handicap: 12, dropped_after_hole: null },
    ],
    players: [201, 202, 203, 204, 901, 902, 903, 904].map((id) => ({
      id, full_name: `P${id}`, display_name: `P${id}`, handicap_index: 10, is_active: true,
    })),
    scores: [
      ...scoresFor(101, 4, 10000), ...scoresFor(102, 4, 11000),
      ...scoresFor(103, 5, 12000), ...scoresFor(104, 5, 13000),
      ...scoresFor(901, 4, 20000), ...scoresFor(902, 4, 21000),
      ...scoresFor(903, 5, 22000), ...scoresFor(904, 5, 23000),
    ],
  };
}

describe("tournament isolation — History finalized list (loadRoundsList)", () => {
  beforeEach(() => { sref.current = new FakeSupabase(engineSeed()); });

  it("omits the tournament round from the finalized list", async () => {
    const items = await loadRoundsList();
    const ids = items.map((i) => i.roundId);
    expect(ids).toContain(LEAGUE);
    expect(ids).not.toContain(TOURNEY);
  });

  it("NEGATIVE CONTROL: without the filter the same rounds query surfaces the tournament round", async () => {
    // Replays loadRoundsList's top-level query MINUS `.is('tournament_id', null)`.
    const { data } = await sref.current
      .from("rounds")
      .select("id, played_on, is_complete")
      .eq("is_complete", true);
    const ids = (data as any[]).map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual([LEAGUE, TOURNEY]); // both are loadable → exclusion is real work
  });
});

// ----------------------------------------------------------------------------
// Join-through loaders: seed round_payouts / round_players rows each carrying an
// embedded `rounds` object with tournament_id, so the dotted filter can act.
// ----------------------------------------------------------------------------
function leagueRound() {
  return { played_on: "2026-05-13", format: "2_ball", season_id: 1, is_complete: true, buy_in: 10, tournament_id: null };
}
function tourneyRound() {
  return { played_on: "2026-06-20", format: "2_ball", season_id: 1, is_complete: true, buy_in: 10, tournament_id: 1 };
}
function winningsData() {
  const round_payouts = [
    { round_id: LEAGUE, team_number: 1, place: 1, per_player: 25, team_size: 2, total_for_team: 50, is_tied: false, was_overridden: false, per_player_x: 0, rounds: leagueRound() },
    { round_id: TOURNEY, team_number: 1, place: 1, per_player: 25, team_size: 2, total_for_team: 50, is_tied: false, was_overridden: false, rounds: tourneyRound() },
  ];
  const round_players = [
    { round_id: LEAGUE, team_number: 1, player_id: 201, players: { full_name: "P201 League" } },
    { round_id: LEAGUE, team_number: 1, player_id: 202, players: { full_name: "P202 League" } },
    { round_id: TOURNEY, team_number: 1, player_id: 201, players: { full_name: "P201 League" } },
    { round_id: TOURNEY, team_number: 1, player_id: 202, players: { full_name: "P202 League" } },
  ];
  const players = [
    { id: 201, full_name: "P201 League", is_active: true },
    { id: 202, full_name: "P202 League", is_active: true },
  ];
  return { round_payouts, round_players, players };
}

describe("tournament isolation — Money By Round (loadWinningsHistory)", () => {
  beforeEach(() => { sref.current = makeDottedClient(winningsData()); });

  it("omits the tournament round from Winnings history", async () => {
    const rounds = await loadWinningsHistory(null, 10);
    const ids = rounds.map((r: any) => r.roundId ?? r.round_id);
    expect(ids).toContain(LEAGUE);
    expect(ids).not.toContain(TOURNEY);
  });

  it("NEGATIVE CONTROL: without the filter the payouts query surfaces the tournament round", async () => {
    const { data } = await sref.current
      .from("round_payouts")
      .select("round_id, rounds!inner ( is_complete )")
      .eq("rounds.is_complete", true);
    const ids = (data as any[]).map((r) => r.round_id).sort((a, b) => a - b);
    expect(ids).toContain(TOURNEY);
  });
});

describe("tournament isolation — Money By Player (loadPlayerWinnings)", () => {
  beforeEach(() => { sref.current = makeDottedClient(winningsData()); });

  it("excludes tournament rounds from a player's winnings drill", async () => {
    const players = await loadPlayerWinnings(null);
    const p201 = players.find((p) => p.playerId === 201);
    expect(p201).toBeTruthy();
    const drillIds = p201!.rounds.map((r) => r.roundId);
    expect(drillIds).toContain(LEAGUE);
    expect(drillIds).not.toContain(TOURNEY);
    // Net counts the league round's buy-in exactly once (25 won − 10), not twice.
    expect(p201!.roundsPlayed).toBe(1);
  });
});

// ----------------------------------------------------------------------------
// Played-with: rpRows carry embedded `rounds` for the is_complete/tournament
// filter. Seed a LEAGUE partnership and a TOURNEY partnership sharing the same
// two players so the only reason the tournament pairing drops is the filter.
// ----------------------------------------------------------------------------
function playedWithData() {
  const round_players = [
    { round_id: LEAGUE, team_number: 1, player_id: 201, rounds: { played_on: "2026-05-13", is_complete: true, season_id: 1, tournament_id: null } },
    { round_id: LEAGUE, team_number: 1, player_id: 202, rounds: { played_on: "2026-05-13", is_complete: true, season_id: 1, tournament_id: null } },
    { round_id: TOURNEY, team_number: 1, player_id: 201, rounds: { played_on: "2026-06-20", is_complete: true, season_id: 1, tournament_id: 1 } },
    { round_id: TOURNEY, team_number: 1, player_id: 202, rounds: { played_on: "2026-06-20", is_complete: true, season_id: 1, tournament_id: 1 } },
  ];
  const players = [
    { id: 201, full_name: "P201 League", display_name: "P201", is_active: true },
    { id: 202, full_name: "P202 League", display_name: "P202", is_active: true },
  ];
  return { round_players, players };
}

describe("tournament isolation — Played-with (compute.ts)", () => {
  beforeEach(() => { sref.current = makeDottedClient(playedWithData()); });

  it("fetchPlayedWithRows omits tournament round_players rows", async () => {
    const { rpRows } = await fetchPlayedWithRows(null);
    const roundIds = rpRows.map((r: any) => r.round_id);
    expect(roundIds).toContain(LEAGUE);
    expect(roundIds).not.toContain(TOURNEY);
  });

  it("fetchPairRounds omits the tournament pairing", async () => {
    const pair = await fetchPairRounds(201, 202, null);
    const roundIds = pair.map((r: any) => r.roundId ?? r.round_id);
    expect(roundIds).toContain(LEAGUE);
    expect(roundIds).not.toContain(TOURNEY);
  });

  it("NEGATIVE CONTROL: without the filter the played-with query surfaces the tournament rows", async () => {
    const { data } = await sref.current
      .from("round_players")
      .select("round_id, rounds!inner ( is_complete )")
      .eq("rounds.is_complete", true)
      .gt("team_number", 0);
    const ids = (data as any[]).map((r) => r.round_id);
    expect(ids).toContain(TOURNEY);
  });
});

// ----------------------------------------------------------------------------
// Season gates — a stray tournament round with season_id set must never inflate
// the round count or block End Season.
// ----------------------------------------------------------------------------
function seasonSeed(): FakeData {
  return {
    rounds: [
      { id: LEAGUE, played_on: "2026-05-13", course_id: 1, is_complete: false, season_id: 7, tournament_id: null },
      { id: TOURNEY, played_on: "2026-06-20", course_id: 1, is_complete: false, season_id: 7, tournament_id: 1 },
    ],
    tees: [], holes: [], round_players: [], players: [], scores: [],
  };
}

describe("tournament isolation — season gates (seasons/queries.ts)", () => {
  beforeEach(() => { sref.current = new FakeSupabase(seasonSeed()); });

  it("getRoundCountForSeason counts only the league round", async () => {
    expect(await getRoundCountForSeason(7)).toBe(1);
  });

  it("getInProgressRoundsForSeason omits the tournament round (End Season not blocked by it)", async () => {
    const rows = await getInProgressRoundsForSeason(7);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(LEAGUE);
    expect(ids).not.toContain(TOURNEY);
  });

  it("NEGATIVE CONTROL: without the filter the season query counts both rounds", async () => {
    const { data } = await sref.current
      .from("rounds").select("id").eq("season_id", 7).eq("is_complete", false);
    expect((data as any[]).map((r) => r.id).sort((a, b) => a - b)).toEqual([LEAGUE, TOURNEY]);
  });
});
