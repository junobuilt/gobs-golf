// E2E #1 — the Money what-if calculator. Pure compute, no DB writes. Proves
// the whole harness end-to-end: admin auth (reused storageState) → admin shell
// (Supabase mocked) → Money tab → Funds sub-view → real CalculatorPanel render.
//
// Expected values are INDEPENDENTLY known (not snapshotted from prod):
//   24 players, 2-per-team, $10 buy-in → perPlayerPot = 10 - 1(HiO) - 2(BFB) = 7
//   balance = 24 * 7 = $168, 12 teams
//   per-player payouts: 25 / 23 / 20 / 16
//   total paid out = (25+23+20+16) * 2 players = $168, sweep to BFB = $0

import { test, expect, seed } from "./support/fixtures";

test("Winnings calculator renders 24/2 payouts: 25/23/20/16, $168 total, $0 sweep", async ({ page, db }) => {
  seed(db, {
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    players: [],
    seasons: [],
  });

  await page.goto("/admin");
  await page.getByRole("button", { name: "Money" }).click();
  // Calculator lives under the default "Funds" sub-view of the Money tab.

  // Drive the inputs explicitly (also exercises the interaction layer).
  await page.getByLabel("Number of players").fill("24");
  await page.getByLabel("Team size").selectOption("2");

  // Header reflects the derived team count + balance.
  await expect(page.getByText("Projected Payouts (12 teams, $168 balance)")).toBeVisible();

  // Per-player payouts, in place order.
  await expect(page.getByText("$25/player")).toBeVisible();
  await expect(page.getByText("$23/player")).toBeVisible();
  await expect(page.getByText("$20/player")).toBeVisible();
  await expect(page.getByText("$16/player")).toBeVisible();

  // Totals row + sweep.
  const totalRow = page.locator("div", { hasText: /^Total paid out/ }).last();
  await expect(totalRow).toContainText("$168");
  const sweepRow = page.locator("div", { hasText: /^Sweep to BFB/ }).last();
  await expect(sweepRow).toContainText("$0");
});
