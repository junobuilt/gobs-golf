import { test, expect } from "./support/fixtures";
import { seed, PLAYERS, SEASON, todayLocal } from "./support/fixtures";
import type { SeedData } from "./support/supabaseMock";

// Flights Track, Session 4 — flight-aware finalize lifecycle. The SESSION-4
// guard is GONE: a multi-flight round's Submit button is enabled (no "can't be
// finalized yet" notice), the last submit fires finalize_round_flights, the
// round completes, and the summary renders sectioned. Two internally-EVEN
// flights → zero blind draws (the per-flight-shortness guarantee).

const ROUND = 600;
const TEE = { id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 };

function holes(): any[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: 9000 + i, tee_id: 1, hole_number: i + 1, par: 4, yardage: 350, stroke_index: i + 1,
  }));
}

// Teams 1,2 → Flight A; team 3 → Flight B. Every team is 2 players (even within
// each flight). All par. Teams 1 & 2 already submitted; team 3 submits last.
const RP = [
  { id: 1001, player_id: PLAYERS.adam.id, team_number: 1 },
  { id: 1002, player_id: PLAYERS.betty.id, team_number: 1 },
  { id: 1003, player_id: PLAYERS.carl.id, team_number: 2 },
  { id: 1004, player_id: PLAYERS.dora.id, team_number: 2 },
  { id: 1005, player_id: PLAYERS.wayneH.id, team_number: 3 },
  { id: 1006, player_id: PLAYERS.wayneV.id, team_number: 3 },
];

function multiFlightSeed(): SeedData {
  const today = todayLocal();
  const scores: any[] = [];
  let sid = 40000;
  for (const rp of RP) {
    for (let h = 1; h <= 18; h++) scores.push({ id: sid++, round_player_id: rp.id, hole_number: h, strokes: 4 });
  }
  return {
    players: Object.values(PLAYERS),
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    tees: [TEE],
    holes: holes(),
    rounds: [{
      id: ROUND, played_on: today, is_complete: false, season_id: SEASON.id,
      // submitted_teams is ROUND-level; teams 1 & 2 are already in → submitting
      // team 3 makes the round all-submitted and triggers finalize.
      format_config: { submitted_teams: [1, 2] },
    }],
    round_players: RP.map((r) => ({
      ...r, round_id: ROUND, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0,
    })),
    scores,
    flights: [
      { id: 60, round_id: ROUND, name: "Flight A", sort_order: 1, format: "2_ball",
        format_config: { basis: "net", scoring_basis: "net", best_n: 2 }, format_locked_at: `${today}T00:00:00Z` },
      { id: 61, round_id: ROUND, name: "Flight B", sort_order: 2, format: "2_ball",
        format_config: { basis: "net", scoring_basis: "net", best_n: 2 }, format_locked_at: `${today}T00:00:00Z` },
    ],
    flight_teams: [
      { id: 1, flight_id: 60, round_id: ROUND, team_number: 1 },
      { id: 2, flight_id: 60, round_id: ROUND, team_number: 2 },
      { id: 3, flight_id: 61, round_id: ROUND, team_number: 3 },
    ],
  } as SeedData;
}

test("multi-flight finalize: guard gone, finalize_round_flights fires, sectioned results, zero draws", async ({ page, db }) => {
  seed(db, multiFlightSeed());
  await page.goto(`/round/${ROUND}/scorecard?team=3`);

  // Guard removed: Submit is enabled and the Session-2 notice is gone.
  const submit = page.getByRole("button", { name: "Submit Final Scores" });
  await expect(submit).toBeEnabled();
  await expect(page.getByText(/can't be finalized yet/i)).toHaveCount(0);

  await submit.click();
  const confirm = page.getByRole("button", { name: "Submit", exact: true });
  await expect(confirm).toBeEnabled({ timeout: 4000 });
  await confirm.click();

  // The flight-aware RPC fired (NOT the per-format one) and the round completed.
  await expect.poll(() => db.tables.rounds.find((r) => r.id === ROUND)?.is_complete).toBe(true);
  expect(db.rpcCalls.some((c) => c.name === "finalize_round_flights")).toBe(true);
  expect(db.rpcCalls.some((c) => c.name === "finalize_round_with_blind_draws")).toBe(false);

  // Internally-even flights → zero blind draws.
  expect((db.tables.blind_draws ?? []).filter((b) => b.round_id === ROUND)).toHaveLength(0);

  // Summary renders sectioned (both flight headers) + Final.
  await page.goto(`/round/${ROUND}/summary`);
  await expect(page.getByText("Flight A")).toBeVisible();
  await expect(page.getByText("Flight B")).toBeVisible();
  await expect(page.getByText("Final", { exact: true }).first()).toBeVisible();
});
