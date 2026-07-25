import { test, expect } from "./support/fixtures";
import { seed, ALL_PLAYERS, SEASON } from "./support/fixtures";

// Phase 2.1 — admin Tournament tab against the intercepted-network mock:
// create a tournament → assign two players to opposite sides → add a day →
// the day card appears.

test("create tournament → assign sides → add a day", async ({ page, db }) => {
  seed(db, {
    players: ALL_PLAYERS,
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
  });

  await page.goto("/admin");
  await page.getByRole("button", { name: "Tournament" }).click();

  // Empty state → create with the defaults (2026 GOBS Ryder Cup, USA/Canada).
  await page.getByRole("button", { name: "+ Create Tournament" }).click();
  await expect(page.getByRole("heading", { name: "Create Tournament" })).toBeVisible();
  await page.getByRole("button", { name: "Create", exact: true }).click();

  // Active view: header + Sides section.
  await expect(page.getByText(/GOBS Ryder Cup/)).toBeVisible();
  await expect(page.getByText(/USA 0 · Canada 0/)).toBeVisible();

  // Rows are sorted by name: Adam Apple is first, Betty Birch second.
  await page.getByRole("button", { name: "USA" }).first().click(); // Adam → USA
  await page.getByRole("button", { name: "Canada" }).nth(1).click(); // Betty → Canada
  await expect(page.getByText(/USA 1 · Canada 1/)).toBeVisible();

  // Add a day with the defaults (Day 1, Four-ball, today).
  await page.getByRole("button", { name: "+ Add Day" }).click();
  await expect(page.getByRole("heading", { name: "Add Day" })).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // The day card appears.
  await expect(page.getByText("Day 1")).toBeVisible();
  await expect(page.getByText(/Four-ball/)).toBeVisible();
});
