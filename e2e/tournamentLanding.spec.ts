import { test, expect } from "./support/fixtures";
import { seed, PLAYERS, SEASON, todayLocal } from "./support/fixtures";

// Phase 3.2 Relay A — the public /tournament landing against the intercepted
// mock. A LIVE (published) future-dated tournament lists all its days + pairings,
// each match linking to its scorecard; a Test (unpublished) tournament shows the
// empty state (the publish gate).

function flatPar4HolesForTee(idBase: number, teeId: number) {
  return Array.from({ length: 18 }, (_, i) => ({
    id: idBase + i,
    tee_id: teeId,
    hole_number: i + 1,
    par: 4,
    yardage: 350,
    stroke_index: i + 1,
  }));
}

// Three singles days (rounds 200/201/202), Adam vs Betty each day, one match each.
function seedTournament(published: boolean) {
  const today = todayLocal();
  const rp = (id: number, round: number, player: number, team: number) => ({
    id, round_id: round, player_id: player, team_number: team, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0,
  });
  const match = (id: number, session: number, num: number) => ({
    id, tournament_id: 1, session_id: session, match_number: num, group_number: num,
    side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null,
    result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null,
  });
  return {
    players: [PLAYERS.adam, PLAYERS.betty],
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    tees: [{ id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 }],
    holes: flatPar4HolesForTee(7000, 1),
    rounds: [
      { id: 200, played_on: "2026-08-01", is_complete: false, season_id: SEASON.id, tournament_id: 1 },
      { id: 201, played_on: "2026-08-02", is_complete: false, season_id: SEASON.id, tournament_id: 1 },
      { id: 202, played_on: "2026-08-03", is_complete: false, season_id: SEASON.id, tournament_id: 1 },
    ],
    tournaments: [
      { id: 1, name: "2026 GOBS Ryder Cup", is_active: true, is_published: published, started_on: "2026-08-01", side_a_name: "USA", side_b_name: "Canada", holder_side: "b", season_id: null, ended_on: null, notes: null },
    ],
    tournament_sessions: [
      { id: 9, tournament_id: 1, round_id: 200, day_number: 1, name: "Day 1", format: "singles_match", played_on: "2026-08-01", is_locked: false },
      { id: 10, tournament_id: 1, round_id: 201, day_number: 2, name: "Day 2", format: "singles_match", played_on: "2026-08-02", is_locked: false },
      { id: 11, tournament_id: 1, round_id: 202, day_number: 3, name: "Day 3", format: "singles_match", played_on: "2026-08-03", is_locked: false },
    ],
    tournament_matches: [match(500, 9, 1), match(501, 10, 1), match(502, 11, 1)],
    round_players: [
      rp(2001, 200, PLAYERS.adam.id, 1), rp(2002, 200, PLAYERS.betty.id, 2),
      rp(2003, 201, PLAYERS.adam.id, 1), rp(2004, 201, PLAYERS.betty.id, 2),
      rp(2005, 202, PLAYERS.adam.id, 1), rp(2006, 202, PLAYERS.betty.id, 2),
    ],
    scores: [],
  };
}

test("published tournament: /tournament lists all 3 days + pairings, each match links to its scorecard", async ({ page, db }) => {
  seed(db, seedTournament(true));

  await page.goto("/tournament");
  await expect(page.getByText("2026 GOBS Ryder Cup")).toBeVisible();
  await expect(page.getByTestId("day-9")).toBeVisible();
  await expect(page.getByTestId("day-10")).toBeVisible();
  await expect(page.getByTestId("day-11")).toBeVisible();

  const row = page.getByTestId("tmatch-card-500");
  await expect(row).toBeVisible();

  // The match card links to its scorecard.
  await row.click();
  await expect(page).toHaveURL(/\/tournament\/match\/500$/);
  await expect(page.getByTestId("match-card-500")).toBeVisible();
});

test("Test (unpublished) tournament: /tournament shows the empty state", async ({ page, db }) => {
  seed(db, seedTournament(false));
  await page.goto("/tournament");
  await expect(page.getByTestId("tournament-empty")).toBeVisible();
  await expect(page.getByText("2026 GOBS Ryder Cup")).toHaveCount(0);
});
