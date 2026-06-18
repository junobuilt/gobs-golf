// E2E (display-layer) — Par Competition: match play vs the course. Individual
// best-NET selection per hole mapped to a RECORD point (net < par → +1, = par →
// 0, net > par → −1); the team headline is the running record (highest wins).
// Mirrors Shambles: routes to the individual `/round/[id]/scorecard` (NOT
// `/team-card`), net-locked, allowance enabled, relaxed close via
// finalize_round_relaxed. These specs assert RENDERED DOM; the engine math lives
// in tests/lib/scoring/engine-par-competition.test.ts.
//
// The team headline pill is labelled "Record" (not "Team Net") with a "vs
// course" caption beneath. The VALUE is the div immediately after the "Record"
// label; it renders via formatTeamTotal → "+N" / "E" / "−N".

import { test, expect, seed, seedParCompetitionRound, PLAYERS, SEASON, todayLocal } from "./support/fixtures";
import type { SeedData } from "./support/supabaseMock";

const recordValue = (page: import("@playwright/test").Page) =>
  page.getByText("Record", { exact: true }).locator("xpath=following-sibling::div[1]");

// Spec 2 (migration 029) — a SHORT-team Par Competition round so finalize draws.
// Team 1 (Adam + Betty, full) vs Team 2 (Carl, short by 1 → one round-start
// fill). Team 1 is pre-submitted via round-level submitted_teams; the UI drives
// Team 2's submit, which makes the round all-submitted and fires
// finalize_round_relaxed. Adam (lowest rp id → deterministic first-eligible) is
// drawn for Team 2; his birdies on holes 1 & 10 (gross 3 → +1 each, par
// elsewhere) make his fill record +2.
function shortTeamParCompSeed(roundId: number): SeedData {
  const today = todayLocal();
  const RP = [
    { id: 8651, player_id: PLAYERS.adam.id, team_number: 1 },
    { id: 8652, player_id: PLAYERS.betty.id, team_number: 1 },
    { id: 8653, player_id: PLAYERS.carl.id, team_number: 2 }, // short team
  ];
  const scores: any[] = [];
  let sid = 76500;
  for (const rp of RP) {
    for (let h = 1; h <= 18; h++) {
      const birdie = rp.id === 8651 && (h === 1 || h === 10);
      scores.push({ id: sid++, round_player_id: rp.id, hole_number: h, strokes: birdie ? 3 : 4 });
    }
  }
  return {
    players: Object.values(PLAYERS),
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    tees: [{ id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 }],
    holes: Array.from({ length: 18 }, (_, i) => ({ id: 7700 + i, tee_id: 1, hole_number: i + 1, par: 4, yardage: 350, stroke_index: i + 1 })),
    rounds: [{
      id: roundId, played_on: today, is_complete: false, season_id: SEASON.id,
      format: "par_competition",
      // Team 1 already submitted; submitting Team 2 in the UI finalizes.
      format_config: { basis: "net", scoring_basis: "net", override_holes: [], submitted_teams: [1] },
      format_locked_at: `${today}T00:00:00Z`,
    }],
    round_players: RP.map((r) => ({ ...r, round_id: roundId, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 })),
    scores,
  } as SeedData;
}

test("FormatPicker: Par Competition selectable, net locked, override no-op; allowance enabled", async ({ page, db }) => {
  seed(db, seedParCompetitionRound({ roundId: 600 }));
  await page.goto("/admin");

  // Allowance lives in the flight card and is ENABLED (net individual format).
  const allowance = page.getByLabel(/Handicap allowance percent/);
  await expect(allowance).toBeVisible();
  await expect(allowance).toBeEnabled();

  await page.getByRole("button", { name: /Change format for/ }).click();
  const dialog = page.getByRole("dialog", { name: "Choose today's format" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: /Par Competition/ }).click();

  // Net is locked: the gross option is disabled.
  await expect(
    dialog.getByRole("group", { name: "Scoring basis" }).getByRole("button", { name: "gross" }),
  ).toBeDisabled();

  // Override-holes are a no-op for Par Competition (caption shown).
  await expect(dialog.getByText("(no effect on Par Competition)")).toBeVisible();
});

test("opening a team routes to /scorecard, not /team-card", async ({ page, db }) => {
  seed(db, seedParCompetitionRound({ roundId: 610 }));
  await page.goto("/");

  await expect(page.locator('a[href="/round/610/scorecard?team=1"]')).toHaveCount(1);
  await expect(page.locator('a[href="/round/610/team-card?team=1"]')).toHaveCount(0);
});

test("best net BELOW par → record +1 (win the hole)", async ({ page, db }) => {
  // Hole 1 (par 4): Adam gross 3, CH 0 → net 3 < par → +1.
  seed(db, seedParCompetitionRound({
    roundId: 620,
    scores: [{ round_player_id: 8601, hole_number: 1, strokes: 3 }],
  }));
  await page.goto("/round/620/scorecard?team=1");

  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(page.getByText("Tee Selection")).toHaveCount(0);
  await expect(recordValue(page)).toHaveText("+1");
  await expect(page.getByText("vs course").first()).toBeVisible();
});

test("best net EQUAL to par → record E (halve)", async ({ page, db }) => {
  seed(db, seedParCompetitionRound({
    roundId: 621,
    scores: [{ round_player_id: 8601, hole_number: 1, strokes: 4 }],
  }));
  await page.goto("/round/621/scorecard?team=1");

  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(recordValue(page)).toHaveText("E");
});

test("record uses best NET, not lowest gross", async ({ page, db }) => {
  // Hole 1 (par 4, SI 1): Adam gross 4 (net 4 = par → 0 alone). Carl gross 4 but
  // CH 18 → 1 stroke on SI 1 → net 3 < par → +1. Best NET is Carl → +1. A naive
  // gross-min would tie at 4 and pick Adam → E. Asserting +1 proves NET.
  seed(db, seedParCompetitionRound({
    roundId: 622,
    scores: [
      { round_player_id: 8601, hole_number: 1, strokes: 4 }, // Adam net 4
      { round_player_id: 8603, hole_number: 1, strokes: 4 }, // Carl net 3
    ],
  }));
  await page.goto("/round/622/scorecard?team=1");

  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(recordValue(page)).toHaveText("+1");
});

test("a hole with no team score blocks finalize and names the hole", async ({ page, db }) => {
  // Adam scores holes 1..17; hole 18 has no score from anyone → finalize blocked.
  seed(db, seedParCompetitionRound({
    roundId: 640,
    scores: Array.from({ length: 17 }, (_, i) => ({
      round_player_id: 8601,
      hole_number: i + 1,
      strokes: 4,
    })),
  }));
  await page.goto("/round/640/scorecard?team=1");

  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(page.getByText("Team 1 has no score on hole 18.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit Final Scores" })).toBeDisabled();
});

test("finalize (>=1 score per hole) → summary renders Final and the correct RECORD", async ({ page, db }) => {
  // Adam carries the team: birdie (gross 3 → +1) on holes 1 and 10, par (gross 4
  // → 0) everywhere else → record +2, distinct from each leg's +1.
  seed(db, seedParCompetitionRound({
    roundId: 650,
    scores: Array.from({ length: 18 }, (_, i) => ({
      round_player_id: 8601,
      hole_number: i + 1,
      strokes: i + 1 === 1 || i + 1 === 10 ? 3 : 4,
    })),
  }));
  await page.goto("/round/650/scorecard?team=1");

  const submit = page.getByRole("button", { name: "Submit Final Scores" });
  await expect(submit).toBeEnabled();
  await submit.click();

  const confirm = page.getByRole("button", { name: "Submit", exact: true });
  await expect(confirm).toBeEnabled({ timeout: 4000 });
  await confirm.click();

  await expect.poll(() => db.tables.rounds.find((r) => r.id === 650)?.is_complete).toBe(true);

  await page.goto("/round/650/summary");
  await expect(page.getByRole("button", { name: "Expand Team 1" })).toBeVisible();
  await expect(page.getByText("Final", { exact: true })).toBeVisible();
  await expect(page.getByText("+2", { exact: true })).toBeVisible();
  await expect(page.getByText("vs course").first()).toBeVisible();
});

test("short team → finalize via finalize_round_relaxed → blind-draw fill (🎲) on summary", async ({ page, db }) => {
  seed(db, shortTeamParCompSeed(660));
  await page.goto("/round/660/scorecard?team=2");

  // Team 2 (Carl) submits → round becomes all-submitted → finalize fires.
  const submit = page.getByRole("button", { name: "Submit Final Scores" });
  await expect(submit).toBeEnabled();
  await submit.click();
  const confirm = page.getByRole("button", { name: "Submit", exact: true });
  await expect(confirm).toBeEnabled({ timeout: 4000 });
  await confirm.click();

  await expect.poll(() => db.tables.rounds.find((r) => r.id === 660)?.is_complete).toBe(true);

  // The RELAXED RPC fired (NOT the strict or flight one) — single-flight relaxed
  // now draws (Spec 2 / migration 029).
  expect(db.rpcCalls.some((c) => c.name === "finalize_round_relaxed")).toBe(true);
  expect(db.rpcCalls.some((c) => c.name === "finalize_round_with_blind_draws")).toBe(false);
  expect(db.rpcCalls.some((c) => c.name === "finalize_round_flights")).toBe(false);

  // Exactly one fill, for the short team (2), drawn from Team 1's full-18 pool.
  const draws = (db.tables.blind_draws ?? []).filter((b) => b.round_id === 660);
  expect(draws).toHaveLength(1);
  expect(draws[0].short_team_number).toBe(2);
  expect(draws[0].drawn_player_id).toBe(PLAYERS.adam.id); // lowest rp id, eligible

  // Summary renders the 🎲 fill line valued as Adam's record (+2 vs course).
  await page.goto("/round/660/summary");
  await expect(page.getByText("Final", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("🎲", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("+2 vs course").first()).toBeVisible();
});
