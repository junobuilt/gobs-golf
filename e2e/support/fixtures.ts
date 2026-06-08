// Playwright test fixtures + synthetic data for the GOBS Golf E2E suite.
//
// Every test gets a fresh in-memory MockDb wired to the page's BrowserContext
// (see installSupabaseMock). Tests seed it via `seed(db, {...})` BEFORE the
// first navigation. On teardown the fixture fails the test if any request
// leaked to production (assertNoProdHits) — the prod-safety backstop.

import { test as base, expect } from "@playwright/test";
import { MockDb, SeedData, installSupabaseMock, assertNoProdHits } from "./supabaseMock";

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
