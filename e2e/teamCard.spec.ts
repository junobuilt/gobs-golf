// E2E — Wave 1B C2 team-card entry surface (/round/[id]/team-card?team=N).
// Verifies dash-until-tap par-anchoring, count-1 entry + running totals,
// count-2 two boxes + summed hole total, and the gross-only caption (no
// handicap-allowance text). The surface writes to `team_scores`, never `scores`.

import { test, expect, seed, seedTeamCardRound } from "./support/fixtures";

test("count-1: dash until first tap, then lands on par + updates totals", async ({ page, db }) => {
  seed(db, seedTeamCardRound({ roundId: 300, ballCount: 1 }));
  await page.goto("/round/300/team-card?team=1");

  // Reached the team-card surface (negative control: not the "not a team-card"
  // / "no team" fallbacks).
  await expect(page.getByText("TEAM 1")).toBeVisible();
  await expect(page.getByText("1 ball per hole")).toBeVisible();
  await expect(page.getByText("Gross only — no handicap")).toBeVisible();

  // Dash until first tap.
  await expect(page.getByTestId("ball-1-value")).toHaveText("—");

  // First tap lands on par (hole 1 par = 4 in the fixture).
  await page.getByTestId("ball-1-plus").click();
  await expect(page.getByTestId("ball-1-value")).toHaveText("4");

  // Running totals update: thru 1, gross 4, even (E) vs par.
  await expect(page.getByTestId("summary-thru")).toHaveText("1");
  await expect(page.getByTestId("summary-gross")).toHaveText("4");
  await expect(page.getByTestId("summary-delta")).toHaveText("E");
});

test("count-1: writes a team_scores row (not scores)", async ({ page, db }) => {
  seed(db, seedTeamCardRound({ roundId: 301, ballCount: 1 }));
  await page.goto("/round/301/team-card?team=1");

  await page.getByTestId("ball-1-plus").click(); // → par 4

  await expect.poll(() => db.tables.team_scores?.length ?? 0).toBe(1);
  const row = db.tables.team_scores[0];
  expect(row).toMatchObject({ round_id: 301, team_number: 1, hole_number: 1, ball_index: 1, strokes: 4 });
  // The individual scores table must stay empty for a team-card round.
  expect(db.tables.scores?.length ?? 0).toBe(0);
});

test("count-2: two boxes and the hole total is the sum of the balls", async ({ page, db }) => {
  seed(db, seedTeamCardRound({ roundId: 302, ballCount: 2 }));
  await page.goto("/round/302/team-card?team=1");

  await expect(page.getByText("2 balls per hole")).toBeVisible();
  // Two independent ball steppers.
  await expect(page.getByTestId("ball-1-value")).toHaveText("—");
  await expect(page.getByTestId("ball-2-value")).toHaveText("—");
  await expect(page.getByTestId("hole-total")).toContainText("—");

  // Ball 1 → 4 (par). Ball 2 → 4 then 5.
  await page.getByTestId("ball-1-plus").click();
  await page.getByTestId("ball-2-plus").click();
  await page.getByTestId("ball-2-plus").click();

  await expect(page.getByTestId("ball-1-value")).toHaveText("4");
  await expect(page.getByTestId("ball-2-value")).toHaveText("5");
  // Hole team score = 4 + 5 = 9.
  await expect(page.getByTestId("hole-total")).toContainText("9");
});

test("the handicap-allowance caption is replaced by a gross-only note", async ({ page, db }) => {
  seed(db, seedTeamCardRound({ roundId: 303, ballCount: 1 }));
  await page.goto("/round/303/team-card?team=1");

  await expect(page.getByText("Gross only — no handicap")).toBeVisible();
  // The individual card's "Handicaps at N%" allowance caption must NOT appear.
  await expect(page.getByText(/Handicaps at/)).toHaveCount(0);
});
