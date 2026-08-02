import { test, expect } from "./support/fixtures";
import { seed, ALL_PLAYERS, SEASON } from "./support/fixtures";

// Phase 2.2b — the pairings builder against the intercepted-network mock:
// create a tournament → assign sides → open Day 1 (Alternate Shot) pairings →
// add a group (strokes render from the loader) → change its tee → remove it.

// 18 flat par-4 holes, SI = hole number, for both the default (4) and White (1)
// tees so course handicaps compute and the loader always finds holes.
function holes(teeId: number) {
  return Array.from({ length: 18 }, (_, i) => ({ id: teeId * 100 + i, tee_id: teeId, hole_number: i + 1, par: 4, stroke_index: i + 1 }));
}

test("pairings: create a group → strokes render → change tee → remove", async ({ page, db }) => {
  seed(db, {
    players: ALL_PLAYERS,
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    // slope 113 / rating == par ⇒ course handicap == handicap index (clean).
    tees: [
      { id: 4, color: "Combo", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 },
      { id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 2 },
    ],
    holes: [...holes(4), ...holes(1)],
  });

  await page.goto("/admin");
  await page.getByRole("button", { name: "Tournament" }).click();

  // Create the tournament — auto-creates Day 1 Alternate Shot / Day 2 Best Ball / Day 3 Singles.
  await page.getByRole("button", { name: "+ Create Tournament" }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Day 1 — Alternate Shot")).toBeVisible();

  // Sides (rows sorted by name): Adam, Betty, Carl, Dora, Wayne Hill, Wayne Vale.
  await page.getByRole("button", { name: "USA" }).nth(0).click(); // Adam → USA
  await page.getByRole("button", { name: "USA" }).nth(2).click(); // Carl → USA
  await page.getByRole("button", { name: "Canada" }).nth(3).click(); // Dora → Canada
  await page.getByRole("button", { name: "Canada" }).nth(5).click(); // Wayne Vale → Canada
  await expect(page.getByText(/USA 2 · Canada 2/)).toBeVisible();

  // Open Day 1 pairings.
  await page.getByRole("button", { name: "Pairings →" }).first().click();
  await expect(page.getByText(/0 groups · 0 players · 4 unassigned/)).toBeVisible();

  // Add a greensomes group.
  await page.getByRole("button", { name: "+ Add Group" }).click();
  const pick = async (aria: string, name: string) => {
    await page.getByLabel(aria).click();
    await page.getByRole("option", { name }).click();
  };
  await pick("USA slot 1", "Adam Apple");
  await pick("USA slot 2", "Carl Cedar");
  await pick("Canada slot 1", "Dora Date");
  await pick("Canada slot 2", "Wayne Vale");
  await page.getByRole("button", { name: "Save group" }).click();

  // Card renders with strokes from the loader: USA CH round((10+8)/2)=9,
  // Canada CH round((15+11)/2)=13 ⇒ Canada side gets 4 strokes.
  await expect(page.getByText("Team CH 9")).toBeVisible();
  await expect(page.getByText("Team CH 13")).toBeVisible();
  await expect(page.getByText(/1 group · 4 players · 0 unassigned/)).toBeVisible();
  await expect(page.getByText(/Combo tees/)).toBeVisible();

  // Edit → change the tee to White. (The day cards behind the overlay also have
  // "Edit"; the panel renders last in the DOM, so its button is the last one.)
  await page.getByRole("button", { name: "Edit" }).last().click();
  // The Edit form now has two selects (tee + shotgun start hole); target the tee.
  await page.getByTestId("edit-tee").selectOption({ label: "White" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/White tees/)).toBeVisible();

  // Remove the group (DangerModal has a 1.5s arm delay; the click auto-waits).
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Remove group" }).click();
  await expect(page.getByText(/No groups yet/)).toBeVisible();
});
