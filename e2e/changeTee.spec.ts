// E2E (display-layer) — I14 mid-round tee change on the individual scorecard.
// Behavior: each player row's ⋯ menu has "Change tee" on a LIVE round. It opens
// a dangerous-action modal (current tee + tee picker + recalc warning). On
// confirm the player's Course Handicap recomputes for THIS round; the displayed
// CH number, the stroke dots, and the net all refresh live; gross stays.
//
// Fixture (seedTwoTeeRound): Adam on Tee A "White" (slope 113 → CH 20) with a
// second tee "Blue" (slope 132 / rating 74 → CH 25) available. A gross 6 sits on
// hole 3 (SI 3): at CH 20 he gets 1 stroke there (net 5, 1 dot); at CH 25 he
// gets 2 (net 4, 2 dots). The expected CH values (20 → 25) are hand-derived
// literals — see tests/lib/scoring/handicap.test.ts (I14 golden).

import { test, expect, seed, seedTwoTeeRound } from "./support/fixtures";

// A handicap stroke dot on the current-hole entry surface: a 5px navy
// (#1e40af → rgb(30,64,175)) span. (Grid dots are 4px and won't match.)
const strokeDots = (page: import("@playwright/test").Page) =>
  page.locator('span[style*="width: 5px"][style*="rgb(30, 64, 175)"]');

test("changing a player's tee mid-round recomputes CH + net + dots, keeps gross", async ({ page, db }) => {
  seed(db, seedTwoTeeRound({ roundId: 720 }));
  await page.goto("/round/720/scorecard?team=1");

  // Negative control: reached the MAIN scorecard render (not tee-setup).
  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(page.getByText("Tee Selection")).toHaveCount(0);

  // Jump to hole 3 (where the gross 6 lives) so the Net + entry dots show.
  await page.getByRole("button", { name: "3", exact: true }).click();

  // BEFORE — Tee A: CH 20, gross 6 → net 5, and 1 stroke dot on SI-3. At 100%
  // allowance PH = CH, so the meta row reads "CH 20 · PH 20".
  await expect(page.getByText("CH 20 · PH 20")).toBeVisible();
  await expect(page.getByText("Net: 5")).toBeVisible();
  await expect(strokeDots(page)).toHaveCount(1);

  // Open the ⋯ menu → Change tee → pick Blue (Tee B) → confirm.
  await page.getByRole("button", { name: "Open actions for Adam A" }).click();
  await page.getByRole("menuitem", { name: "Change tee" }).click();
  await page.getByRole("button", { name: "Blue" }).click();
  // The DangerModal confirm enables after its 1.5s delay (label flips to
  // "Change tee"); clicking it before then is impossible by name.
  await page.getByRole("button", { name: "Change tee" }).click();

  // AFTER — Tee B: CH recomputes to the hand-derived 25 (not the raw 20); at
  // 100% PH tracks it, so the meta row reads "CH 25 · PH 25".
  await expect(page.getByText("CH 25 · PH 25")).toBeVisible();
  await expect(page.getByText("CH 20 · PH 20")).toHaveCount(0);

  // Gross is preserved (still 6 on hole 3) but net recomputes: SI-3 now gets
  // 2 strokes → 6 − 2 = 4 (was 5), and the entry dots go 1 → 2.
  await expect(page.getByText("Net: 4")).toBeVisible();
  await expect(page.getByText("Net: 5")).toHaveCount(0);
  await expect(strokeDots(page)).toHaveCount(2);
});

test("Change tee is absent once the round is finalized", async ({ page, db }) => {
  const data = seedTwoTeeRound({ roundId: 721 });
  data.rounds![0].is_complete = true;
  seed(db, data);
  await page.goto("/round/721/scorecard?team=1");

  await expect(page.getByText("Adam A")).toBeVisible();
  // The ⋯ menu hides all live-only actions on a finalized round, so its
  // trigger button isn't rendered at all → no Change tee.
  await expect(page.getByRole("button", { name: "Open actions for Adam A" })).toHaveCount(0);
  await expect(page.getByText("Change tee")).toHaveCount(0);
});
