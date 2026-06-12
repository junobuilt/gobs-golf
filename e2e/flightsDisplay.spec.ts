import { test, expect } from "./support/fixtures";
import { seed, PLAYERS, SEASON, todayLocal, TODAY_ROUND_ID } from "./support/fixtures";
import type { SeedData } from "./support/supabaseMock";

// Flights Track, Session 3 — display chrome. A round with 2+ non-empty flights
// renders SECTIONED on the leaderboard and the homepage today's-teams; a
// single-flight round renders with NO flight chrome (byte-≈identical to before).

const TEE = { id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 };
function flatHoles(): any[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: 9000 + i, tee_id: 1, hole_number: i + 1, par: 4, yardage: 350, stroke_index: i + 1,
  }));
}
// All-par scores for a set of round_player ids (gross 72 each) so the engine
// reaches a ranked, finalized render.
function allParScores(rpIds: number[]): any[] {
  const out: any[] = [];
  let id = 50000;
  for (const rpId of rpIds) {
    for (let h = 1; h <= 18; h++) out.push({ id: id++, round_player_id: rpId, hole_number: h, strokes: 4 });
  }
  return out;
}

const RP = [
  { id: 1001, player_id: PLAYERS.adam.id, team_number: 1 },
  { id: 1002, player_id: PLAYERS.betty.id, team_number: 1 },
  { id: 1003, player_id: PLAYERS.carl.id, team_number: 2 },
  { id: 1004, player_id: PLAYERS.dora.id, team_number: 2 },
  { id: 1005, player_id: PLAYERS.wayneH.id, team_number: 3 },
  { id: 1006, player_id: PLAYERS.wayneV.id, team_number: 4 },
];

function baseRound() {
  const today = todayLocal();
  return {
    players: PLAYERS ? Object.values(PLAYERS) : [],
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    tees: [TEE],
    holes: flatHoles(),
    rounds: [{ id: TODAY_ROUND_ID, played_on: today, is_complete: true, season_id: SEASON.id }],
    round_players: RP.map(r => ({
      ...r, round_id: TODAY_ROUND_ID, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0,
    })),
    scores: allParScores(RP.map(r => r.id)),
  };
}

// Single flight: every team in Flight A (one flight → no chrome).
function singleFlightSeed(): SeedData {
  const today = todayLocal();
  return {
    ...baseRound(),
    flights: [
      { id: 10, round_id: TODAY_ROUND_ID, name: "Flight A", sort_order: 1, format: "2_ball",
        format_config: { basis: "net", scoring_basis: "net", best_n: 2 }, format_locked_at: `${today}T00:00:00Z` },
    ],
    flight_teams: [],
  } as SeedData;
}

// Two non-empty flights: teams 1,2 → Flight A; teams 3,4 → Flight B.
function multiFlightSeed(): SeedData {
  const today = todayLocal();
  return {
    ...baseRound(),
    flights: [
      { id: 10, round_id: TODAY_ROUND_ID, name: "Flight A", sort_order: 1, format: "2_ball",
        format_config: { basis: "net", scoring_basis: "net", best_n: 2 }, format_locked_at: `${today}T00:00:00Z` },
      { id: 20, round_id: TODAY_ROUND_ID, name: "Flight B", sort_order: 2, format: "2_ball",
        format_config: { basis: "net", scoring_basis: "net", best_n: 2 }, format_locked_at: `${today}T00:00:00Z` },
    ],
    flight_teams: [
      { id: 1, flight_id: 10, round_id: TODAY_ROUND_ID, team_number: 1 },
      { id: 2, flight_id: 10, round_id: TODAY_ROUND_ID, team_number: 2 },
      { id: 3, flight_id: 20, round_id: TODAY_ROUND_ID, team_number: 3 },
      { id: 4, flight_id: 20, round_id: TODAY_ROUND_ID, team_number: 4 },
    ],
  } as SeedData;
}

test("multi-flight round renders a SECTIONED leaderboard (flight headers)", async ({ page, db }) => {
  seed(db, multiFlightSeed());
  await page.goto("/leaderboard");
  await expect(page.getByText("Flight A")).toBeVisible();
  await expect(page.getByText("Flight B")).toBeVisible();
});

test("multi-flight round renders SECTIONED homepage today's-teams", async ({ page, db }) => {
  seed(db, multiFlightSeed());
  await page.goto("/");
  // Flight labels appear above the team-card grids.
  await expect(page.getByText("Flight A", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Flight B", { exact: false }).first()).toBeVisible();
  // Teams from both flights are present.
  await expect(page.getByText("Team 1")).toBeVisible();
  await expect(page.getByText("Team 4")).toBeVisible();
});

test("single-flight round renders WITHOUT flight chrome", async ({ page, db }) => {
  seed(db, singleFlightSeed());
  await page.goto("/leaderboard");
  // The teams still render…
  await expect(page.getByText("Team 1").first()).toBeVisible();
  // …but there is no flight section header (no flight chrome on single-flight).
  await expect(page.getByText("Flight A")).toHaveCount(0);
  await expect(page.getByText("Flight B")).toHaveCount(0);
});
