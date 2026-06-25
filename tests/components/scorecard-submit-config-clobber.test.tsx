// @vitest-environment jsdom
/**
 * Submit-transition config clobber (the "−22" bug, 2026-06-25).
 *
 * Repro: tapping "Submit Final Scores" briefly flashed an inflated team total
 * (best-N → best-all) on the scorecard headline, while the leaderboard/summary
 * stayed correct. Root cause: submitTeam() rebuilt the engine-driving config
 * state (roundFormatConfig) from `rounds.format_config` — the FROZEN LEGACY
 * round-level blob — instead of leaving it as the round's FLIGHT config. Whatever
 * stale format-behavior key the legacy blob carried (here: override_holes) then
 * drove the local headline recompute. Fix: drop the setRoundFormatConfig(nextCfg)
 * clobber; submitted_teams is tracked solely by the `submittedTeams` state.
 *
 * NEGATIVE CONTROL — the fixture deliberately makes `rounds.format_config`
 * DIFFER from the flight config:
 *   - Flight A (canonical):   { best_n: 2, override_holes: [] }     → best-2
 *   - rounds.format_config:   { best_n: 2, override_holes: [1..18] } → best-ALL
 * FakeSupabase copies the flight config BY VALUE from the round at construction
 * UNLESS the seed declares `flights` explicitly (it does here), so the two
 * sources stay distinct — exactly the condition the live bug needed.
 *
 * Team 1: four players, CH 0 (net == gross), par 4 every hole, gross 3 (−1).
 *   - best-2  (flight, canonical): 3+3 vs 8  = −2/hole → −36 over 18.
 *   - best-ALL (round-level clobber): 3+3+3+3 vs 16 = −4/hole → −72 over 18.
 * After submit the headline must EQUAL the canonical loadRoundResults total
 * (−36), NOT the clobbered −72. With the clobber present this test goes red
 * (headline becomes −72); with the fix it stays −36 (green).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { FakeSupabase, type FakeData } from "./fake-supabase";

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

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("team=1"),
  usePathname: () => "/round/1/scorecard",
}));

import ScorecardPage from "@/app/round/[id]/scorecard/page";
import { loadRoundResults } from "@/lib/round/results";
import { resetWriteQueueForTesting } from "@/lib/writeQueue";

const ALL_18 = Array.from({ length: 18 }, (_, i) => i + 1);

// Two-team 2-Ball seed. Team 1 (the viewed team) is fully scored — four players,
// CH 0, gross 3 on every par-4 hole. Team 2 exists only so submitting team 1
// does NOT close the set (no finalize RPC fires), keeping the assertion on the
// pure submit-transition render.
function buildSeed(): FakeData {
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    holes.push({ id: n, tee_id: 1, hole_number: n, par: 4, yardage: 350, stroke_index: n });
  }
  const scores: any[] = [];
  let sid = 1000;
  for (const rpId of [101, 102, 103, 104]) {
    for (let h = 1; h <= 18; h++) {
      scores.push({ id: sid++, round_player_id: rpId, hole_number: h, strokes: 3 });
    }
  }
  return {
    rounds: [
      {
        id: 1,
        played_on: "2026-06-25",
        course_id: 1,
        is_complete: false,
        // Frozen LEGACY round-level blob — INFLATING config (override_holes spans
        // all 18 → best-ALL). The clobber would push this onto roundFormatConfig.
        format: "2_ball",
        format_config: {
          basis: "net",
          best_n: 2,
          override_holes: ALL_18,
          submitted_teams: [],
        },
        format_locked_at: "2026-06-25T00:00:00Z",
        created_at: "2026-06-25T00:00:00Z",
      },
    ],
    // Explicit flight → constructor does NOT synthesize, so the CANONICAL config
    // (best-2, no override) stays distinct from rounds.format_config above.
    flights: [
      {
        id: 9001,
        round_id: 1,
        name: "Flight A",
        sort_order: 1,
        format: "2_ball",
        format_config: { basis: "net", best_n: 2, override_holes: [] },
        format_locked_at: "2026-06-25T00:00:00Z",
      },
    ],
    flight_teams: [],
    tees: [{ id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 }],
    holes,
    round_players: [
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
      { id: 102, round_id: 1, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
      { id: 103, round_id: 1, player_id: 203, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
      { id: 104, round_id: 1, player_id: 204, tee_id: 1, team_number: 1, course_handicap: 0, dropped_after_hole: null },
      { id: 201, round_id: 1, player_id: 205, tee_id: 1, team_number: 2, course_handicap: 0, dropped_after_hole: null },
      { id: 202, round_id: 1, player_id: 206, tee_id: 1, team_number: 2, course_handicap: 0, dropped_after_hole: null },
    ],
    players: [
      { id: 201, full_name: "Alice A", display_name: "Alice A", handicap_index: 0, is_active: true, preferred_tee_id: 1 },
      { id: 202, full_name: "Bob B",   display_name: "Bob B",   handicap_index: 0, is_active: true, preferred_tee_id: 1 },
      { id: 203, full_name: "Carol C", display_name: "Carol C", handicap_index: 0, is_active: true, preferred_tee_id: 1 },
      { id: 204, full_name: "Dave D",  display_name: "Dave D",  handicap_index: 0, is_active: true, preferred_tee_id: 1 },
      { id: 205, full_name: "Erin E",  display_name: "Erin E",  handicap_index: 0, is_active: true, preferred_tee_id: 1 },
      { id: 206, full_name: "Finn F",  display_name: "Finn F",  handicap_index: 0, is_active: true, preferred_tee_id: 1 },
    ],
    scores,
  };
}

async function flushMicrotasks(rounds = 8) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

async function settle(ms: number = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

async function renderAndLoad() {
  Object.defineProperty(window, "location", {
    value: new URL("http://localhost/round/1/scorecard?team=1"),
    writable: true,
  });
  render(<ScorecardPage />);
  await settle(10);
  await settle(0);
}

// The big headline number is the sibling immediately after the "Team Net" label.
function headlineText(): string | null {
  const label = screen.getByText("Team Net");
  return (label.nextElementSibling as HTMLElement | null)?.textContent ?? null;
}

beforeEach(() => {
  globalThis.localStorage.clear();
  resetWriteQueueForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  resetWriteQueueForTesting();
  vi.useRealTimers();
});

describe("Scorecard submit transition — config clobber (−22 bug)", () => {
  it("headline equals canonical loadRoundResults total AFTER submit (not the inflated round-level config)", async () => {
    fakeRef.current = new FakeSupabase(buildSeed());
    await renderAndLoad();

    // Sanity: before submit the headline already reads the FLIGHT config (best-2).
    expect(headlineText()).toBe("−36");

    // Submit my team (DangerModal confirm has a 1.5s tappable delay).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit final scores/i }));
    });
    await settle(1600);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    });
    await settle(50);

    // Team 2 has not submitted, so no finalize RPC fired — this is the pure
    // submit-transition render.
    expect(fakeRef.current.rpcCalls).toHaveLength(0);

    // Canonical anchor: leaderboard/summary read loadRoundResults (flight config).
    const outcome = await loadRoundResults(1);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    const team1 = outcome.data.teams.find(t => t.id === 1);
    expect(team1?.totalLabel).toBe("−36");

    // Cross-surface agreement: the scorecard headline must equal the canonical
    // team total — and must NOT be the clobbered best-ALL value (−72).
    expect(headlineText()).toBe(team1?.totalLabel);
    expect(headlineText()).toBe("−36");
    expect(headlineText()).not.toBe("−72");
  });
});
