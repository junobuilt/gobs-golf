// E2E scenario 5b — Manage Team button visibility on the scorecard.
// Rule (scorecard/page.tsx): showManageTeam = !teamHasAnyScore && !isRoundComplete.
// The button must be present pre-scoring and HIDE once the team has any score —
// a render-transition bug class that unit tests don't catch.

import { test, expect, seed, seedScorecardRound } from "./support/fixtures";

test("Manage Team button is visible before any score is entered", async ({ page, db }) => {
  seed(db, seedScorecardRound({ roundId: 200, withScore: false }));
  await page.goto("/round/200/scorecard?team=1");

  await expect(page.getByRole("button", { name: "Manage Team" })).toBeVisible();
});

test("Manage Team button hides once the team has a score", async ({ page, db }) => {
  seed(db, seedScorecardRound({ roundId: 201, withScore: true }));
  await page.goto("/round/201/scorecard?team=1");

  // Negative control (CLAUDE.md principle #3): prove we reached the MAIN
  // scorecard render — not the loading / format-lock / tee-setup screens —
  // so the absent button is meaningful and not a trivially-passing fixture.
  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(page.getByText("Tee Selection")).toHaveCount(0);

  // The Manage Team button must be hidden because Team 1 already has a score.
  await expect(page.getByText("Manage Team")).toHaveCount(0);
});
