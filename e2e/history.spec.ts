// E2E (display-layer) — F.1 History tab. The render + navigation class that the
// unit/component tests can't see: real routing from the global-nav History list
// into /round/[id]/summary, rendering the tapped round's own teams.
//
// NOTE: the e2e Supabase mock does not re-sort on `.order(...)`, so rows render
// in seeded order. We seed newest-first (matching what loadRoundsList asks the
// real DB for via ascending:false) and assert that order in the DOM.

import { test, expect, seed, PLAYERS, SEASON } from "./support/fixtures";
import type { SeedData, Row } from "./support/supabaseMock";

const TEE = { id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 };

function holes(idBase: number): Row[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: idBase + i, tee_id: 1, hole_number: i + 1, par: 4, yardage: 350, stroke_index: i + 1,
  }));
}

// 18 gross scores of a constant value for one round_player.
function scores(idBase: number, rpId: number, gross: number): Row[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: idBase + i, round_player_id: rpId, hole_number: i + 1, strokes: gross,
  }));
}

function rp(id: number, roundId: number, playerId: number, team: number, ch: number): Row {
  return { id, round_id: roundId, player_id: playerId, team_number: team, tee_id: 1, course_handicap: ch, handicap_index_snapshot: ch };
}

// Two FINALIZED 2-Ball rounds, seeded newest-first. Round 700 (Jun 8) vs round
// 701 (Jun 4). Team 1 scores better than Team 2 in each.
function historySeed(): SeedData {
  return {
    players: Object.values(PLAYERS),
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    tees: [TEE],
    holes: holes(7000),
    rounds: [
      { id: 700, played_on: "2026-06-08", is_complete: true, season_id: SEASON.id, format: "2_ball", format_config: { basis: "net", scoring_basis: "net", best_n: 2, override_holes: [] }, format_locked_at: "2026-06-08T00:00:00Z" },
      { id: 701, played_on: "2026-06-04", is_complete: true, season_id: SEASON.id, format: "2_ball", format_config: { basis: "net", scoring_basis: "net", best_n: 2, override_holes: [] }, format_locked_at: "2026-06-04T00:00:00Z" },
    ],
    round_players: [
      // Round 700: T1 (Adam+Betty) gross 4, T2 (Carl+Dora) gross 5.
      rp(7001, 700, PLAYERS.adam.id, 1, 10), rp(7002, 700, PLAYERS.betty.id, 1, 12),
      rp(7003, 700, PLAYERS.carl.id, 2, 8), rp(7004, 700, PLAYERS.dora.id, 2, 15),
      // Round 701: T1 (Adam+Carl) gross 4, T2 (Betty+Dora) gross 5.
      rp(7011, 701, PLAYERS.adam.id, 1, 10), rp(7012, 701, PLAYERS.carl.id, 1, 8),
      rp(7013, 701, PLAYERS.betty.id, 2, 12), rp(7014, 701, PLAYERS.dora.id, 2, 15),
    ],
    scores: [
      ...scores(70010, 7001, 4), ...scores(70020, 7002, 4),
      ...scores(70030, 7003, 5), ...scores(70040, 7004, 5),
      ...scores(70110, 7011, 4), ...scores(70120, 7012, 4),
      ...scores(70130, 7013, 5), ...scores(70140, 7014, 5),
    ],
  };
}

test("History lists finalized rounds newest-first and taps through to the right summary", async ({ page, db }) => {
  seed(db, historySeed());
  await page.goto("/history");

  // Both finalized rounds render as mini-leaderboard rows.
  const jun8 = page.getByText("Jun 8");
  const jun4 = page.getByText("Jun 4");
  await expect(jun8).toBeVisible();
  await expect(jun4).toBeVisible();

  // Newest-first: the Jun 8 row precedes the Jun 4 row in the DOM.
  const jun8Box = await jun8.boundingBox();
  const jun4Box = await jun4.boundingBox();
  expect(jun8Box!.y).toBeLessThan(jun4Box!.y);

  // Each row shows ranked team lines (rank 1 + a team total string).
  await expect(page.locator('a[href="/round/700/summary"]')).toBeVisible();
  await expect(page.locator('a[href="/round/701/summary"]')).toBeVisible();

  // Tap the newest round → lands on ITS summary, rendering that round's teams.
  await page.locator('a[href="/round/700/summary"]').click();
  await expect(page).toHaveURL(/\/round\/700\/summary/);
  await expect(page.getByText("Team 1").first()).toBeVisible();
  await expect(page.getByText("Team 2").first()).toBeVisible();
});

test("History list crowns the SAME winner as the summary (right team, net scores applied)", async ({ page, db }) => {
  // Round 700: Team 1 (Adam + Betty) beats Team 2 (Carl + Dora) on net. The
  // truncation regression showed the wrong winner + flat E scores; this guards
  // that the list ranks the right team with real (sub-par) net totals, matching
  // the summary.
  seed(db, historySeed());
  await page.goto("/history");

  const row = page.locator('a[href="/round/700/summary"]');
  const rowText = await row.innerText();
  // Team 1's player is listed ABOVE Team 2's (rank 1 before rank 2).
  expect(rowText.indexOf("Adam")).toBeGreaterThanOrEqual(0);
  expect(rowText.indexOf("Adam")).toBeLessThan(rowText.indexOf("Carl"));
  // A sub-par minus total proves net scores were applied — not the all-E a
  // scoreless/truncated loader produced (U+2212 minus).
  expect(rowText).toContain("−");

  // The summary agrees on the winner: Team 1 (Adam) leads Team 2 (Carl).
  await row.click();
  await expect(page).toHaveURL(/\/round\/700\/summary/);
  const summaryText = await page.locator("body").innerText();
  expect(summaryText.indexOf("Adam")).toBeLessThan(summaryText.indexOf("Carl"));
});

test("History bottom-nav tab is reachable from the home page", async ({ page, db }) => {
  seed(db, historySeed());
  await page.goto("/");
  await page.getByRole("link", { name: "History" }).click();
  await expect(page).toHaveURL(/\/history/);
  await expect(page.locator('a[href="/round/700/summary"]')).toBeVisible();
});
