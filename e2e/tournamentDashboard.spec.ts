import { test, expect } from "./support/fixtures";
import { seed, PLAYERS, SEASON, todayLocal } from "./support/fixtures";

// Phase 4 — the public /tournament/dashboard against the intercepted mock. A
// LIVE tournament shows the country score header (banked, decided-only) + the
// all-matches list with real MatchState status; a Test one shows the empty
// state (same publish gate as the landing).

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

function grossAll(rpId: number, g: number, startId: number) {
  return Array.from({ length: 18 }, (_, i) => ({
    id: startId + i,
    round_player_id: rpId,
    hole_number: i + 1,
    strokes: g,
  }));
}

// Day 1 decided (Adam beats Betty — USA wins), Days 2 & 3 pending (no scores).
function seedTournament(published: boolean) {
  const rp = (id: number, round: number, player: number, team: number) => ({
    id, round_id: round, player_id: player, team_number: team, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0,
  });
  const match = (id: number, session: number, num: number) => ({
    id, tournament_id: 1, session_id: session, match_number: num, group_number: num,
    side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null,
    result_source: "engine", closed_out_hole: null, scorer_label: null, flagged_holes: [], admin_note: null,
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
    // Day 1 only: Adam gross 3 vs Betty gross 5 → USA wins (closes early).
    scores: [...grossAll(2001, 3, 3000), ...grossAll(2002, 5, 4000)],
  };
}

test("published: /tournament/dashboard shows the country score + decided status", async ({ page, db }) => {
  seed(db, seedTournament(true));

  await page.goto("/tournament/dashboard");
  await expect(page.getByText("2026 GOBS Ryder Cup")).toBeVisible();

  // Country score header — USA 1, Canada 0 (one decided match, no halves).
  const score = page.getByTestId("country-score");
  await expect(score).toBeVisible();
  await expect(score).toContainText("USA");
  await expect(score).toContainText("Canada");
  await expect(score).toContainText("1");

  // The decided match reads "USA wins" from MatchState.
  await expect(page.getByTestId("dash-status-500")).toContainText("USA wins");

  // Cross-link back to the landing.
  await expect(page.getByTestId("to-landing")).toBeVisible();

  // C7 — expanding a pairing reveals a link to the READ-ONLY review, not the
  // editable scorecard.
  await page.getByTestId("dash-match-500").getByRole("button").click();
  const review = page.getByTestId("dash-review-500");
  await expect(review).toBeVisible();
  await expect(review).toHaveAttribute("href", "/tournament/match/500/review");
  await review.click();
  await expect(page).toHaveURL(/\/tournament\/match\/500\/review$/);
  await expect(page.getByTestId("review-grid-500")).toBeVisible();
});

test("Test (unpublished): /tournament/dashboard shows the empty state", async ({ page, db }) => {
  seed(db, seedTournament(false));
  await page.goto("/tournament/dashboard");
  await expect(page.getByTestId("dashboard-empty")).toBeVisible();
  await expect(page.getByTestId("country-score")).toHaveCount(0);
});

test("landing links to the dashboard", async ({ page, db }) => {
  seed(db, seedTournament(true));
  await page.goto("/tournament");
  const link = page.getByTestId("to-dashboard");
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/tournament\/dashboard$/);
  await expect(page.getByTestId("country-score")).toBeVisible();
});
