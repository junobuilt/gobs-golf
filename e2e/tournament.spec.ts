import { test, expect } from "./support/fixtures";
import { seed, ALL_PLAYERS, SEASON } from "./support/fixtures";

// Phase 2.1a — admin Tournament tab against the intercepted-network mock:
// create a tournament → the three standard days auto-appear → assign two
// players to opposite sides → add a fourth day on a distinct date.

test("create tournament → auto-creates the three standard days → assign sides → add a day", async ({ page, db }) => {
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

  // Active view: header + the three standard days on consecutive dates.
  await expect(page.getByText(/GOBS Ryder Cup/)).toBeVisible();
  await expect(page.getByText("Day 1 — Greensomes")).toBeVisible();
  await expect(page.getByText("Day 2 — Four-ball")).toBeVisible();
  await expect(page.getByText("Day 3 — Singles")).toBeVisible();

  // Rows are sorted by name: Adam Apple is first, Betty Birch second.
  await page.getByRole("button", { name: "USA" }).first().click(); // Adam → USA
  await page.getByRole("button", { name: "Canada" }).nth(1).click(); // Betty → Canada
  await expect(page.getByText(/USA 1 · Canada 1/)).toBeVisible();

  // Add a fourth day on a distinct date (name/format/date only — no Day # field).
  await page.getByRole("button", { name: "+ Add Day" }).click();
  await expect(page.getByRole("heading", { name: "Add Day" })).toBeVisible();
  await page.locator('input[type="date"]').fill("2026-07-28");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // The fourth day card appears (day_number derived → "Day 4").
  await expect(page.getByText("Day 4")).toBeVisible();
});
