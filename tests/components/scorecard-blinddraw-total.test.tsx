// @vitest-environment jsdom
/**
 * Scorecard headline team total must include best-N blind-draw fills, so it
 * agrees with the leaderboard / summary (which run the same engine via
 * loadRoundResults). Before this fix the scorecard's buildRoundInput call
 * omitted `blindDraws`, so a finalized short team's total disagreed with every
 * other surface — the round-147-style single-player-team case shown here.
 *
 * Fixture mirrors a round-start fill (hole_range_start = 1), the shape of all
 * 5 affected rounds (101/118/141/147/161):
 *   - Short team (team 1): one player, Alice, gross 5 every hole → net 5,
 *     par 4 → +1/hole. Roster-only headline = +18.
 *   - Drawn player (team 2): Dave, gross 3 every hole → net 3 → −1/hole. He's
 *     the blind-draw fill for team 1.
 * Best Ball (N=1) picks the lower net each hole: with the fill, Dave's 3 wins
 * all 18 → team delta −18. The −18 headline can only appear if the fill is in
 * the per-hole pool, so the first test fails without the call-site fix
 * (negative control). The second test pins the pre-finalize no-op: no
 * blind_draws rows → fill never pulled in → no −18.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { FakeSupabase } from "./fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("team=1"),
  usePathname: () => "/round/1/scorecard",
}));

import ScorecardPage from "@/app/round/[id]/scorecard/page";
import { resetWriteQueueForTesting } from "@/lib/writeQueue";

// Best Ball round. Team 1 = Alice (solo, short team). Team 2 = Dave (the drawn
// player). Both on tee 1, CH 0 so net == gross and the LT1 self-heal stays
// quiet. Alice 5 / Dave 3 on every hole.
function buildBlindDrawSeed(opts: { isComplete: boolean; withBlindDraw: boolean }) {
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    holes.push({ id: n, tee_id: 1, hole_number: n, par: 4, yardage: 350, stroke_index: n });
  }
  const scores: any[] = [];
  let sid = 1000;
  for (let n = 1; n <= 18; n++) {
    scores.push({ id: sid++, round_player_id: 101, hole_number: n, strokes: 5 }); // Alice
    scores.push({ id: sid++, round_player_id: 104, hole_number: n, strokes: 3 }); // Dave
  }
  return {
    rounds: [
      {
        id: 1,
        played_on: "2026-05-13",
        course_id: 1,
        is_complete: opts.isComplete,
        format: "best_ball",
        format_config: { basis: "net", best_n: 1, override_holes: [], submitted_teams: [] },
        format_locked_at: "2026-05-13T00:00:00Z",
        created_at: "2026-05-13T00:00:00Z",
      },
    ],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes,
    round_players: [
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
      { id: 104, round_id: 1, player_id: 204, tee_id: 1, team_number: 2, course_handicap: 0, dropped_after_hole: null },
    ],
    players: [
      { id: 201, full_name: "Alice A", display_name: "Alice A", handicap_index: 0, preferred_tee_id: 1 },
      { id: 204, full_name: "Dave V", display_name: "Dave V", handicap_index: 0, preferred_tee_id: 1 },
    ],
    scores,
    blind_draws: opts.withBlindDraw
      ? [{ id: 1, round_id: 1, short_team_number: 1, drawn_player_id: 204, hole_range_start: 1, hole_range_end: 18 }]
      : [],
  };
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: new URL("http://localhost/round/1/scorecard?team=1"),
    writable: true,
  });
  routerPush.mockReset();
  globalThis.localStorage.clear();
  resetWriteQueueForTesting();
});

afterEach(() => {
  cleanup();
  resetWriteQueueForTesting();
});

describe("Scorecard headline total — best-N blind-draw fill", () => {
  it("finalized short team includes the fill (−18, matching leaderboard/summary)", async () => {
    fakeRef.current = new FakeSupabase(
      buildBlindDrawSeed({ isComplete: true, withBlindDraw: true }) as any,
    );
    render(<ScorecardPage />);

    // The corrected headline (−18) only renders once the fill is in the
    // per-hole pool; findByText waits for the async blind-draw load. Without
    // the call-site fix the team total stays +18 and this never appears.
    const teamNetLabel = await screen.findByText("Team Net");
    const bar = teamNetLabel.parentElement as HTMLElement;
    expect(await within(bar).findByText("−18")).toBeInTheDocument();
    // F9 / B9 legs corrected too (best-1 of 3 over each nine = 9×(3−4) = −9).
    expect(within(bar).getAllByText("−9")).toHaveLength(2);
    // The roster-only (pre-fix) total must not be the headline.
    expect(within(bar).queryByText("+18")).toBeNull();
  });

  it("pre-finalize is a no-op (no blind_draws rows → headline unchanged at +18)", async () => {
    fakeRef.current = new FakeSupabase(
      buildBlindDrawSeed({ isComplete: false, withBlindDraw: false }) as any,
    );
    render(<ScorecardPage />);

    const teamNetLabel = await screen.findByText("Team Net");
    const bar = teamNetLabel.parentElement as HTMLElement;
    // No fill exists → roster-only headline is correct and unchanged.
    expect(within(bar).getByText("+18")).toBeInTheDocument();
    expect(within(bar).queryByText("−18")).toBeNull();
  });
});
