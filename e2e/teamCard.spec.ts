// E2E (display-layer) — the team-card spine.
//
// Shambles was rebuilt into an individual best-ball NET format (routes to
// `/round/[id]/scorecard`; the `/team-card` surface rejects it) — the first two
// tests guard that. Phase 1C made the spine LIVE for the two NET team-card
// formats (Texas Scramble, Alternate Shot): one team ball per hole, net via a
// team-handicap deduction, finalize via finalize_round_team_card. The remaining
// tests cover routing, the NET headline + Gross·HCP·Net caption, the
// submit→finalize path, and the Alternate Shot exactly-2 guard.

import {
  test,
  expect,
  seed,
  seedShamblesRound,
  seedScrambleRound,
  seedAltShotBadTeam,
} from "./support/fixtures";

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

// ── Phase 1C: NET team-card formats (Texas Scramble, Alternate Shot) ──────────

test("homepage links a Texas Scramble team to /team-card", async ({ page, db }) => {
  seed(db, seedScrambleRound({ roundId: 610 }));
  await page.goto("/");

  await expect(page.locator('a[href="/round/610/team-card?team=1"]')).toHaveCount(1);
  await expect(page.locator('a[href="/round/610/scorecard?team=1"]')).toHaveCount(0);
});

test("Scramble team-card shows the NET headline + Gross·HCP·Net caption", async ({ page, db }) => {
  // All 18 team balls = 4 → gross 72, team HCP 7 (6.5 rounds up), net 65,
  // net delta vs par −7.
  seed(db, seedScrambleRound({ roundId: 611, fullScores: true }));
  await page.goto("/round/611/team-card?team=1");

  // NET delta headline (U+2212 minus).
  await expect(page.getByTestId("summary-delta")).toHaveText("−7");
  await expect(page.getByTestId("summary-gross")).toHaveText("72");
  const caption = page.getByTestId("summary-net-caption");
  await expect(caption).toContainText("Gross 72");
  await expect(caption).toContainText("HCP 7");
  await expect(caption).toContainText("Net 65");
});

test("Scramble: a fully-scored team submits → finalize → round complete", async ({ page, db }) => {
  seed(db, seedScrambleRound({ roundId: 612, fullScores: true }));
  await page.goto("/round/612/team-card?team=1");

  const submit = page.getByRole("button", { name: "Submit Final Scores" });
  await expect(submit).toBeEnabled();
  await submit.click();

  // DangerModal confirm has a 1.5s delay before it becomes tappable. Exact
  // match so this targets the modal's "Submit" and not "Submit Final Scores".
  const confirm = page.getByRole("button", { name: "Submit", exact: true });
  await expect(confirm).toBeEnabled({ timeout: 3000 });
  await confirm.click();

  await expect(page.getByText("Round complete")).toBeVisible();
  await expect
    .poll(() => db.rpcCalls.some((c) => c.name === "finalize_round_team_card"))
    .toBe(true);
});

test("Alternate Shot blocks Submit on a non-2-player team", async ({ page, db }) => {
  seed(db, seedAltShotBadTeam({ roundId: 613 }));
  await page.goto("/round/613/team-card?team=1");

  await expect(page.getByTestId("altshot-team-size-warning")).toBeVisible();
  await expect(page.getByTestId("altshot-team-size-warning")).toContainText("exactly 2 players");
  await expect(page.getByRole("button", { name: "Submit Final Scores" })).toBeDisabled();
});
