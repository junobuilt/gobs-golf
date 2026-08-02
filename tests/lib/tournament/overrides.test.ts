// Phase 4 Commit B — admin overrides (3 levels). Each writer targets an EXISTING
// column/table and the canonical loader surfaces it as authoritative:
//   L1 hole  → scores upsert; the engine recomputes the outcome (loadMatch).
//   L2 match → tournament_matches result/result_source/admin_note; resolveMatchResult wins.
//   L3 points→ tournament_point_adjustments; computeTournamentStandings folds into banked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { loadMatch } from "@/lib/tournament/loadMatch";
import { loadDashboard } from "@/lib/tournament/loadDashboard";
import {
  addPointAdjustment,
  deletePointAdjustment,
  InvalidHoleScoreError,
  InvalidPointAdjustmentError,
  overrideMatchResult,
  revertMatchResult,
  setMatchHoleScore,
} from "@/lib/tournament/mutations";

function holes(teeId = 1) {
  return Array.from({ length: 18 }, (_, i) => ({ id: teeId * 100 + i + 1, tee_id: teeId, hole_number: i + 1, par: 4, stroke_index: i + 1, yardage: 350 }));
}
function grossAll(rpId: number, g: number, startId: number) {
  return Array.from({ length: 18 }, (_, i) => ({ id: startId + i, round_player_id: rpId, hole_number: i + 1, strokes: g }));
}
const TOURN = { id: 1, name: "Cup", is_active: true, is_published: true, started_on: "2026-08-01", side_a_name: "USA", side_b_name: "Canada", holder_side: "b", season_id: null, ended_on: null, notes: null };

// One singles day, one match: A (CH10) vs B (CH10), all gross 4 → engine "halved".
function seed(): FakeData {
  return {
    rounds: [{ id: 50, played_on: "2026-08-01", course_id: 1, tournament_id: 1, season_id: null }],
    tees: [],
    holes: holes(1),
    players: [
      { id: 1, full_name: "Al", display_name: "Al", handicap_index: 10, is_active: true },
      { id: 2, full_name: "Bo", display_name: "Bo", handicap_index: 10, is_active: true },
    ],
    round_players: [
      { id: 101, round_id: 50, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
      { id: 102, round_id: 50, player_id: 2, team_number: 2, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
    ],
    scores: [...grossAll(101, 4, 1000), ...grossAll(102, 4, 2000)],
    team_scores: [],
    tournaments: [TOURN],
    tournament_players: [],
    tournament_sessions: [{ id: 9, tournament_id: 1, round_id: 50, day_number: 1, name: "Day 1", format: "singles_match", played_on: "2026-08-01", is_locked: false }],
    tournament_matches: [{ id: 500, tournament_id: 1, session_id: 9, match_number: 1, group_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, flagged_holes: [], admin_note: null }],
    tournament_point_adjustments: [],
  };
}

beforeEach(() => {
  fakeRef.current = new FakeSupabase(seed());
});

describe("Level 2 — match result override (canonical, envelope rule, reversible)", () => {
  it("overrideMatchResult writes tournament_matches and resolveMatchResult honors it over the engine", async () => {
    // Engine sees "halved"; admin forces side_b.
    const before = await loadMatch(500);
    expect(before.state.result).toBe("halved");
    expect(before.resolved.result).toBe("halved");

    await overrideMatchResult(500, "side_b", "protest upheld");

    const write = fakeRef.current.writes.find((w: any) => w.table === "tournament_matches" && w.type === "update");
    expect(write.payload).toMatchObject({ result: "side_b", result_source: "admin", admin_note: "protest upheld" });

    const after = await loadMatch(500);
    expect(after.state.result).toBe("halved"); // engine unchanged
    expect(after.resolved.result).toBe("side_b"); // admin wins
    expect(after.resolved.source).toBe("admin");
    expect(after.resolved.pointsA).toBe(0);
    expect(after.resolved.pointsB).toBe(1);
  });

  it("revertMatchResult restores the engine result", async () => {
    await overrideMatchResult(500, "side_a", null);
    expect((await loadMatch(500)).resolved.result).toBe("side_a");

    await revertMatchResult(500);
    const reverted = await loadMatch(500);
    expect(reverted.resolved.source).toBe("engine");
    expect(reverted.resolved.result).toBe("halved");
    expect(reverted.match.admin_note).toBeNull();
  });

  it("rejects an invalid result value", async () => {
    await expect(overrideMatchResult(500, "nope" as any, null)).rejects.toThrow(/invalid result/);
  });
});

describe("Level 1 — hole correction (engine recomputes)", () => {
  it("setMatchHoleScore upserts scores and flips the recomputed outcome", async () => {
    // Correct Bo's hole 1 to a 6 → Al (side A) wins hole 1 → side_a.
    await setMatchHoleScore(102, 1, 6);

    const write = fakeRef.current.writes.find((w: any) => w.table === "scores" && w.type === "upsert");
    expect(write.onConflict).toEqual(["round_player_id", "hole_number"]);
    expect(write.payload[0]).toMatchObject({ round_player_id: 102, hole_number: 1, strokes: 6 });

    const after = await loadMatch(500);
    expect(after.state.result).toBe("side_a"); // engine recomputed from the corrected score
    expect(after.resolved.result).toBe("side_a");
  });

  it("validates hole and strokes", async () => {
    await expect(setMatchHoleScore(102, 0, 4)).rejects.toBeInstanceOf(InvalidHoleScoreError);
    await expect(setMatchHoleScore(102, 19, 4)).rejects.toBeInstanceOf(InvalidHoleScoreError);
    await expect(setMatchHoleScore(102, 5, 0)).rejects.toBeInstanceOf(InvalidHoleScoreError);
  });
});

describe("Level 3 — country-point adjustments (folded into banked, reversible)", () => {
  it("addPointAdjustment inserts and the dashboard banks it", async () => {
    await addPointAdjustment(1, "a", 0.5, "envelope rule");

    const write = fakeRef.current.writes.find((w: any) => w.table === "tournament_point_adjustments" && w.type === "insert");
    expect(write.payload[0]).toMatchObject({ tournament_id: 1, side: "a", points: 0.5, reason: "envelope rule" });

    const d = await loadDashboard(1);
    // The one match is halved (0.5/0.5); the adjustment adds +0.5 to A.
    expect(d.standings.banked.a).toBe(1.0);
    expect(d.standings.banked.b).toBe(0.5);
    expect(d.adjustments).toHaveLength(1);
  });

  it("deletePointAdjustment reverses it", async () => {
    await addPointAdjustment(1, "b", 1, "penalty");
    const id = (fakeRef.current.data.tournament_point_adjustments as any[])[0].id;
    await deletePointAdjustment(id);
    const d = await loadDashboard(1);
    expect(d.adjustments).toHaveLength(0);
    expect(d.standings.banked.b).toBe(0.5); // only the halve remains
  });

  it("validates side, non-zero points, and a required reason", async () => {
    await expect(addPointAdjustment(1, "c" as any, 1, "x")).rejects.toBeInstanceOf(InvalidPointAdjustmentError);
    await expect(addPointAdjustment(1, "a", 0, "x")).rejects.toBeInstanceOf(InvalidPointAdjustmentError);
    await expect(addPointAdjustment(1, "a", 1, "   ")).rejects.toBeInstanceOf(InvalidPointAdjustmentError);
  });
});

describe("cross-surface: an override shows as canonical on the dashboard", () => {
  it("a forced match result changes the dashboard banked total (dashboard === override)", async () => {
    // Baseline: halved → 0.5 / 0.5.
    let d = await loadDashboard(1);
    expect(d.standings.banked).toEqual({ a: 0.5, b: 0.5 });

    // Force side_a → dashboard must bank A a full point, B zero.
    await overrideMatchResult(500, "side_a", "envelope");
    d = await loadDashboard(1);
    expect(d.standings.banked).toEqual({ a: 1, b: 0 });

    // The independent SSOT sum still equals banked.
    let sumA = 0;
    let sumB = 0;
    for (const day of d.days) for (const m of day.matches) { sumA += m.resolved.pointsA; sumB += m.resolved.pointsB; }
    expect(d.standings.banked).toEqual({ a: sumA, b: sumB });
  });
});
