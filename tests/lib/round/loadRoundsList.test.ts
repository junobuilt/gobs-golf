// F.1 — trimmed History list loader. The headline assertion is PARITY: every
// team's total string from loadRoundsList must equal the same team's string
// from loadRoundResults (the detail), for BOTH a best-N and a Stableford round.
// That is the whole point of the shared teamTotals.ts + rankAndFormat.ts cores.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { loadRoundsList } from "@/lib/round/loadRoundsList";
import { loadRoundResults } from "@/lib/round/results";

// 18 par-4 holes on tee 1, stroke_index = hole number.
function holes() {
  return Array.from({ length: 18 }, (_, i) => ({
    id: i + 1, tee_id: 1, hole_number: i + 1, par: 4, yardage: 350, stroke_index: i + 1,
  }));
}

// Per-player 18 gross scores, all the same value, to give teams a spread.
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
      // An in-progress round — must be EXCLUDED from the finalized list.
      {
        id: 3, played_on: "2026-05-27", course_id: 1, is_complete: false,
        format: "2_ball", format_config: { basis: "net", best_n: 2, override_holes: [] },
        format_locked_at: null, created_at: "2026-05-27T00:00:00Z",
      },
    ],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes: holes(),
    round_players: [
      // Round 1 — Team 1 (better) vs Team 2.
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 6, dropped_after_hole: null },
      { id: 102, round_id: 1, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 10, dropped_after_hole: null },
      { id: 103, round_id: 1, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 8, dropped_after_hole: null },
      { id: 104, round_id: 1, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 12, dropped_after_hole: null },
      // Round 2 — same shape, Stableford.
      { id: 201, round_id: 2, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 6, dropped_after_hole: null },
      { id: 202, round_id: 2, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 10, dropped_after_hole: null },
      { id: 203, round_id: 2, player_id: 203, tee_id: 1, team_number: 2, course_handicap: 8, dropped_after_hole: null },
      { id: 204, round_id: 2, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 12, dropped_after_hole: null },
    ],
    players: [
      { id: 201, full_name: "Alice Adams", display_name: "Alice", handicap_index: 6, preferred_tee_id: 1, is_active: true },
      { id: 202, full_name: "Bob Brown", display_name: "Bob", handicap_index: 10, preferred_tee_id: 1, is_active: true },
      { id: 203, full_name: "Carol Clark", display_name: "Carol", handicap_index: 8, preferred_tee_id: 1, is_active: true },
      { id: 204, full_name: "Dave Davis", display_name: "Dave", handicap_index: 12, preferred_tee_id: 1, is_active: true },
    ],
    scores: [
      // Round 1: team 1 mostly pars, team 2 mostly bogeys → a real spread.
      ...scoresFor(101, 4, 1000),
      ...scoresFor(102, 5, 1100),
      ...scoresFor(103, 5, 1200),
      ...scoresFor(104, 6, 1300),
      // Round 2: different scores again.
      ...scoresFor(201, 4, 2000),
      ...scoresFor(202, 4, 2100),
      ...scoresFor(203, 5, 2200),
      ...scoresFor(204, 6, 2300),
    ],
  };
}

describe("loadRoundsList", () => {
  beforeEach(() => {
    fakeRef.current = new FakeSupabase(seed());
  });

  it("returns only finalized rounds (the in-progress round is excluded)", async () => {
    const items = await loadRoundsList();
    expect(items.map(i => i.roundId).sort()).toEqual([1, 2]);
  });

  it("ranks teams and exposes playerIds for the player filter", async () => {
    const items = await loadRoundsList();
    const r1 = items.find(i => i.roundId === 1)!;
    expect(r1.teams.map(t => t.rank)).toEqual([1, 2]);
    // Team 1 (Alice + Bob) should win on net here.
    expect(r1.teams[0].teamNumber).toBe(1);
    expect(r1.teams[0].playerIds.sort()).toEqual([201, 202]);
    expect(r1.hasBlindDraws).toBe(false);
  });

  // THE parity test: list total string === detail total string, per team.
  it("total strings match the detail (loadRoundResults) — best-N round", async () => {
    const list = (await loadRoundsList()).find(i => i.roundId === 1)!;
    const detail = await loadRoundResults(1);
    expect(detail.status).toBe("ok");
    if (detail.status !== "ok") return;

    const detailByTeam = new Map(detail.data.teams.map(t => [t.id, t.totalLabel]));
    for (const t of list.teams) {
      expect(t.totalLabel).toBe(detailByTeam.get(t.teamNumber));
    }
    // And the delta is a real signed string, not empty.
    expect(list.teams[0].totalLabel).toMatch(/^[−+]?\d|^E$/);
  });

  it("total strings match the detail — Stableford round (points, not delta)", async () => {
    const list = (await loadRoundsList()).find(i => i.roundId === 2)!;
    const detail = await loadRoundResults(2);
    expect(detail.status).toBe("ok");
    if (detail.status !== "ok") return;

    const detailByTeam = new Map(detail.data.teams.map(t => [t.id, t.totalLabel]));
    for (const t of list.teams) {
      expect(t.totalLabel).toBe(detailByTeam.get(t.teamNumber));
    }
    expect(list.teams[0].totalLabel).toMatch(/pts$/);
  });
});

// Negative control for the truncation regression: a round where GROSS order ≠
// NET order. The old batched loader truncated its scores fetch (Supabase
// 1000-row cap) and produced near-E garbage with the wrong winner; the
// projection must rank by NET and agree with loadRoundResults team-for-team.
function grossNetSeed(): FakeData {
  return {
    rounds: [
      {
        id: 10, played_on: "2026-05-30", course_id: 1, is_complete: true,
        format: "best_ball", format_config: { basis: "net", override_holes: [] },
        format_locked_at: "2026-05-30T00:00:00Z", created_at: "2026-05-30T00:00:00Z",
      },
    ],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes: holes(),
    round_players: [
      // Team 1: scratch (CH 0), LOWER gross (72) → would win on gross.
      { id: 311, round_id: 10, player_id: 301, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
      // Team 2: CH 36 (2 strokes/hole), HIGHER gross (90) → wins on NET.
      { id: 312, round_id: 10, player_id: 302, tee_id: 1, team_number: 2, course_handicap: 36, dropped_after_hole: null },
    ],
    players: [
      { id: 301, full_name: "Scratch Sam", display_name: "Sam", handicap_index: 0, preferred_tee_id: 1, is_active: true },
      { id: 302, full_name: "Bogey Bob", display_name: "Bob", handicap_index: 36, preferred_tee_id: 1, is_active: true },
    ],
    scores: [...scoresFor(311, 4, 5000), ...scoresFor(312, 5, 5100)],
  };
}

describe("loadRoundsList — net ranking (gross ≠ net negative control)", () => {
  beforeEach(() => {
    fakeRef.current = new FakeSupabase(grossNetSeed());
  });

  it("ranks by NET (not gross) and agrees with loadRoundResults team-for-team", async () => {
    const list = (await loadRoundsList()).find(i => i.roundId === 10)!;
    const detail = await loadRoundResults(10);
    expect(detail.status).toBe("ok");
    if (detail.status !== "ok") return;

    // Gross winner is Team 1 (72 < 90). NET winner is Team 2 (2 strokes/hole).
    expect(list.teams[0].teamNumber).toBe(2); // net winner ranks 1st...
    expect(list.teams[0].teamNumber).not.toBe(1); // ...NOT the lower-gross team

    // Projection == canonical: same rank + same total string, per team.
    const detailByTeam = new Map(
      detail.data.teams.map(t => [t.id, { rank: t.rank, label: t.totalLabel }]),
    );
    for (const t of list.teams) {
      expect(t.rank).toBe(detailByTeam.get(t.teamNumber)!.rank);
      expect(t.totalLabel).toBe(detailByTeam.get(t.teamNumber)!.label);
    }

    // Strongly negative net delta proves handicaps were applied — NOT the
    // near-E the truncated (scoreless) loader produced.
    expect(list.teams[0].total).toBeLessThan(-10);
  });
});
