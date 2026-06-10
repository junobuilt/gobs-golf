// E2E (display-layer) — Handicap Allowance on the individual scorecard.
// Behavior (2026-06-09 — reverses Wave 1A's 1A.C2 "CH label stays raw"): the
// per-round allowance scales STROKES + competition NET, AND the displayed
// Course Handicap NUMBER now shows that scaled playing value (tinted orange to
// match the "Course Handicap at N%" caption). The GHIN-adjusted score is still
// ALWAYS computed at 100% (it ignores the allowance). These specs assert the
// RENDERED values, not the engine.
//
// Fixture: one player (Adam) with raw course handicap 20, allowance 80% →
// playing strokes round(20 × 0.8) = round(16) = 16 (hand-derived golden). On
// hole 1 (par 4, SI 1): scaled strokes = 1 (raw would be 2); gross 10 → scaled
// net 9; GHIN cap at 100% = par 4 + 2 + 2 = 8 (a scaled cap would be 7). One
// player keeps the dot count + the expand control unambiguous.

import { test, expect, seed, seedNetRoundWithHoles } from "./support/fixtures";

// A handicap stroke dot: a 5px navy (#1e40af → rgb(30,64,175)) span.
const strokeDots = (page: import("@playwright/test").Page) =>
  page.locator('span[style*="width: 5px"][style*="rgb(30, 64, 175)"]');

test("scorecard scales strokes + net AND shows CH (raw) · PH (scaled) explicitly", async ({ page, db }) => {
  seed(db, seedNetRoundWithHoles({ roundId: 700, allowance: 80 }));
  await page.goto("/round/700/scorecard?team=1");

  // Negative control: reached the main scorecard render.
  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(page.getByText("Tee Selection")).toHaveCount(0);

  // 1. Reduced stroke dots — hole 1 shows the SCALED 1 stroke, not the raw 2.
  await expect(strokeDots(page)).toHaveCount(1);

  // 2. Golden displayed literal: BOTH numbers, CH 20 (raw) · PH 16 (scaled,
  // hand-derived round(20 × 0.8)). The literals are typed by hand — not read
  // from the app's handicap function — so a bug there can't make this pass.
  await expect(page.getByText("CH 20 · PH 16")).toBeVisible();
  // The prior collapsed single-number format must be gone.
  await expect(page.getByText("Course Handicap: 16")).toHaveCount(0);

  // 3. The round-level allowance caption renders (relabeled "Player Allowance").
  await expect(page.getByText("Player Allowance at 80%")).toBeVisible();

  // 4. Net reflects the SCALED strokes: 10 − 1 = 9 (raw would be 10 − 2 = 8).
  await expect(page.getByText("Net: 9")).toBeVisible();
});

test("GHIN-adjusted score is computed at 100% and does NOT scale with the allowance", async ({ page, db }) => {
  seed(db, seedNetRoundWithHoles({ roundId: 701, allowance: 80 }));
  await page.goto("/round/701/scorecard?team=1");

  await expect(page.getByText("Adam A")).toBeVisible();

  // Expand the player's hole-by-hole grid to reveal the GHIN-adjusted column.
  await page.getByRole("button", { name: "Expand hole-by-hole" }).click();
  await expect(page.getByText("Adj Tot")).toBeVisible();

  // The adjusted score uses the RAW (100%) handicap: NDB cap = 4 + 2 + 2 = 8, so
  // min(gross 10, 8) = 8 (orange). A scaled cap would be 7 — assert it is absent.
  const adjCells = page.locator('div[style*="rgb(194, 65, 12)"]');
  await expect(adjCells.filter({ hasText: "8" }).first()).toBeVisible();
  await expect(adjCells.filter({ hasText: "7" })).toHaveCount(0);

  // The two handicap bases coexist on one screen: competition net (scaled) is 9,
  // distinct from the 100% adjusted 8.
  await expect(page.getByText("Net: 9")).toBeVisible();
});
