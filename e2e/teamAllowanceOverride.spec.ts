// E2E — per-team handicap allowance OVERRIDE (admin Round Setup tab).
//
// An admin overrides the allowance for ONE team in a multi-team flight. The
// change to a STARTED team (flight locked) routes through the shared danger
// modal scoped to that team; only Confirm writes flight_teams.handicap_allowance.
// The other team is untouched. Net/pot correctness is proven by the unit tests
// (results-teamAllowance + persistRoundPayouts pot-invariance); this spec covers
// the admin write integration + the per-team DangerModal + others-unchanged.
//
// Admin auth comes from global-setup's saved storageState (Round Setup is gated).
// Supabase is the in-process mock; we assert the upsert landed via the db fixture.

import { test, expect, seed, todayLocal, ALL_PLAYERS, SEASON, PLAYERS } from "./support/fixtures";

// Round today, 2_ball, format LOCKED (a score exists) with TWO two-player teams
// → RoundSetup active view renders a per-team allowance control on each card.
function seedLockedTwoTeamRound() {
  const today = todayLocal();
  return {
    players: ALL_PLAYERS,
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes: [],
    rounds: [
      {
        id: 410,
        played_on: today,
        is_complete: false,
        was_finalized: false,
        season_id: SEASON.id,
        format: "2_ball",
        format_config: { basis: "net", best_n: 2, override_holes: [], submitted_teams: [] },
        format_locked_at: `${today}T00:00:00Z`,
      },
    ],
    round_players: [
      { id: 4101, round_id: 410, player_id: PLAYERS.adam.id, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10, dropped_after_hole: null },
      { id: 4102, round_id: 410, player_id: PLAYERS.betty.id, team_number: 1, tee_id: 1, course_handicap: 12, handicap_index_snapshot: 12, dropped_after_hole: null },
      { id: 4103, round_id: 410, player_id: PLAYERS.carl.id, team_number: 2, tee_id: 1, course_handicap: 8, handicap_index_snapshot: 8, dropped_after_hole: null },
      { id: 4104, round_id: 410, player_id: PLAYERS.dora.id, team_number: 2, tee_id: 1, course_handicap: 15, handicap_index_snapshot: 15, dropped_after_hole: null },
    ],
    scores: [{ id: 9410, round_player_id: 4101, hole_number: 1, strokes: 4 }],
  };
}

test("admin overrides ONE team's allowance via the per-team danger modal; the other team is untouched", async ({ page, db }) => {
  seed(db, seedLockedTwoTeamRound());
  await page.goto("/admin");

  const team1 = page.getByLabel("Handicap allowance for Team 1");
  const team2 = page.getByLabel("Handicap allowance for Team 2");
  await expect(team1).toBeVisible();
  // Both teams start inheriting the flight default (empty value).
  await expect(team1).toHaveValue("");
  await expect(team2).toHaveValue("");

  // Change Team 1 to 50% — a score exists → the team-scoped danger modal opens
  // and NOTHING is written yet (no flight_teams override row for team 1).
  await team1.selectOption("50");
  await expect(page.getByText("Change handicap allowance for Team 1?")).toBeVisible();
  expect((db.tables.flight_teams ?? []).find((r: any) => r.team_number === 1 && r.handicap_allowance != null)).toBeUndefined();

  // Cancel snaps back, no write.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Change handicap allowance for Team 1?")).toHaveCount(0);
  await expect(team1).toHaveValue("");

  // Re-open and confirm (the shared danger confirm is disabled ~1.5s).
  await team1.selectOption("50");
  const confirm = page.getByRole("button", { name: "Change allowance" });
  await expect(confirm).toBeEnabled({ timeout: 4000 });
  await confirm.click();

  // The override landed on Team 1's flight_teams row, the control reflects it,
  // and the override marker shows.
  await expect(team1).toHaveValue("50");
  await expect(page.getByText("override · 50%")).toBeVisible();
  const t1row = (db.tables.flight_teams ?? []).find((r: any) => r.team_number === 1);
  expect(t1row?.handicap_allowance).toBe(50);

  // Team 2 is UNTOUCHED: still inheriting, no override row value.
  await expect(team2).toHaveValue("");
  const t2row = (db.tables.flight_teams ?? []).find((r: any) => r.team_number === 2);
  expect(t2row?.handicap_allowance ?? null).toBeNull();
});
