// E2E — handicap-allowance caption on the scorecard.
// Rule (scorecard/page.tsx header): the "Handicap Allowance at N%" caption renders
// directly under the FORMAT chip when format_config.handicap_allowance !== 100,
// and is hidden at 100% (the default). Render-layer behavior; the caption is the
// round-level signal that net is scaled. (Separately, each player row shows
// CH (raw) · PH (scaled) explicitly — see allowance.spec.ts.)

import { test, expect, seed, seedScorecardRound } from "./support/fixtures";

test("scorecard shows the 'Handicap Allowance at N%' caption when allowance is reduced", async ({ page, db }) => {
  const data = seedScorecardRound({ roundId: 300, withScore: false });
  // Reduce the allowance to 80% on the seeded round's format_config.
  (data.rounds![0].format_config as Record<string, unknown>).handicap_allowance = 80;
  seed(db, data);
  await page.goto("/round/300/scorecard?team=1");

  // Negative control (CLAUDE.md principle #3): prove we reached the MAIN
  // scorecard render so the visible caption is meaningful.
  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(page.getByText("Tee Selection")).toHaveCount(0);

  await expect(page.getByText("Handicap Allowance at 80%")).toBeVisible();
});

test("scorecard hides the caption at 100% (default full handicap)", async ({ page, db }) => {
  // seedScorecardRound omits handicap_allowance entirely → read as 100.
  seed(db, seedScorecardRound({ roundId: 301, withScore: false }));
  await page.goto("/round/301/scorecard?team=1");

  // Reached main render (negative control), then assert the caption is absent.
  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(page.getByText(/Handicap Allowance at \d+%/)).toHaveCount(0);
});
