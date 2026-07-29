import { test, expect } from "./support/fixtures";
import { seed, seedNoRoundToday, todayLocal } from "./support/fixtures";

// Phase 3.2 Relay A — the homepage tournament hero. Shown only for a live
// (published) tournament that hasn't ended; absent otherwise (league homepage
// byte-identical). Seeds no league round today so the homepage is the empty
// league state + (conditionally) the hero.

function tournamentRow(published: boolean) {
  return {
    id: 1,
    name: "2026 GOBS Ryder Cup",
    is_active: true,
    is_published: published,
    started_on: todayLocal(),
    side_a_name: "USA",
    side_b_name: "Canada",
    holder_side: "b",
    season_id: null,
    ended_on: null,
    notes: null,
  };
}

test("published tournament: homepage shows the cup hero linking to /tournament", async ({ page, db }) => {
  seed(db, { ...seedNoRoundToday(), tournaments: [tournamentRow(true)] });
  await page.goto("/");
  const hero = page.getByTestId("tournament-hero");
  await expect(hero).toBeVisible();
  await expect(hero).toContainText("2026 GOBS Ryder Cup");
  await expect(page.getByTestId("pointsbar-track")).toBeVisible();
  await expect(page.getByTestId("hero-to-tournament")).toHaveAttribute("href", "/tournament");
});

test("Test (unpublished) tournament: homepage shows NO hero (negative control)", async ({ page, db }) => {
  seed(db, { ...seedNoRoundToday(), tournaments: [tournamentRow(false)] });
  await page.goto("/");
  // Wait for the homepage to settle, then assert the hero never appears.
  await expect(page.getByText("Good Ole Boys")).toBeVisible();
  await expect(page.getByTestId("tournament-hero")).toHaveCount(0);
});
