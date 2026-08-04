// S4 perf — loadRoundTeamsOnly parity. The teamsOnly projection is a SEPARATE
// lightweight path from loadRoundResults; this proves it never diverges on the
// only things the History list shows: per-team RANK, NAME, ROSTER, PLAYER IDS,
// and TOTAL (value + string + place). It reuses the SAME total + rank SSOT
// helpers, so equality is by construction — this test is the guard that it
// stays that way. Seeds span the engine paths: best-N (2-Ball), Stableford,
// Par Competition (descending, record style), and a Best Ball where gross order
// ≠ net order (handicaps must be applied).

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
import { loadRoundTeamsOnly } from "@/lib/round/results";

// 18 par-4 holes on tee 1, stroke_index = hole number.
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

function seed(): FakeData {
  return {
    rounds: [
      {
        id: 1, played_on: "2026-05-13", course_id: 1, is_complete: true,
        format: "2_ball", format_config: { basis: "net", best_n: 2, override_holes: [] },
        format_locked_at: "2026-05-13T00:00:00Z", created_at: "2026-05-13T00:00:00Z",
      },
      {
        id: 2, played_on: "2026-05-20", course_id: 1, is_complete: true,
        format: "gobs_stableford", format_config: { basis: "net", override_holes: [] },
        format_locked_at: "2026-05-20T00:00:00Z", created_at: "2026-05-20T00:00:00Z",
      },
      {
        id: 4, played_on: "2026-06-03", course_id: 1, is_complete: true,
        format: "par_competition", format_config: { basis: "net", override_holes: [] },
        format_locked_at: "2026-06-03T00:00:00Z", created_at: "2026-06-03T00:00:00Z",
      },
      {
        id: 10, played_on: "2026-05-30", course_id: 1, is_complete: true,
        format: "best_ball", format_config: { basis: "net", override_holes: [] },
        format_locked_at: "2026-05-30T00:00:00Z", created_at: "2026-05-30T00:00:00Z",
      },
    ],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes: holes(),
    round_players: [
      // Round 1 — Team 1 (better) vs Team 2 (2-Ball, best-N).
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 6, dropped_after_hole: null },
      { id: 102, round_id: 1, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 10, dropped_after_hole: null },
      { id: 103, round_id: 1, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 8, dropped_after_hole: null },
      { id: 104, round_id: 1, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 12, dropped_after_hole: null },
      // Round 2 — Stableford.
      { id: 201, round_id: 2, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 6, dropped_after_hole: null },
      { id: 202, round_id: 2, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 10, dropped_after_hole: null },
      { id: 203, round_id: 2, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 8, dropped_after_hole: null },
      { id: 204, round_id: 2, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 12, dropped_after_hole: null },
      // Round 4 — Par Competition (descending, record style).
      { id: 401, round_id: 4, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 6, dropped_after_hole: null },
      { id: 402, round_id: 4, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 10, dropped_after_hole: null },
      { id: 403, round_id: 4, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 8, dropped_after_hole: null },
      { id: 404, round_id: 4, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 12, dropped_after_hole: null },
      // Round 10 — Best Ball; gross order ≠ net order.
      { id: 311, round_id: 10, player_id: 301, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
      { id: 312, round_id: 10, player_id: 302, tee_id: 1, team_number: 2, course_handicap: 36, dropped_after_hole: null },
    ],
    players: [
      { id: 201, full_name: "Alice Adams", display_name: "Alice", handicap_index: 6, preferred_tee_id: 1, is_active: true },
      { id: 202, full_name: "Bob Brown", display_name: "Bob", handicap_index: 10, preferred_tee_id: 1, is_active: true },
      { id: 203, full_name: "Carol Clark", display_name: "Carol", handicap_index: 8, preferred_tee_id: 1, is_active: true },
      { id: 204, full_name: "Dave Davis", display_name: "Dave", handicap_index: 12, preferred_tee_id: 1, is_active: true },
      { id: 301, full_name: "Scratch Sam", display_name: "Sam", handicap_index: 0, preferred_tee_id: 1, is_active: true },
      { id: 302, full_name: "Bogey Bob", display_name: "Bob", handicap_index: 36, preferred_tee_id: 1, is_active: true },
    ],
    scores: [
      ...scoresFor(101, 4, 1000), ...scoresFor(102, 5, 1100),
      ...scoresFor(103, 5, 1200), ...scoresFor(104, 6, 1300),
      ...scoresFor(201, 4, 2000), ...scoresFor(202, 4, 2100),
      ...scoresFor(203, 5, 2200), ...scoresFor(204, 6, 2300),
      ...scoresFor(401, 4, 4000), ...scoresFor(402, 4, 4100),
      ...scoresFor(403, 5, 4200), ...scoresFor(404, 5, 4300),
      ...scoresFor(311, 4, 5000), ...scoresFor(312, 5, 5100),
    ],
  };
}

// The whole assertion: teamsOnly === loadRoundResults, team-for-team, on every
// field the History list reads.
async function assertParity(roundId: number) {
  const detail = await loadRoundResults(roundId);
  const lite = await loadRoundTeamsOnly(roundId);
  expect(detail.status).toBe("ok");
  expect(lite.status).toBe("ok");
  if (detail.status !== "ok" || lite.status !== "ok") return;

  // Same set of teams, same flat (section-ranked) order.
  expect(lite.data.teams.map(t => t.teamNumber)).toEqual(detail.data.teams.map(t => t.id));
  expect(lite.data.format).toBe(detail.data.format);
  expect(lite.data.playedOn).toBe(detail.data.playedOn);

  const detailByTeam = new Map(detail.data.teams.map(t => [t.id, t]));
  for (const t of lite.data.teams) {
    const d = detailByTeam.get(t.teamNumber)!;
    expect(t.rank).toBe(d.rank);
    expect(t.name).toBe(d.name);
    expect(t.rosterDisplay).toBe(d.rosterDisplay);
    expect(t.total).toBe(d.total);
    expect(t.totalLabel).toBe(d.totalLabel);
    expect(t.placeLabel).toBe(d.placeLabel);
    expect(t.playerIds.slice().sort()).toEqual(d.players.map(p => p.playerId).sort());
  }
}

describe("loadRoundTeamsOnly — parity with loadRoundResults", () => {
  beforeEach(() => {
    fakeRef.current = new FakeSupabase(seed());
  });

  it("best-N (2-Ball) — rank/name/roster/total/place all match the detail", async () => {
    await assertParity(1);
  });

  it("Stableford — points totals + rank match the detail", async () => {
    await assertParity(2);
  });

  it("Par Competition (descending, record style) — matches the detail", async () => {
    await assertParity(4);
  });

  it("Best Ball where gross ≠ net — ranks by NET, matches the detail", async () => {
    await assertParity(10);
    // Sanity: the net winner (Team 2, 2 strokes/hole) is NOT the lower-gross team.
    const lite = await loadRoundTeamsOnly(10);
    if (lite.status !== "ok") throw new Error("expected ok");
    expect(lite.data.teams[0].teamNumber).toBe(2);
  });

  it("injected roster + holes produce the SAME result as self-fetched", async () => {
    const selfFetched = await loadRoundTeamsOnly(1);
    const injected = await loadRoundTeamsOnly(1, {
      activeRoster: seed().players.map(p => ({ id: p.id, full_name: p.full_name })) as any,
      holesByTee: {
        1: holes().map(h => ({ holeNumber: h.hole_number, par: h.par, strokeIndex: h.stroke_index })),
      },
    });
    expect(injected).toEqual(selfFetched);
  });
});
