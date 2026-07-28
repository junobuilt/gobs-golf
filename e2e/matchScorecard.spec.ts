import { test, expect } from "./support/fixtures";
import { seed, PLAYERS, SEASON, todayLocal } from "./support/fixtures";

// Phase 3.1 — the public match-play scorecard against the intercepted-network
// mock. A singles match (Adam v Betty, CH 0 so net = gross) with holes 1–9
// already A-won in the DB; the scorer enters hole 10 through the UI, which
// closes the match out → the green finish banner appears. Everything on screen
// comes from loadMatch / the pure engine — the surface does no arithmetic.

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

test("public match scorecard: enter scores through a closeout → finish banner", async ({ page, db }) => {
  const today = todayLocal();
  const ROUND = 200;
  const RP_A = 2001; // Adam, side A (team 1)
  const RP_B = 2002; // Betty, side B (team 2)

  // Holes 1–9 already scored: Adam 3 (net 3), Betty 4 (net 4) → Adam wins each.
  const seededScores = [];
  for (let h = 1; h <= 9; h++) {
    seededScores.push({ id: 9000 + h, round_id: ROUND, round_player_id: RP_A, hole_number: h, strokes: 3 });
    seededScores.push({ id: 9100 + h, round_id: ROUND, round_player_id: RP_B, hole_number: h, strokes: 4 });
  }

  seed(db, {
    players: [PLAYERS.adam, PLAYERS.betty],
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    tees: [{ id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 }],
    holes: flatPar4HolesForTee(7000, 1),
    rounds: [{ id: ROUND, played_on: today, is_complete: false, season_id: SEASON.id, tournament_id: 1 }],
    tournaments: [
      { id: 1, name: "GOBS Ryder Cup", side_a_name: "USA", side_b_name: "Canada", is_active: true, started_on: today },
    ],
    tournament_sessions: [
      { id: 9, tournament_id: 1, round_id: ROUND, day_number: 3, name: "Day 3", format: "singles_match", played_on: today, is_locked: false },
    ],
    tournament_matches: [
      {
        id: 500,
        tournament_id: 1,
        session_id: 9,
        match_number: 1,
        group_number: 1,
        side_a_team_number: 1,
        side_b_team_number: 2,
        status: "pending",
        result: null,
        result_source: "engine",
        closed_out_hole: null,
        scorer_label: null,
        admin_note: null,
      },
    ],
    round_players: [
      { id: RP_A, round_id: ROUND, player_id: PLAYERS.adam.id, team_number: 1, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 },
      { id: RP_B, round_id: ROUND, player_id: PLAYERS.betty.id, team_number: 2, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 },
    ],
    scores: seededScores,
  });

  await page.goto("/tournament/match/500");

  // Header renders from the engine: Adam 9 up after the 9 seeded holes.
  const header = page.getByTestId("match-header-500");
  await expect(header).toContainText("USA 9");
  await expect(header).toContainText("Canada 0");

  // F1: per-hole context (from the real loader → holes.yardage) on hole 1.
  const ctx = page.getByTestId("hole-context-500");
  await expect(ctx).toContainText("Hole 1");
  await expect(ctx).toContainText("Par 4");
  await expect(ctx).toContainText("350 yds");

  // Go to hole 10 and enter Adam 3 (net win) / Betty 4 → closeout.
  await page.getByTestId("hole-dot-10").click();
  const adam = page.getByTestId("player-1");
  await adam.getByRole("button", { name: "Ball 1 minus" }).click(); // par-anchor → 4
  await adam.getByRole("button", { name: "Ball 1 minus" }).click(); // → 3
  await page.getByTestId("player-2").getByRole("button", { name: "Ball 1 plus" }).click(); // → 4

  // The match closes out → green finish banner, USA the winner.
  await expect(page.getByTestId("finish-banner")).toContainText("Match over — USA wins");
});
