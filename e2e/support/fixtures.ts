// Playwright test fixtures + synthetic data for the GOBS Golf E2E suite.
//
// Every test gets a fresh in-memory MockDb wired to the page's BrowserContext
// (see installSupabaseMock). Tests seed it via `seed(db, {...})` BEFORE the
// first navigation. On teardown the fixture fails the test if any request
// leaked to production (assertNoProdHits) — the prod-safety backstop.

import { test as base, expect } from "@playwright/test";
import { MockDb, SeedData, Row, installSupabaseMock, assertNoProdHits } from "./supabaseMock";

// Match the app's todayLocal() (src/lib/date.ts): local calendar date.
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Synthetic roster (independently-known values; NOT sourced from prod) ─────
// Includes a same-first-name pair (Wayne Hill / Wayne Vale) so name
// disambiguation ("Wayne H" / "Wayne V") is exercised by the render layer.
export const PLAYERS = {
  adam: { id: 1, full_name: "Adam Apple", display_name: "Adam Apple", handicap_index: 10, is_active: true, preferred_tee_id: 1 },
  betty: { id: 2, full_name: "Betty Birch", display_name: "Betty Birch", handicap_index: 12, is_active: true, preferred_tee_id: 1 },
  carl: { id: 3, full_name: "Carl Cedar", display_name: "Carl Cedar", handicap_index: 8, is_active: true, preferred_tee_id: 1 },
  dora: { id: 4, full_name: "Dora Date", display_name: "Dora Date", handicap_index: 15, is_active: true, preferred_tee_id: 1 },
  wayneH: { id: 5, full_name: "Wayne Hill", display_name: "Wayne Hill", handicap_index: 9, is_active: true, preferred_tee_id: 1 },
  wayneV: { id: 6, full_name: "Wayne Vale", display_name: "Wayne Vale", handicap_index: 11, is_active: true, preferred_tee_id: 1 },
} as const;

export const ALL_PLAYERS = Object.values(PLAYERS);

export const SEASON = { id: 1, name: "2026 Season", is_active: true, status: "active" };

export const TODAY_ROUND_ID = 100;

/**
 * A round dated today with a pre-existing team layout:
 *   Team 1: Adam Apple, Betty Birch
 *   Team 2: Carl Cedar
 * Dora, Wayne Hill, Wayne Vale are NOT yet in the round (unassigned pool).
 * This shape drives the silent_join / confirm_join / mixed_teams scenarios.
 */
export function seedTodayRoundWithTeams(): SeedData {
  const today = todayLocal();
  return {
    players: ALL_PLAYERS,
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    rounds: [{ id: TODAY_ROUND_ID, played_on: today, is_complete: false, season_id: SEASON.id }],
    round_players: [
      { id: 1001, round_id: TODAY_ROUND_ID, player_id: PLAYERS.adam.id, team_number: 1, tee_id: 1, handicap_index_snapshot: 10 },
      { id: 1002, round_id: TODAY_ROUND_ID, player_id: PLAYERS.betty.id, team_number: 1, tee_id: 1, handicap_index_snapshot: 12 },
      { id: 1003, round_id: TODAY_ROUND_ID, player_id: PLAYERS.carl.id, team_number: 2, tee_id: 1, handicap_index_snapshot: 8 },
    ],
    scores: [],
  };
}

/**
 * A fully-set-up team scorecard round (format picked, tees assigned) so the
 * scorecard page reaches its main render. `withScore` controls whether Team 1
 * already has a score — which drives the "Manage Team hides after first score"
 * visibility rule (showManageTeam = !teamHasAnyScore && !isRoundComplete).
 */
export function seedScorecardRound(opts: { roundId: number; withScore: boolean }): SeedData {
  const today = todayLocal();
  const scores = opts.withScore
    ? [{ id: 9001, round_id: opts.roundId, round_player_id: 5001, hole_number: 1, strokes: 4 }]
    : [];
  return {
    players: ALL_PLAYERS,
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes: [],
    rounds: [
      {
        id: opts.roundId,
        played_on: today,
        is_complete: false,
        season_id: SEASON.id,
        format: "2_ball",
        format_config: { basis: "net", best_n: 2, override_holes: [], submitted_teams: [] },
        format_locked_at: `${today}T00:00:00Z`,
      },
    ],
    round_players: [
      { id: 5001, round_id: opts.roundId, player_id: PLAYERS.adam.id, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
      { id: 5002, round_id: opts.roundId, player_id: PLAYERS.betty.id, team_number: 1, tee_id: 1, course_handicap: 12, handicap_index_snapshot: 12 },
    ],
    scores,
  };
}

// 18 par-4 holes on tee 1 with stroke index 1..18 in hole order. Par-4-flat +
// SI == hole number makes stroke allocation and par sums trivially predictable
// for the display assertions (a CH-N player gets a stroke on holes SI<=N%18...).
function flatPar4Holes(idBase: number): Row[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: idBase + i,
    tee_id: 1,
    hole_number: i + 1,
    par: 4,
    yardage: 350,
    stroke_index: i + 1,
  }));
}

/**
 * Wave 1B follow-up — a Shambles round (individual best-ball NET, relaxed close)
 * for the INDIVIDUAL scorecard surface (`/round/[id]/scorecard?team=N`). A
 * 4-player Team 1 on tee 1, 18 flat par-4 holes. Carl carries course_handicap 18
 * → exactly one stroke on every hole, so his NET can beat an equal GROSS — the
 * fixture proves the team score is best-NET (not gross/average) on the test hole.
 * `scores` lets each scenario seed exactly the holes it asserts on; `isComplete`
 * + `ballCount` parameterize the finalize and count-1/count-2 cases.
 */
export function seedShamblesRound(opts: {
  roundId: number;
  ballCount: 1 | 2;
  scores?: Row[];
  isComplete?: boolean;
}): SeedData {
  const today = todayLocal();
  return {
    players: ALL_PLAYERS,
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    // slope 113 / rating == par 72 makes computeCourseHandicap(snapshot) ===
    // snapshot, so the scorecard's LT1 self-heal (recompute CH from snapshot on
    // load) is a no-op and the seeded course_handicap stays put.
    tees: [{ id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 }],
    holes: flatPar4Holes(7100),
    rounds: [
      {
        id: opts.roundId,
        played_on: today,
        is_complete: !!opts.isComplete,
        season_id: SEASON.id,
        format: "shambles",
        format_config: {
          basis: "net",
          scoring_basis: "net",
          team_ball_count: opts.ballCount,
          override_holes: [],
          submitted_teams: [],
        },
        format_locked_at: opts.scores && opts.scores.length ? `${today}T00:00:00Z` : null,
      },
    ],
    round_players: [
      { id: 8001, round_id: opts.roundId, player_id: PLAYERS.adam.id, team_number: 1, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 },
      { id: 8002, round_id: opts.roundId, player_id: PLAYERS.betty.id, team_number: 1, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 },
      { id: 8003, round_id: opts.roundId, player_id: PLAYERS.carl.id, team_number: 1, tee_id: 1, course_handicap: 18, handicap_index_snapshot: 18 },
      { id: 8004, round_id: opts.roundId, player_id: PLAYERS.dora.id, team_number: 1, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 },
    ],
    scores: opts.scores ?? [],
  };
}

/**
 * Wave 1A — a NET round (2-ball) with a SINGLE player at a known raw course
 * handicap and a populated 18-hole grid, so the scorecard renders stroke dots,
 * net, and the GHIN-adjusted grid. One player keeps the dot count + expand
 * control unambiguous. Adam carries course_handicap 20: at 80% allowance his
 * playing strokes are round(16) = 16 → on hole 1 (SI 1) he gets 1 stroke
 * (scaled) vs 2 (raw), and the GHIN cap uses the raw 20. Hole 1 gross 10 makes
 * the allowance-scaled net (9) and the 100% GHIN-adjusted score (8) distinct.
 */
export function seedNetRoundWithHoles(opts: { roundId: number; allowance: number }): SeedData {
  const today = todayLocal();
  return {
    players: ALL_PLAYERS,
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    // slope 113 / rating == par keeps computeCourseHandicap(snapshot) == snapshot
    // so the LT1 self-heal leaves Adam's seeded course_handicap (20) untouched.
    tees: [{ id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 }],
    holes: flatPar4Holes(7200),
    rounds: [
      {
        id: opts.roundId,
        played_on: today,
        is_complete: false,
        season_id: SEASON.id,
        format: "2_ball",
        format_config: {
          basis: "net",
          scoring_basis: "net",
          best_n: 2,
          override_holes: [],
          submitted_teams: [],
          handicap_allowance: opts.allowance,
        },
        format_locked_at: `${today}T00:00:00Z`,
      },
    ],
    round_players: [
      { id: 8101, round_id: opts.roundId, player_id: PLAYERS.adam.id, team_number: 1, tee_id: 1, course_handicap: 20, handicap_index_snapshot: 20 },
    ],
    scores: [{ id: 9300, round_player_id: 8101, hole_number: 1, strokes: 10 }],
  };
}

/** Empty world: active roster + active season, but NO round today. */
export function seedNoRoundToday(): SeedData {
  return {
    players: ALL_PLAYERS,
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    rounds: [],
    round_players: [],
    scores: [],
  };
}

/** Load a seed into an existing MockDb (replacing current contents). */
export function seed(db: MockDb, data: SeedData): void {
  const fresh = new MockDb(data);
  db.tables = fresh.tables;
  db.rpcCalls.length = 0;
}

// ── The fixture ─────────────────────────────────────────────────────────────
type Fixtures = {
  db: MockDb;
};

export const test = base.extend<Fixtures>({
  db: async ({ context }, use) => {
    const db = new MockDb();
    await installSupabaseMock(context, db);
    await use(db);
    // PROD SAFETY BACKSTOP: fail the test if anything reached the prod ref.
    assertNoProdHits(db);
  },
});

export { expect };
