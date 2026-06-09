// E2E (display-layer) — guard for the c0723a5 Shambles reclassification.
//
// Shambles was rebuilt from a gross TEAM-CARD format into an individual best-ball
// NET format: it was REMOVED from TEAM_CARD_FORMATS (src/lib/format/helpers.ts),
// so it now routes to the individual `/round/[id]/scorecard` and the `/team-card`
// surface rejects it. (The team-card spine stays dormant until a real team-card
// format — Texas Scramble, Alternate Shot — rides it later; these tests will move
// to that format when one exists.) This file replaces the original team-card
// entry-surface specs, which the rebuild orphaned.

import { test, expect, seed, seedShamblesRound } from "./support/fixtures";

test("homepage links a Shambles team to /scorecard, not /team-card", async ({ page, db }) => {
  seed(db, seedShamblesRound({ roundId: 600, ballCount: 1 }));
  await page.goto("/");

  await expect(page.locator('a[href="/round/600/scorecard?team=1"]')).toHaveCount(1);
  await expect(page.locator('a[href="/round/600/team-card?team=1"]')).toHaveCount(0);
});

test("the team-card surface rejects a Shambles round", async ({ page, db }) => {
  seed(db, seedShamblesRound({ roundId: 601, ballCount: 1 }));
  await page.goto("/round/601/team-card?team=1");

  // The surface guards on isTeamCardFormat — Shambles falls through to the
  // "this round uses an individual scorecard" fallback.
  await expect(page.getByText("Not a team-card round")).toBeVisible();
  await expect(page.getByText("This round uses an individual scorecard.")).toBeVisible();
});
