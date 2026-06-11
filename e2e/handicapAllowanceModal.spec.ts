// E2E — Wave 1A mid-round handicap-allowance change routes through the shared
// dangerous-action modal (admin Round Setup tab).
//
// Rule (RoundSetup.tsx): changing the Handicap Allowance selector when a score
// already exists (roundFormatLockedAt !== null) opens the DangerModal warning
// that net recalculates; only Confirm writes format_config.handicap_allowance.
// A pre-score change (covered by unit tests) writes immediately with no modal.
//
// Admin auth comes from global-setup's saved storageState (the Round Setup tab
// is PIN-gated). Supabase is the in-process mock; we assert the PATCH actually
// landed via the db fixture.

import { test, expect, seed, todayLocal, ALL_PLAYERS, SEASON, PLAYERS } from "./support/fixtures";

// A round dated today, format picked AND locked (format_locked_at set = a score
// exists), with a two-player Team 1 → RoundSetup lands in "active" view and the
// Handicap Allowance selector renders. No handicap_allowance key yet → reads 100.
function seedLockedRoundToday() {
  const today = todayLocal();
  return {
    players: ALL_PLAYERS,
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes: [],
    rounds: [
      {
        id: 400,
        played_on: today,
        is_complete: false,
        was_finalized: false,
        season_id: SEASON.id,
        format: "2_ball",
        format_config: { basis: "net", best_n: 2, override_holes: [], submitted_teams: [] },
        format_locked_at: `${today}T00:00:00Z`,
      },
    ],
    round_players: [
      { id: 4001, round_id: 400, player_id: PLAYERS.adam.id, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10, dropped_after_hole: null },
      { id: 4002, round_id: 400, player_id: PLAYERS.betty.id, team_number: 1, tee_id: 1, course_handicap: 12, handicap_index_snapshot: 12, dropped_after_hole: null },
    ],
    scores: [{ id: 9100, round_player_id: 4001, hole_number: 1, strokes: 4 }],
  };
}

test("mid-round allowance change is gated by the danger modal; Cancel reverts, Confirm writes", async ({ page, db }) => {
  seed(db, seedLockedRoundToday());
  await page.goto("/admin");

  const select = page.getByLabel("Handicap allowance percent");
  await expect(select).toBeVisible();
  await expect(select).toHaveValue("100"); // default / no key yet

  // Change to 80% — a score exists, so this must open the danger modal, NOT
  // write immediately.
  await select.selectOption("80");
  await expect(page.getByText("Change handicap allowance mid-round?")).toBeVisible();

  // NEGATIVE CONTROL: the write must not have happened yet (modal still open).
  // Session 2: allowance lives on the FLIGHT's config, not rounds.format_config.
  expect((db.tables.flights[0].format_config as any).handicap_allowance).toBeUndefined();

  // Cancel → modal closes, controlled select snaps back to 100, no write.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Change handicap allowance mid-round?")).toHaveCount(0);
  await expect(select).toHaveValue("100");
  expect((db.tables.flights[0].format_config as any).handicap_allowance).toBeUndefined();

  // Re-open and confirm. The DangerModal confirm button is disabled for 1.5s
  // (shared dangerous-action pattern), so it only matches by name once enabled.
  await select.selectOption("80");
  await expect(page.getByText("Change handicap allowance mid-round?")).toBeVisible();
  const confirm = page.getByRole("button", { name: "Change allowance" });
  await expect(confirm).toBeEnabled({ timeout: 4000 });
  await confirm.click();

  // The write lands on the flight: format_config.handicap_allowance = 80 and
  // the selector reflects it.
  await expect(select).toHaveValue("80");
  expect((db.tables.flights[0].format_config as any).handicap_allowance).toBe(80);
});

test("the allowance selector offers 5% steps (95 / 85 selectable; non-5 absent; 100 default)", async ({ page, db }) => {
  seed(db, seedLockedRoundToday());
  await page.goto("/admin");

  const select = page.getByLabel("Handicap allowance percent");
  await expect(select).toBeVisible();
  await expect(select).toHaveValue("100"); // default still 100

  // 5% options render across the SAME 100→10 range...
  await expect(select.locator('option[value="95"]')).toHaveCount(1);
  await expect(select.locator('option[value="85"]')).toHaveCount(1);
  await expect(select.locator('option[value="15"]')).toHaveCount(1);
  // ...and a non-5 value does NOT (proves the step is 5, not 1) — nor a 0% floor.
  await expect(select.locator('option[value="93"]')).toHaveCount(0);
  await expect(select.locator('option[value="0"]')).toHaveCount(0);

  // A 5%-step value selects + persists (through the same mid-round danger modal).
  await select.selectOption("85");
  await expect(page.getByText("Change handicap allowance mid-round?")).toBeVisible();
  const confirm = page.getByRole("button", { name: "Change allowance" });
  await expect(confirm).toBeEnabled({ timeout: 4000 });
  await confirm.click();
  await expect(select).toHaveValue("85");
  expect((db.tables.flights[0].format_config as any).handicap_allowance).toBe(85);
});
