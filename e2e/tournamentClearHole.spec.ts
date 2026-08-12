import { test, expect } from "./support/fixtures";
import { seed, PLAYERS, SEASON, todayLocal } from "./support/fixtures";
import { installSupabaseMock, type MockDb } from "./support/supabaseMock";

// Commit 4 — admin Clear hole. The button is admin-gated (absent from the DOM
// for non-admins), NOT gated on the scorer claim (clearing never disturbs the
// claim), goes through the write queue as an explicit clear (row DELETE, not a
// 0), and every surface reflects the cleared state from the canonical engine.

const RP_A = 2201; // Adam, side A (team 1)
const RP_B = 2202; // Betty, side B (team 2)

function flatPar4(idBase: number, teeId: number) {
  return Array.from({ length: 18 }, (_, i) => ({
    id: idBase + i,
    tee_id: teeId,
    hole_number: i + 1,
    par: 4,
    yardage: 350,
    stroke_index: i + 1,
  }));
}

function seedSingles(
  db: MockDb,
  opts: { roundId: number; matchId: number; scores: Array<Record<string, unknown>>; isLocked?: boolean },
) {
  const today = todayLocal();
  seed(db, {
    players: [PLAYERS.adam, PLAYERS.betty],
    seasons: [SEASON],
    league_settings: [{ key: "buy_in_amount", value: "10" }],
    tees: [{ id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 }],
    holes: flatPar4(7300, 1),
    rounds: [{ id: opts.roundId, played_on: today, is_complete: false, season_id: SEASON.id, tournament_id: 1 }],
    tournaments: [
      { id: 1, name: "GOBS Ryder Cup", side_a_name: "USA", side_b_name: "Canada", is_active: true, started_on: today, is_published: true },
    ],
    tournament_sessions: [
      { id: 9, tournament_id: 1, round_id: opts.roundId, day_number: 3, name: "Day 3", format: "singles_match", played_on: today, is_locked: opts.isLocked ?? false },
    ],
    tournament_matches: [
      {
        id: opts.matchId,
        tournament_id: 1,
        session_id: 9,
        match_number: 1,
        group_number: 1,
        side_a_team_number: 1,
        side_b_team_number: 2,
        status: "pending",
        result: null,
        result_source: "engine",
        closed_out_hole: null,
        scorer_label: null,
        admin_note: null,
      },
    ],
    round_players: [
      { id: RP_A, round_id: opts.roundId, player_id: PLAYERS.adam.id, team_number: 1, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 },
      { id: RP_B, round_id: opts.roundId, player_id: PLAYERS.betty.id, team_number: 2, tee_id: 1, course_handicap: 0, handicap_index_snapshot: 0 },
    ],
    scores: opts.scores,
  });
}

// ── Non-admin: the Clear control is not in the DOM at all ────────────────────
test.describe("non-admin device", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Clear is ABSENT from the DOM (not hidden, not disabled)", async ({ page, db }) => {
    seedSingles(db, { roundId: 220, matchId: 520, scores: [{ id: 1, round_id: 220, round_player_id: RP_A, hole_number: 1, strokes: 4 }] });
    await page.goto("/tournament/match/520");
    await expect(page.getByTestId("player-1")).toBeVisible();
    await expect(page.getByTestId("player-1-clear")).toHaveCount(0);
    await expect(page.getByTestId("player-2-clear")).toHaveCount(0);
  });
});

// ── Admin: clear a hole → confirm scope, cell blanks, toast, re-disable ──────
test("admin clears a hole: confirm names the scope, cell returns to blank, toast", async ({ page, db }) => {
  seedSingles(db, { roundId: 221, matchId: 521, scores: [{ id: 1, round_id: 221, round_player_id: RP_A, hole_number: 1, strokes: 4 }] });
  await page.goto("/tournament/match/521");
  await page.getByTestId("hole-dot-1").click(); // the card opens on the first UNSCORED hole; go to hole 1

  const clearBtn = page.getByTestId("player-1-clear");
  await expect(clearBtn).toBeEnabled(); // a score exists on hole 1
  await clearBtn.click();

  // Confirm names exactly what is going.
  await expect(page.getByText("Clear Adam Apple, hole 1 — 4 strokes?")).toBeVisible();
  const confirm = page.getByTestId("danger-confirm");
  await confirm.click(); // auto-waits past the 1.5s arm delay

  // Toast + the cell is now blank, so the Clear button re-disables.
  await expect(page.getByTestId("clear-toast-521")).toContainText("Hole 1 cleared for Adam Apple.");
  await expect(page.getByTestId("player-1-clear")).toBeDisabled();
  // And the row is DELETED from the DB (not written as 0).
  await expect
    .poll(() => (db.tables.scores ?? []).some((s) => s.round_player_id === RP_A && s.hole_number === 1))
    .toBe(false);
});

// ── Clear is disabled on a finalised (locked) round ─────────────────────────
test("admin Clear is disabled when the round is locked", async ({ page, db }) => {
  seedSingles(db, { roundId: 224, matchId: 524, isLocked: true, scores: [{ id: 1, round_id: 224, round_player_id: RP_A, hole_number: 1, strokes: 4 }] });
  await page.goto("/tournament/match/524");
  await expect(page.getByTestId("player-1-clear")).toBeVisible();
  await expect(page.getByTestId("player-1-clear")).toBeDisabled();
});

// ── Clearing does NOT disturb the scorer claim (the critical rule) ───────────
test("admin clear does not strip the scorer claim from the active scorer", async ({ page, db, browser }) => {
  seedSingles(db, { roundId: 222, matchId: 522, scores: [] });

  // Device A: a player (Adam) on his own phone, NOT admin. Same MockDb.
  const ctxA = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await ctxA.addInitScript(() => window.localStorage.setItem("gobs:tournament-player-id", "1"));
  await installSupabaseMock(ctxA, db);
  const pageA = await ctxA.newPage();
  await pageA.goto("/tournament/match/522");

  // A enters a score on hole 1 → claims the match (scorer_label = "1").
  await pageA.getByTestId("player-1").getByRole("button", { name: "Ball 1 plus" }).click();
  await expect
    .poll(() => (db.tables.tournament_matches?.[0] as { scorer_label?: string })?.scorer_label)
    .toBe("1");
  // Wait for the score itself to drain so device B sees it (a clearable hole).
  await expect
    .poll(() => (db.tables.scores ?? []).some((s) => s.round_player_id === RP_A && s.hole_number === 1))
    .toBe(true);

  // Device B: the admin, on his own phone. Sees "Adam is scoring" but — because
  // Clear is gated on admin, NOT the claim — can still clear.
  await page.goto("/tournament/match/522");
  await expect(page.getByTestId("scorer-claim-522")).toContainText("Adam Apple is scoring");
  await page.getByTestId("hole-dot-1").click(); // Adam's score is on hole 1
  const clr = page.getByTestId("player-1-clear");
  await expect(clr).toBeEnabled();
  await clr.click();
  await page.getByTestId("danger-confirm").click();
  await expect(page.getByTestId("clear-toast-522")).toBeVisible();

  // The claim is UNTOUCHED — still Adam's.
  await expect
    .poll(() => (db.tables.tournament_matches?.[0] as { scorer_label?: string })?.scorer_label)
    .toBe("1");
  // …and Adam can still score (reload → still the scorer, inputs live).
  await pageA.reload();
  await expect(pageA.getByTestId("scoring-me-522")).toBeVisible();
  await pageA.getByTestId("player-1").getByRole("button", { name: "Ball 1 plus" }).click();

  await ctxA.close();
});

// ── Cross-surface agreement: clearing a closeout hole reopens the match ──────
test("clearing a closeout hole reopens it — scorecard, dashboard, cup all agree", async ({ page, db }) => {
  // Adam wins holes 1–10 (net 3 v 4) → the singles match closes out on hole 10.
  const scores: Array<Record<string, unknown>> = [];
  for (let h = 1; h <= 10; h++) {
    scores.push({ id: 1000 + h, round_id: 223, round_player_id: RP_A, hole_number: h, strokes: 3 });
    scores.push({ id: 1100 + h, round_id: 223, round_player_id: RP_B, hole_number: h, strokes: 4 });
  }
  seedSingles(db, { roundId: 223, matchId: 523, scores });

  // Decided on load: the finish banner shows USA the winner, cup banks 1 for USA.
  await page.goto("/tournament/match/523");
  await expect(page.getByTestId("finish-banner")).toContainText("USA");

  // Clear Adam's closeout hole (10) → the match must reopen.
  await page.getByTestId("hole-dot-10").click();
  await page.getByTestId("player-1-clear").click();
  await page.getByTestId("danger-confirm").click();
  await expect(page.getByTestId("clear-toast-523")).toBeVisible();
  // Wait for the DELETE to drain to the DB so the dashboard reads the reopen.
  await expect
    .poll(() => (db.tables.scores ?? []).some((s) => s.round_player_id === RP_A && s.hole_number === 10))
    .toBe(false);
  await expect(page.getByTestId("finish-banner")).toHaveCount(0);
  const scStatus = (await page.getByTestId("sc-status-523").innerText()).trim();

  // Dashboard reads the SAME canonical engine (matchStatus) over the drained DB.
  // The scorecard composes leader + status + thru around the same status.text the
  // dashboard shows on its own, so the dashboard's text must appear verbatim in
  // the scorecard line — one canonical status, not two independent computations.
  await page.goto("/tournament/dashboard");
  const dashStatus = (await page.getByTestId("dash-status-523").innerText()).trim();
  expect(dashStatus).toBe("Dormie"); // reopened (9 up, 9 to play) — no longer "wins"
  expect(scStatus).toContain(dashStatus);
  // Cup total reflects the cleared state: the match is no longer banked for USA.
  await expect(page.getByTestId("pointsbar-pts-a")).toHaveText("0");
});
