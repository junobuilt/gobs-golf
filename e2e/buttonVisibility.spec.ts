// E2E scenario 5b — Manage Team button visibility on the scorecard.
// Rule (scorecard/page.tsx, 2026-06-09): showManageTeam = !isRoundComplete.
// The A2.5 hide-on-first-score gate was removed — the button now STAYS through
// the whole live round (mid-round pickups / late-noticed wrong tee) and only
// hides once the round is finalized.

import { test, expect, seed, seedScorecardRound } from "./support/fixtures";

test("Manage Team button is visible before any score is entered", async ({ page, db }) => {
  seed(db, seedScorecardRound({ roundId: 200, withScore: false }));
  await page.goto("/round/200/scorecard?team=1");

  await expect(page.getByRole("button", { name: "Manage Team" })).toBeVisible();
});

test("Manage Team button STAYS visible after the team has a score (A2.5 gate removed)", async ({ page, db }) => {
  seed(db, seedScorecardRound({ roundId: 201, withScore: true }));
  await page.goto("/round/201/scorecard?team=1");

  // Negative control (CLAUDE.md principle #3): prove we reached the MAIN
  // scorecard render — not the loading / format-lock / tee-setup screens —
  // so the visible button is meaningful and not a trivially-passing fixture.
  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(page.getByText("Tee Selection")).toHaveCount(0);

  // The button remains available even though Team 1 already has a score.
  await expect(page.getByRole("button", { name: "Manage Team" })).toBeVisible();
});
