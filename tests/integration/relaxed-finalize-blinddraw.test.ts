// Spec 2 (migration 029) — relaxed-close finalize now BLIND-DRAWS short teams.
//
// These tests drive the e2e MockDb's handleRpc directly (the faithful JS mirror
// of the DEPLOYED apply_blind_draws_single_flight contract — the SQL is the
// source of truth; this asserts the OBSERVABLE effect the display layer reads).
//
// HONEST BOUNDARY (per the "designed ≠ works" rule): the SQL itself is NOT run
// here (no Postgres in vitest). The authoritative behavior proof of the draw
// logic — strict byte-identical, deterministic seed/order — is the migration-029
// relay dry-run on prod. This file proves the relaxed path's OBSERVABLE policy
// (fills a short team / doesn't, per fillsShortTeams) and the source-eligibility
// + pool-too-small contract, against the mock the Playwright specs also use.
//
// The strict single-flight path (finalize_round_with_blind_draws) has NO mock
// branch and is unchanged by this spec; its draw is covered by the deployed SQL
// + the existing loadRoundResults valuation fixtures + the multi-flight mock.

import { describe, it, expect } from "vitest";
import { MockDb, handleRpc, type SeedData } from "../../e2e/support/supabaseMock";
import { fillsShortTeams } from "@/lib/format/helpers";
import type { Format } from "@/lib/scoring/types";

let scoreId = 1000;
function scoresFor(rpId: number, miss: number[] = []) {
  const rows: any[] = [];
  for (let h = 1; h <= 18; h++) {
    if (!miss.includes(h)) rows.push({ id: scoreId++, round_player_id: rpId, hole_number: h, strokes: 4 });
  }
  return rows;
}

type RpSpec = { rpId: number; playerId: number; team: number; miss?: number[] };

function buildSeed(format: Format, rps: RpSpec[], opts: { teamCardScores?: boolean } = {}): SeedData {
  const round_players = rps.map((r) => ({
    id: r.rpId, round_id: 1, player_id: r.playerId, tee_id: 1,
    team_number: r.team, course_handicap: 0, dropped_after_hole: null,
  }));
  const scores = rps.flatMap((r) => scoresFor(r.rpId, r.miss ?? []));
  const players = rps.map((r) => ({
    id: r.playerId, full_name: `Player ${r.playerId}`, display_name: `P${r.playerId}`,
    handicap_index: 0, is_active: true, preferred_tee_id: 1,
  }));
  const seed: SeedData = {
    rounds: [{
      id: 1, played_on: "2026-05-13", course_id: 1, is_complete: false,
      format, format_config: { scoring_basis: "net", override_holes: [] },
      format_locked_at: "2026-05-13T00:00:00Z", created_at: "2026-05-13T00:00:00Z",
    }],
    tees: [{ id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 }],
    round_players,
    scores,
    players,
  };
  // Team-card finalize needs one team_scores ball per hole per assigned team.
  if (opts.teamCardScores) {
    const teams = [...new Set(rps.map((r) => r.team))];
    seed.team_scores = teams.flatMap((tn) =>
      Array.from({ length: 18 }, (_, i) => ({
        id: 5000 + tn * 100 + i, round_id: 1, team_number: tn,
        hole_number: i + 1, ball_index: 1, strokes: 4,
      })),
    );
  }
  return seed;
}

const drawCount = (db: MockDb) => (db.tables.blind_draws ?? []).length;

describe("relaxed finalize — blind-draw POLICY matrix (mock-covered formats)", () => {
  // One short team (team 2 has 1 player; team 1 has 2). fillsShortTeams decides
  // whether a fill is written. The strict single-flight formats aren't mock-
  // covered (see header) — the predicate test pins their policy separately.
  const RELAXED: Format[] = ["par_competition", "shambles"];
  const TEAM_CARD: Format[] = ["texas_scramble", "alternate_shot"];

  for (const fmt of RELAXED) {
    it(`${fmt}: fillsShortTeams=true → writes exactly one fill for the short team`, () => {
      expect(fillsShortTeams(fmt)).toBe(true);
      const db = new MockDb(buildSeed(fmt, [
        { rpId: 101, playerId: 201, team: 1 },
        { rpId: 102, playerId: 202, team: 1 },
        { rpId: 103, playerId: 203, team: 2 }, // short team
      ]));
      const res = handleRpc("finalize_round_relaxed", { p_round_id: 1 }, db);
      expect(res.body).toBe("finalized");
      expect(drawCount(db)).toBe(1);
      const draw = db.tables.blind_draws[0];
      expect(draw.short_team_number).toBe(2);
      // Drawn from team 1's full-18 pool (lowest id first → rp 101 → player 201).
      expect(draw.drawn_player_id).toBe(201);
      expect(draw.hole_range_start).toBe(1);
    });
  }

  for (const fmt of TEAM_CARD) {
    it(`${fmt}: fillsShortTeams=false → finalizes with ZERO fills`, () => {
      expect(fillsShortTeams(fmt)).toBe(false);
      const db = new MockDb(buildSeed(fmt, [
        { rpId: 101, playerId: 201, team: 1 },
        { rpId: 102, playerId: 202, team: 1 },
        { rpId: 103, playerId: 203, team: 2 }, // short team — but team-card never fills
      ], { teamCardScores: true }));
      const res = handleRpc("finalize_round_team_card", { p_round_id: 1 }, db);
      expect(res.body).toBe("finalized");
      expect(drawCount(db)).toBe(0);
    });
  }
});

describe("relaxed finalize — source eligibility (full-18 only)", () => {
  it("draws a player who completed all 18; a picked-up player is NOT eligible", () => {
    // Team 1: rp 101 full-18 (eligible), rp 102 picked up on 18 (17 scores →
    // excluded from the pool). Team 2 short → needs one fill. The only eligible
    // non-team-2 source is rp 101, so the picked-up rp 102 must NOT be drawn.
    // (Floor still passes: team 1 has a score on hole 18 via rp 101.)
    const db = new MockDb(buildSeed("par_competition", [
      { rpId: 101, playerId: 201, team: 1 },
      { rpId: 102, playerId: 202, team: 1, miss: [18] },
      { rpId: 103, playerId: 203, team: 2 },
    ]));
    const res = handleRpc("finalize_round_relaxed", { p_round_id: 1 }, db);
    expect(res.body).toBe("finalized");
    expect(drawCount(db)).toBe(1);
    expect(db.tables.blind_draws[0].drawn_player_id).toBe(201); // full-18
    expect(db.tables.blind_draws[0].drawn_player_id).not.toBe(202); // picked up
  });
});

describe("relaxed finalize — pool too small finalizes anyway with zero draws", () => {
  it("a short team with no eligible fill source still finalizes, writing no fill", () => {
    // Team 1's two players both picked up (staggered misses so the team floor
    // still passes on every hole), so neither is full-18. Team 2's only player
    // is on team 2, so the per-team subpool for team 2's slot is empty. Relaxed
    // never blocks close → "finalized" with ZERO fills (strict would have
    // returned pool_too_small; relaxed proceeds — the locked decision).
    const db = new MockDb(buildSeed("shambles", [
      { rpId: 101, playerId: 201, team: 1, miss: [18] },
      { rpId: 102, playerId: 202, team: 1, miss: [1] },
      { rpId: 103, playerId: 203, team: 2 },
    ]));
    const res = handleRpc("finalize_round_relaxed", { p_round_id: 1 }, db);
    expect(res.body).toBe("finalized");
    expect(drawCount(db)).toBe(0);
  });
});
