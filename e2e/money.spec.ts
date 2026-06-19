// E2E — the unified admin Money tab (F.2). Two concerns:
//   1. The renamed tab renders its season strip + 3-sub-view switcher
//      (Funds | By Player | By Round), and By Player reaches its empty state
//      with no payouts seeded.
//   2. Admin-only guard: an UNAUTHENTICATED request to /admin (no admin_session
//      cookie) is redirected to /admin/login by the middleware — proving no
//      money surface is reachable without the admin gate.

import { test, expect, seed } from "./support/fixtures";

test("Money tab renders the season strip + Funds/By Player/By Round switcher", async ({ page, db }) => {
  seed(db, {
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    players: [],
    seasons: [],
  });

  await page.goto("/admin");
  await page.getByRole("button", { name: "Money" }).click();

  // 3-sub-view switcher (role=tab distinguishes these from the top admin tabs).
  await expect(page.getByRole("tab", { name: "Funds" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "By Player" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "By Round" })).toBeVisible();

  // Season strip — 4 totals.
  await expect(page.getByText("Buy-in collected")).toBeVisible();
  await expect(page.getByText("Paid out to players")).toBeVisible();

  // By Player sub-view reaches its empty state (no finalized payouts seeded).
  await page.getByRole("tab", { name: "By Player" }).click();
  await expect(page.getByText(/No finalized rounds with payouts yet/)).toBeVisible();
});

test.describe("admin-only guard", () => {
  // Drop the authenticated storageState for this block only.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated request to the Money tab redirects to /admin/login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
