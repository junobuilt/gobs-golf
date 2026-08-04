// Phase 4 — dashboard roll-up loader. THE HEADLINE test of this relay: the
// dashboard's country total must EQUAL the loader's own per-match resolved
// points + adjustments — asserted directly, not "each surface renders". This is
// the SSOT-drift guard (the History-wrong-winners bug class: a dashboard number
// that disagrees with the match card). Halves = ½ each.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { loadDashboard } from "@/lib/tournament/loadDashboard";
import { matchStatusLine } from "@/lib/tournament/dashboardFormat";
import { thruDisplay } from "@/lib/tournament/matchScorecard";

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

// Gross `g` on holes 1..upto for a round_player (default all 18).
function gross(rpId: number, g: number, startId: number, upto = 18) {
  return Array.from({ length: upto }, (_, i) => ({
    id: startId + i,
    round_player_id: rpId,
    hole_number: i + 1,
    strokes: g,
  }));
}

const TOURN = {
  id: 1,
  name: "Cup",
  is_active: true,
  is_published: true,
  planned_match_total: null,
  started_on: "2026-08-01",
  side_a_name: "USA",
  side_b_name: "Canada",
  holder_side: "b",
  season_id: null,
  ended_on: null,
  notes: null,
};

function match(id: number, session_id: number, match_number: number, aTeam: number, bTeam: number, over?: Partial<any>) {
  return {
    id,
    tournament_id: 1,
    session_id,
    match_number,
    group_number: match_number,
    side_a_team_number: aTeam,
    side_b_team_number: bTeam,
    status: "pending",
    result: null,
    result_source: "engine",
    closed_out_hole: null,
    scorer_label: null,
    flagged_holes: [],
    admin_note: null,
    is_voided: false,
    ...over,
  };
}

function rp(id: number, roundId: number, playerId: number, team: number, ch: number) {
  return { id, round_id: roundId, player_id: playerId, team_number: team, tee_id: 1, course_handicap: ch, handicap_index_snapshot: ch };
}

// Two singles days. Day 1 (round 50, session 9): M500 halved (all CH10, gross 4),
// M501 side_b (A CH10 vs B CH11, gross 4 → B 1 UP on 18). Day 2 (round 60,
// session 10): M502 side_a (A CH11 vs B CH10 → A 1 UP), M503 in play (only holes
// 1..9 scored, A ahead, not closed), M504 early closeout (A gross 3 / B gross 5,
// scored through hole 12 → decides hole 10, thru 12).
function seed(): FakeData {
  return {
    rounds: [
      { id: 50, played_on: "2026-08-01", course_id: 1, tournament_id: 1, season_id: null },
      { id: 60, played_on: "2026-08-02", course_id: 1, tournament_id: 1, season_id: null },
    ],
    tees: [],
    holes: holes(1),
    players: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, full_name: `P${i + 1}`, display_name: `P${i + 1}`, handicap_index: 10, is_active: true })),
    round_players: [
      // Day 1
      rp(101, 50, 1, 1, 10), rp(102, 50, 2, 2, 10), // M500 halved
      rp(103, 50, 3, 3, 10), rp(104, 50, 4, 4, 11), // M501 → B
      // Day 2
      rp(201, 60, 5, 1, 11), rp(202, 60, 6, 2, 10), // M502 → A
      rp(203, 60, 7, 3, 10), rp(204, 60, 8, 4, 10), // M503 in play
      rp(205, 60, 9, 5, 10), rp(206, 60, 10, 6, 10), // M504 closeout
    ],
    scores: [
      // Day 1
      ...gross(101, 4, 1000), ...gross(102, 4, 1100),
      ...gross(103, 4, 1200), ...gross(104, 4, 1300),
      // Day 2 — M502 all 18
      ...gross(201, 4, 2000), ...gross(202, 4, 2100),
      // M503 — only holes 1..9 (A wins each: A gross 3, B gross 5) → in play, not closed by hole 9 (9 up? closes at h>18-h=9<... after 9: lead 9, remaining 9 → not > , so still live)
      ...gross(203, 3, 2200, 9), ...gross(204, 5, 2300, 9),
      // M504 — holes 1..12 (A gross 3, B gross 5) → A wins all, closes hole 10, scored thru 12
      ...gross(205, 3, 2400, 12), ...gross(206, 5, 2500, 12),
    ],
    team_scores: [],
    tournaments: [TOURN],
    tournament_players: [],
    tournament_sessions: [
      { id: 9, tournament_id: 1, round_id: 50, day_number: 1, name: "Day 1 — Singles", format: "singles_match", played_on: "2026-08-01", is_locked: false },
      { id: 10, tournament_id: 1, round_id: 60, day_number: 2, name: "Day 2 — Singles", format: "singles_match", played_on: "2026-08-02", is_locked: false },
    ],
    tournament_matches: [
      match(500, 9, 1, 1, 2),
      match(501, 9, 2, 3, 4),
      match(502, 10, 1, 1, 2),
      match(503, 10, 2, 3, 4),
      match(504, 10, 3, 5, 6),
    ],
    tournament_point_adjustments: [
      { id: 1, tournament_id: 1, side: "a", points: 0.5, reason: "envelope rule", created_at: "2026-08-02T10:00:00Z" },
    ],
  };
}

beforeEach(() => {
  fakeRef.current = new FakeSupabase(seed());
});

describe("loadDashboard — country total agreement (headline)", () => {
  it("dashboard banked === Σ per-match resolved points + adjustments (SSOT drift guard)", async () => {
    const d = await loadDashboard(1);

    // The loader's OWN per-match authoritative points, summed independently.
    let sumA = 0;
    let sumB = 0;
    for (const day of d.days) {
      for (const m of day.matches) {
        sumA += m.resolved.pointsA;
        sumB += m.resolved.pointsB;
      }
    }
    for (const adj of d.adjustments) {
      if (adj.side === "a") sumA += adj.points;
      else sumB += adj.points;
    }

    // The dashboard header reads standings.banked — it must be exactly that sum.
    expect(d.standings.banked.a).toBe(sumA);
    expect(d.standings.banked.b).toBe(sumB);

    // And the concrete expected values (hand-computed). Decided for A: M502 (+1),
    // M504 early-closeout (+1); for B: M501 (+1). The halve M500 splits 0.5/0.5.
    // Plus the +0.5 side-A adjustment. So
    //   A = 1(M502) + 1(M504) + 0.5(halve) + 0.5(adj) = 3.0
    //   B = 1(M501) + 0.5(halve)                      = 1.5
    expect(d.standings.banked.a).toBe(3.0);
    expect(d.standings.banked.b).toBe(1.5);
  });

  it("a halved match contributes exactly ½ to each side", async () => {
    const d = await loadDashboard(1);
    const halved = d.days.flatMap((x) => x.matches).find((m) => m.match.id === 500)!;
    expect(halved.resolved.result).toBe("halved");
    expect(halved.resolved.pointsA).toBe(0.5);
    expect(halved.resolved.pointsB).toBe(0.5);
  });

  it("in-play matches are not banked; banked + inPlay account for every match", async () => {
    const d = await loadDashboard(1);
    const total = d.days.reduce((n, x) => n + x.matches.length, 0);
    // M503 is the only live match.
    expect(d.standings.inPlay.map((e) => e.matchId)).toEqual([503]);
    const decided = total - d.standings.inPlay.length;
    expect(decided).toBe(4);
  });

  it("a voided match keeps its row but contributes NO points (migration 040)", async () => {
    // Void M502 (a decided side_a match worth +1 to A). Its row still loads, but
    // it drops out of the standings roll-up.
    const data = seed();
    data.tournament_matches = (data.tournament_matches ?? []).map((m) =>
      m.id === 502 ? { ...m, is_voided: true } : m,
    );
    fakeRef.current = new FakeSupabase(data);

    const d = await loadDashboard(1);
    // Row still present (createdCount unaffected).
    const m502 = d.days.flatMap((x) => x.matches).find((m) => m.match.id === 502);
    expect(m502?.match.is_voided).toBe(true);
    // But A's banked drops from 3.0 to 2.0 (lost the M502 point).
    expect(d.standings.banked.a).toBe(2.0);
    expect(d.standings.banked.b).toBe(1.5);
  });
});

describe("all-matches list reads MatchState", () => {
  it("a decided early-closeout reads closedOutHole, not thru", async () => {
    const d = await loadDashboard(1);
    const m = d.days.flatMap((x) => x.matches).find((x) => x.match.id === 504)!;
    // Scored through hole 12, but the match decided at hole 10.
    expect(m.state.thru).toBe(12);
    expect(m.state.closedOutHole).toBe(10);
    // The status helper must surface the closeout hole, never the raw thru.
    expect(thruDisplay(m.state)).toBe(10);
    const line = matchStatusLine(m);
    expect(line.decided).toBe(true);
    expect(line.text).toContain("USA wins"); // side_a, margin encodes the closeout
  });

  it("an in-play match reads margin + thru from the live engine", async () => {
    const d = await loadDashboard(1);
    const m = d.days.flatMap((x) => x.matches).find((x) => x.match.id === 503)!;
    expect(m.resolved.result).toBeNull();
    const line = matchStatusLine(m);
    expect(line.decided).toBe(false);
    expect(line.text).toContain("thru 9");
  });
});
