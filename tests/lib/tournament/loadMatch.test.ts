// Canonical loader (Phase 2.2) — loadMatch / loadSessionMatches against the
// FakeSupabase. Golden per format with HAND-COMPUTED expected values, plus the
// standing guarantees: cross-surface strokes equality, batched reads, truncation
// detection, and the mixed-tee refusal.

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
  loadMatch,
  loadSessionMatches,
  MixedTeesInMatchError,
  ScoresTruncatedError,
} from "@/lib/tournament/loadMatch";
import { computeMatchStrokes } from "@/lib/tournament/matchplay";

// 18 par-4 holes on tee 1, stroke_index = hole_number (so hole N has SI N).
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

// Gross `g` on every hole for a round_player.
function grossAll(rpId: number, g: number, startId: number) {
  return Array.from({ length: 18 }, (_, i) => ({
    id: startId + i,
    round_player_id: rpId,
    hole_number: i + 1,
    strokes: g,
  }));
}

const TOURN = { id: 1, name: "Cup", is_active: true, started_on: "2026-08-01", side_a_name: "USA", side_b_name: "Canada", holder_side: "b", season_id: null, ended_on: null, notes: null };

function baseData(extra: Partial<FakeData>): FakeData {
  return {
    rounds: [{ id: 50, played_on: "2026-08-01", course_id: 1, tournament_id: 1, season_id: null }],
    tees: [],
    holes: holes(1),
    round_players: [],
    players: [],
    scores: [],
    team_scores: [],
    tournaments: [TOURN],
    tournament_players: [],
    tournament_sessions: [],
    ...extra,
  } as FakeData;
}

beforeEach(() => {
  fakeRef.current = null;
});

// ── Golden: singles ─────────────────────────────────────────────────────────
// A (CH 10) vs B (CH 11). matchStrokes = PH − min = [10−10, 11−10] = [0, 1].
// B gets 1 stroke on SI 1 (hole 1). Everyone gross 4:
//   hole 1: A net 4, B net 3 → side_b; holes 2..18: 4 = 4 → halved.
//   ⇒ B 1 UP, decided on 18 (lead 1 never exceeds holes remaining until 18).
describe("loadMatch — singles golden", () => {
  it("matchStrokes, side nets, state and resolved result are exact", async () => {
    fakeRef.current = new FakeSupabase(
      baseData({
        players: [
          { id: 1, full_name: "Al A", display_name: "Al", handicap_index: 10, is_active: true },
          { id: 2, full_name: "Bo B", display_name: "Bo", handicap_index: 11, is_active: true },
        ],
        round_players: [
          { id: 101, round_id: 50, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 102, round_id: 50, player_id: 2, team_number: 2, tee_id: 1, course_handicap: 11, handicap_index_snapshot: 11 },
        ],
        scores: [...grossAll(101, 4, 1000), ...grossAll(102, 4, 2000)],
        tournament_sessions: [{ id: 9, tournament_id: 1, round_id: 50, day_number: 3, name: "Day 3 — Singles", format: "singles_match", played_on: "2026-08-01", is_locked: false }],
        tournament_matches: [{ id: 500, tournament_id: 1, session_id: 9, match_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null }],
      }),
    );

    const m = await loadMatch(500);

    expect(m.sideA.players.map((p) => p.matchStrokes)).toEqual([0]);
    expect(m.sideB.players.map((p) => p.matchStrokes)).toEqual([1]);
    expect(m.sideA.displayName).toBe("USA");
    expect(m.sideB.displayName).toBe("Canada");
    expect(m.sideA.collapsedHandicap).toBeNull();

    // F1: yardage surfaced on HoleMeta for the hole-context row.
    expect(m.holes[0].yardage).toBe(300);
    expect(m.holes[17].yardage).toBe(470);

    expect(m.state.result).toBe("side_b");
    expect(m.state.margin).toBe("1 UP");
    expect(m.state.holesUp).toBe(-1);
    expect(m.state.thru).toBe(18);
    expect(m.state.closedOutHole).toBeNull();
    // 1 hole to B, 17 halved: pointsA = 17×0.5, pointsB = 1 + 17×0.5.
    expect(m.state.pointsA).toBe(8.5);
    expect(m.state.pointsB).toBe(9.5);

    expect(m.resolved.result).toBe("side_b");
    expect(m.resolved.pointsA).toBe(0);
    expect(m.resolved.pointsB).toBe(1);
    expect(m.isIncomplete).toBe(false);
  });
});

// ── Golden: four-ball ───────────────────────────────────────────────────────
// A(10,10) vs B(10,11). min = 10 ⇒ matchStrokes [0,0,0,1]; B's 11 gets 1 on SI1.
// Best-ball: side A net 4 all; side B best net 3 on hole 1, 4 else ⇒ B 1 UP.
describe("loadMatch — four-ball golden", () => {
  it("best-of-side nets drive a 1 UP for side B", async () => {
    fakeRef.current = new FakeSupabase(
      baseData({
        players: [
          { id: 1, full_name: "A1", display_name: "A1", handicap_index: 10, is_active: true },
          { id: 2, full_name: "A2", display_name: "A2", handicap_index: 10, is_active: true },
          { id: 3, full_name: "B1", display_name: "B1", handicap_index: 10, is_active: true },
          { id: 4, full_name: "B2", display_name: "B2", handicap_index: 11, is_active: true },
        ],
        round_players: [
          { id: 101, round_id: 50, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 102, round_id: 50, player_id: 2, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 103, round_id: 50, player_id: 3, team_number: 2, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 104, round_id: 50, player_id: 4, team_number: 2, tee_id: 1, course_handicap: 11, handicap_index_snapshot: 11 },
        ],
        scores: [...grossAll(101, 4, 1000), ...grossAll(102, 4, 2000), ...grossAll(103, 4, 3000), ...grossAll(104, 4, 4000)],
        tournament_sessions: [{ id: 9, tournament_id: 1, round_id: 50, day_number: 2, name: "Day 2 — Four-ball", format: "four_ball_match", played_on: "2026-08-01", is_locked: false }],
        tournament_matches: [{ id: 501, tournament_id: 1, session_id: 9, match_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null }],
      }),
    );

    const m = await loadMatch(501);
    expect(m.sideA.players.map((p) => p.matchStrokes)).toEqual([0, 0]);
    expect(m.sideB.players.map((p) => p.matchStrokes)).toEqual([0, 1]);
    expect(m.state.result).toBe("side_b");
    expect(m.state.margin).toBe("1 UP");
    expect(m.resolved.result).toBe("side_b");
    expect(m.isIncomplete).toBe(false);
  });
});

// ── Golden: greensomes ──────────────────────────────────────────────────────
// A pair (10,10) collapses to 10; B pair (11,11) collapses to 11. Side strokes
// [0,1]; B side gets 1 on SI1. Team gross 4 all ⇒ B side net 3 on hole 1 ⇒ 1 UP.
describe("loadMatch — greensomes golden", () => {
  it("collapsed side handicaps and team-gross nets drive the result", async () => {
    const teamScores = (team: number, g: number) =>
      Array.from({ length: 18 }, (_, i) => ({ id: team * 1000 + i, round_id: 50, team_number: team, hole_number: i + 1, ball_index: 1, strokes: g }));
    fakeRef.current = new FakeSupabase(
      baseData({
        players: [
          { id: 1, full_name: "A1", display_name: "A1", handicap_index: 10, is_active: true },
          { id: 2, full_name: "A2", display_name: "A2", handicap_index: 10, is_active: true },
          { id: 3, full_name: "B1", display_name: "B1", handicap_index: 11, is_active: true },
          { id: 4, full_name: "B2", display_name: "B2", handicap_index: 11, is_active: true },
        ],
        round_players: [
          { id: 101, round_id: 50, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 102, round_id: 50, player_id: 2, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 103, round_id: 50, player_id: 3, team_number: 2, tee_id: 1, course_handicap: 11, handicap_index_snapshot: 11 },
          { id: 104, round_id: 50, player_id: 4, team_number: 2, tee_id: 1, course_handicap: 11, handicap_index_snapshot: 11 },
        ],
        scores: [],
        team_scores: [...teamScores(1, 4), ...teamScores(2, 4)],
        tournament_sessions: [{ id: 9, tournament_id: 1, round_id: 50, day_number: 1, name: "Day 1 — Greensomes", format: "greensomes", played_on: "2026-08-01", is_locked: false }],
        tournament_matches: [{ id: 502, tournament_id: 1, session_id: 9, match_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null }],
      }),
    );

    const m = await loadMatch(502);
    expect(m.sideA.collapsedHandicap).toBe(10);
    expect(m.sideB.collapsedHandicap).toBe(11);
    expect(m.sideA.sideMatchStrokes).toBe(0);
    expect(m.sideB.sideMatchStrokes).toBe(1);
    expect(m.state.result).toBe("side_b");
    expect(m.state.margin).toBe("1 UP");
    expect(m.resolved.result).toBe("side_b");
  });
});

// ── Admin override precedence ───────────────────────────────────────────────
describe("loadMatch — admin override", () => {
  it("an admin-set result wins over the engine (envelope-rule halved on an empty scorecard)", async () => {
    fakeRef.current = new FakeSupabase(
      baseData({
        players: [
          { id: 1, full_name: "Al A", display_name: "Al", handicap_index: 10, is_active: true },
          { id: 2, full_name: "Bo B", display_name: "Bo", handicap_index: 11, is_active: true },
        ],
        round_players: [
          { id: 101, round_id: 50, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 102, round_id: 50, player_id: 2, team_number: 2, tee_id: 1, course_handicap: 11, handicap_index_snapshot: 11 },
        ],
        scores: [], // no scores at all
        tournament_sessions: [{ id: 9, tournament_id: 1, round_id: 50, day_number: 3, name: "Day 3", format: "singles_match", played_on: "2026-08-01", is_locked: false }],
        tournament_matches: [{ id: 503, tournament_id: 1, session_id: 9, match_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "complete", result: "halved", result_source: "admin", closed_out_hole: null, scorer_label: null, admin_note: "withdrawal" }],
      }),
    );

    const m = await loadMatch(503);
    expect(m.state.result).toBeNull(); // engine sees nothing
    expect(m.resolved.result).toBe("halved"); // admin wins
    expect(m.resolved.source).toBe("admin");
    expect(m.resolved.pointsA).toBe(0.5);
    expect(m.resolved.pointsB).toBe(0.5);
  });
});

// ── Cross-surface strokes equality (standing rule) ──────────────────────────
describe("loadMatch — cross-surface strokes", () => {
  it("per-player matchStrokes equal what matchplay computes from the same CHs, in order", async () => {
    fakeRef.current = new FakeSupabase(
      baseData({
        players: [
          { id: 1, full_name: "A1", display_name: "A1", handicap_index: 8, is_active: true },
          { id: 2, full_name: "A2", display_name: "A2", handicap_index: 20, is_active: true },
          { id: 3, full_name: "B1", display_name: "B1", handicap_index: 12, is_active: true },
          { id: 4, full_name: "B2", display_name: "B2", handicap_index: 5, is_active: true },
        ],
        round_players: [
          { id: 101, round_id: 50, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 8, handicap_index_snapshot: 8 },
          { id: 102, round_id: 50, player_id: 2, team_number: 1, tee_id: 1, course_handicap: 20, handicap_index_snapshot: 20 },
          { id: 103, round_id: 50, player_id: 3, team_number: 2, tee_id: 1, course_handicap: 12, handicap_index_snapshot: 12 },
          { id: 104, round_id: 50, player_id: 4, team_number: 2, tee_id: 1, course_handicap: 5, handicap_index_snapshot: 5 },
        ],
        scores: [],
        tournament_sessions: [{ id: 9, tournament_id: 1, round_id: 50, day_number: 2, name: "Day 2", format: "four_ball_match", played_on: "2026-08-01", is_locked: false }],
        tournament_matches: [{ id: 504, tournament_id: 1, session_id: 9, match_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null }],
      }),
    );

    const m = await loadMatch(504);
    // The engine's own stroke math over [8,20,12,5] in aThenB order.
    const expected = computeMatchStrokes([8, 20, 12, 5]);
    const got = [...m.sideA.players.map((p) => p.matchStrokes), ...m.sideB.players.map((p) => p.matchStrokes)];
    expect(got).toEqual(expected);
  });
});

// ── Batching & truncation ───────────────────────────────────────────────────
describe("loadSessionMatches — batching", () => {
  function twoGroupSeed(): FakeData {
    return baseData({
      players: [
        { id: 1, full_name: "A1", display_name: "A1", handicap_index: 10, is_active: true },
        { id: 2, full_name: "B1", display_name: "B1", handicap_index: 10, is_active: true },
        { id: 3, full_name: "A2", display_name: "A2", handicap_index: 10, is_active: true },
        { id: 4, full_name: "B2", display_name: "B2", handicap_index: 10, is_active: true },
      ],
      round_players: [
        { id: 101, round_id: 50, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
        { id: 102, round_id: 50, player_id: 2, team_number: 2, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
        { id: 103, round_id: 50, player_id: 3, team_number: 3, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
        { id: 104, round_id: 50, player_id: 4, team_number: 4, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
      ],
      scores: [...grossAll(101, 4, 1000), ...grossAll(102, 4, 2000), ...grossAll(103, 4, 3000), ...grossAll(104, 4, 4000)],
      tournament_sessions: [{ id: 9, tournament_id: 1, round_id: 50, day_number: 3, name: "Day 3", format: "singles_match", played_on: "2026-08-01", is_locked: false }],
      tournament_matches: [
        { id: 500, tournament_id: 1, session_id: 9, match_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null },
        { id: 501, tournament_id: 1, session_id: 9, match_number: 2, side_a_team_number: 3, side_b_team_number: 4, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null },
      ],
    });
  }

  it("issues ONE scores read and ONE matches read for a multi-match session (not per match)", async () => {
    fakeRef.current = new FakeSupabase(twoGroupSeed());
    const matches = await loadSessionMatches(9);
    expect(matches).toHaveLength(2);
    const calls = fakeRef.current.fromCalls as string[];
    expect(calls.filter((t) => t === "scores")).toHaveLength(1);
    expect(calls.filter((t) => t === "tournament_matches")).toHaveLength(1);
    expect(calls.filter((t) => t === "round_players")).toHaveLength(1);
  });

  it("detects a scores read at the row cap instead of returning it silently short", async () => {
    const seed = twoGroupSeed();
    // 1000 rows returned for one `.in()` ⇒ possibly truncated ⇒ throw.
    seed.scores = Array.from({ length: 1000 }, (_, i) => ({ id: 90000 + i, round_player_id: 101, hole_number: (i % 18) + 1, strokes: 4 }));
    fakeRef.current = new FakeSupabase(seed);
    await expect(loadSessionMatches(9)).rejects.toBeInstanceOf(ScoresTruncatedError);
  });
});

// ── Mixed tees (correction #6): refuse, never silently mis-allocate ──────────
describe("loadMatch — mixed tees", () => {
  it("throws MixedTeesInMatchError when a match's players span two tees", async () => {
    fakeRef.current = new FakeSupabase(
      baseData({
        holes: [...holes(1), ...holes(2)],
        players: [
          { id: 1, full_name: "Al A", display_name: "Al", handicap_index: 10, is_active: true },
          { id: 2, full_name: "Bo B", display_name: "Bo", handicap_index: 11, is_active: true },
        ],
        round_players: [
          { id: 101, round_id: 50, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 102, round_id: 50, player_id: 2, team_number: 2, tee_id: 2, course_handicap: 11, handicap_index_snapshot: 11 },
        ],
        scores: [],
        tournament_sessions: [{ id: 9, tournament_id: 1, round_id: 50, day_number: 3, name: "Day 3", format: "singles_match", played_on: "2026-08-01", is_locked: false }],
        tournament_matches: [{ id: 505, tournament_id: 1, session_id: 9, match_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null }],
      }),
    );
    await expect(loadMatch(505)).rejects.toBeInstanceOf(MixedTeesInMatchError);
  });
});
