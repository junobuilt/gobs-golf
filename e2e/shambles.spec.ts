// E2E (display-layer) — Shambles: individual best-ball NET with a relaxed close
// (rebuilt in c0723a5). These specs assert RENDERED DOM, not engine output —
// the engine math lives in tests/lib/scoring/engine-shambles.test.ts; here we
// prove the scorecard SHOWS the right values. Shambles routes to the individual
// `/round/[id]/scorecard` (NOT `/team-card`), scores per-player, and finalizes
// via finalize_round_relaxed.
//
// The team headline renders a running "Team Net" total (delta vs par), not a
// per-hole team cell — so each per-hole scenario seeds exactly one hole and
// reads the headline, which then equals that hole's best-net delta. The headline
// VALUE is the div immediately after the "Team Net" label.

import { test, expect, seed, seedShamblesRound, PLAYERS, SEASON, todayLocal } from "./support/fixtures";
import type { SeedData } from "./support/supabaseMock";

// The rendered team-total value (formatTeamTotal): "E" / "+N" / "−N".
const teamNetValue = (page: import("@playwright/test").Page) =>
  page.getByText("Team Net", { exact: true }).locator("xpath=following-sibling::div[1]");

// Spec 2 (migration 029) — a SHORT-team Shambles round so finalize draws.
// Team 1 (Adam + Betty, full) vs Team 2 (Carl, short by 1 → one round-start
// fill). Team 1 pre-submitted; the UI drives Team 2's submit → finalize_round_
// relaxed. Adam (lowest rp id → first-eligible) is drawn; his birdies on holes
// 17 & 18 (gross 3 → net 3, par elsewhere) make his fill value Net −2.
function shortTeamShamblesSeed(roundId: number): SeedData {
  const today = todayLocal();
  const RP = [
    { id: 8051, player_id: PLAYERS.adam.id, team_number: 1 },
    { id: 8052, player_id: PLAYERS.betty.id, team_number: 1 },
    { id: 8053, player_id: PLAYERS.carl.id, team_number: 2 }, // short team
  ];
  const scores: any[] = [];
  let sid = 71500;
  for (const rp of RP) {
    for (let h = 1; h <= 18; h++) {
      const birdie = rp.id === 8051 && (h === 17 || h === 18);
      scores.push({ id: sid++, round_player_id: rp.id, hole_number: h, strokes: birdie ? 3 : 4 });
    }
  }
  return {
    players: Object.values(PLAYERS),
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    tees: [{ id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 }],
    holes: Array.from({ length: 18 }, (_, i) => ({ id: 7150 + i, tee_id: 1, hole_number: i + 1, par: 4, yardage: 350, stroke_index: i + 1 })),
    rounds: [{
      id: roundId, played_on: today, is_complete: false, season_id: SEASON.id,
      format: "shambles",
      format_config: { basis: "net", scoring_basis: "net", team_ball_count: 1, override_holes: [], submitted_teams: [1] },
      format_locked_at: `${today}T00:00:00Z`,
    }],
    round_players: RP.map((r) => ({ ...r, round_id: roundId, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 })),
    scores,
  } as SeedData;
}

test("FormatPicker: Shambles selectable, net locked, ball-count shown; allowance enabled", async ({ page, db }) => {
  // A Shambles round today (format set, not yet locked) so RoundSetup lands in
  // its active view with the flight card's format + Handicap Allowance controls.
  seed(db, seedShamblesRound({ roundId: 500, ballCount: 1 }));
  await page.goto("/admin");

  // Session 2 (Flights): allowance now lives inside the flight card (per-flight)
  // and is ENABLED for Shambles (net, not a gross-only team-card format).
  const allowance = page.getByLabel(/Handicap allowance percent/);
  await expect(allowance).toBeVisible();
  await expect(allowance).toBeEnabled();

  // Open the format picker from the flight card's format chip.
  await page.getByRole("button", { name: /Change format for/ }).click();
  const dialog = page.getByRole("dialog", { name: "Choose today's format" });
  await expect(dialog).toBeVisible();

  // Shambles is selectable.
  await dialog.getByRole("button", { name: /Shambles/ }).click();

  // Net is locked: the gross option in the Scoring basis group is disabled.
  await expect(
    dialog.getByRole("group", { name: "Scoring basis" }).getByRole("button", { name: "gross" }),
  ).toBeDisabled();

  // The 1/2-ball control is visible.
  const ballGroup = dialog.getByRole("group", { name: "Balls per hole" });
  await expect(ballGroup).toBeVisible();
  await expect(ballGroup.getByRole("button", { name: "1 ball" })).toBeVisible();
  await expect(ballGroup.getByRole("button", { name: "2 balls" })).toBeVisible();
});

test("opening a team routes to /scorecard, not /team-card", async ({ page, db }) => {
  seed(db, seedShamblesRound({ roundId: 510, ballCount: 1 }));
  await page.goto("/");

  await expect(page.locator('a[href="/round/510/scorecard?team=1"]')).toHaveCount(1);
  await expect(page.locator('a[href="/round/510/team-card?team=1"]')).toHaveCount(0);
});

test("count-1: team hole score is the best NET of present players (absent excluded)", async ({ page, db }) => {
  // Hole 1 (par 4): Adam 5, Betty 5, Carl 5, Dora picks up. Carl carries 1
  // stroke → net 4 beats the gross-5 field. Best NET of the three present = 4.
  seed(db, seedShamblesRound({
    roundId: 520,
    ballCount: 1,
    scores: [
      { round_player_id: 8001, hole_number: 1, strokes: 5 },
      { round_player_id: 8002, hole_number: 1, strokes: 5 },
      { round_player_id: 8003, hole_number: 1, strokes: 5 },
      // Dora (8004): no score — picked up.
    ],
  }));
  await page.goto("/round/520/scorecard?team=1");

  // Negative control: reached the main scorecard render, not Tee Selection.
  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(page.getByText("Tee Selection")).toHaveCount(0);

  // Team Net == best net (4) − par (4) = E. Gross would read "+1"; an average or
  // an absent-included value would differ.
  await expect(teamNetValue(page)).toHaveText("E");

  // Corroborate at the per-player layer: Carl's stroke yields the winning NET 4.
  await expect(page.getByText("Net: 4")).toBeVisible();
});

test("count-2: team hole score is the sum of the two best NETs (all four present)", async ({ page, db }) => {
  // Hole 1: nets Adam 5, Betty 5, Carl 4, Dora 6. Two best = 4 + 5 = 9; par×2 = 8.
  seed(db, seedShamblesRound({
    roundId: 530,
    ballCount: 2,
    scores: [
      { round_player_id: 8001, hole_number: 1, strokes: 5 },
      { round_player_id: 8002, hole_number: 1, strokes: 5 },
      { round_player_id: 8003, hole_number: 1, strokes: 5 },
      { round_player_id: 8004, hole_number: 1, strokes: 6 },
    ],
  }));
  await page.goto("/round/530/scorecard?team=1");

  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(teamNetValue(page)).toHaveText("+1");
});

test("count-2: degrades to best-available when only one player is present", async ({ page, db }) => {
  // Hole 1: only Adam present (net = gross 6, CH 0). Count-2 degrades to that one
  // ball: 6 − par 4 = +2 (it must NOT wait for a second ball or read null).
  seed(db, seedShamblesRound({
    roundId: 531,
    ballCount: 2,
    scores: [{ round_player_id: 8001, hole_number: 1, strokes: 6 }],
  }));
  await page.goto("/round/531/scorecard?team=1");

  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(teamNetValue(page)).toHaveText("+2");
});

test("a hole with no team score blocks finalize and names the hole", async ({ page, db }) => {
  // Adam scores holes 1..17; hole 18 has no score from anyone → finalize blocked.
  seed(db, seedShamblesRound({
    roundId: 540,
    ballCount: 1,
    scores: Array.from({ length: 17 }, (_, i) => ({
      round_player_id: 8001,
      hole_number: i + 1,
      strokes: 4,
    })),
  }));
  await page.goto("/round/540/scorecard?team=1");

  await expect(page.getByText("Adam A")).toBeVisible();
  await expect(page.getByText("Team 1 has no score on hole 18.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit Final Scores" })).toBeDisabled();
});

test("finalize (>=1 score per hole) → summary renders Final and the correct team TOTAL", async ({ page, db }) => {
  // Adam carries the whole team: par on every hole except bogeys on 1 and 10
  // (one in each nine) → team total +2, distinct from each leg's +1.
  seed(db, seedShamblesRound({
    roundId: 550,
    ballCount: 1,
    scores: Array.from({ length: 18 }, (_, i) => ({
      round_player_id: 8001,
      hole_number: i + 1,
      strokes: i + 1 === 1 || i + 1 === 10 ? 5 : 4,
    })),
  }));
  await page.goto("/round/550/scorecard?team=1");

  const submit = page.getByRole("button", { name: "Submit Final Scores" });
  await expect(submit).toBeEnabled();
  await submit.click();

  // Shared dangerous-action modal — confirm enables after the 1.5s delay.
  const confirm = page.getByRole("button", { name: "Submit", exact: true });
  await expect(confirm).toBeEnabled({ timeout: 4000 });
  await confirm.click();

  // finalize_round_relaxed sets is_complete (served by the mock).
  await expect.poll(() => db.tables.rounds.find((r) => r.id === 550)?.is_complete).toBe(true);

  // The results surface renders the finalized state + correct team total.
  await page.goto("/round/550/summary");
  await expect(page.getByRole("button", { name: "Expand Team 1" })).toBeVisible();
  await expect(page.getByText("Final", { exact: true })).toBeVisible();
  await expect(page.getByText("+2", { exact: true })).toBeVisible();
});

test("short team → finalize via finalize_round_relaxed → blind-draw fill (🎲) on summary", async ({ page, db }) => {
  seed(db, shortTeamShamblesSeed(560));
  await page.goto("/round/560/scorecard?team=2");

  // Team 2 (Carl) submits → round all-submitted → finalize fires.
  const submit = page.getByRole("button", { name: "Submit Final Scores" });
  await expect(submit).toBeEnabled();
  await submit.click();
  const confirm = page.getByRole("button", { name: "Submit", exact: true });
  await expect(confirm).toBeEnabled({ timeout: 4000 });
  await confirm.click();

  await expect.poll(() => db.tables.rounds.find((r) => r.id === 560)?.is_complete).toBe(true);

  // Single-flight relaxed now DRAWS (Spec 2 / migration 029): the relaxed RPC
  // fired, not the strict or flight one.
  expect(db.rpcCalls.some((c) => c.name === "finalize_round_relaxed")).toBe(true);
  expect(db.rpcCalls.some((c) => c.name === "finalize_round_with_blind_draws")).toBe(false);
  expect(db.rpcCalls.some((c) => c.name === "finalize_round_flights")).toBe(false);

  // One fill for the short team (2), drawn from Team 1's full-18 pool (Adam).
  const draws = (db.tables.blind_draws ?? []).filter((b) => b.round_id === 560);
  expect(draws).toHaveLength(1);
  expect(draws[0].short_team_number).toBe(2);
  expect(draws[0].drawn_player_id).toBe(PLAYERS.adam.id);

  // Summary renders the 🎲 fill line valued as Adam's net (−2).
  await page.goto("/round/560/summary");
  await expect(page.getByText("Final", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("🎲", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Net −2").first()).toBeVisible();
});
