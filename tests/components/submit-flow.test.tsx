// @vitest-environment jsdom
/**
 * D.1 hotfix (2026-05-18) — per-team Submit Final Scores flow.
 *
 * Replaces the deleted end-round-flow.test.tsx, which exercised the
 * pre-hotfix auto-fire-on-last-score path. The new flow gates RPC
 * firing behind every team appearing in format_config.submitted_teams.
 *
 * Pattern matches StaleFailureDialog tests: vi.useFakeTimers() driving
 * the load() useEffect, then act + fireEvent for interactions.
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
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/round/1/scorecard",
}));

import ScorecardPage from "@/app/round/[id]/scorecard/page";
import { resetWriteQueueForTesting } from "@/lib/writeQueue";

/**
 * Two-team seed: team 1 has rp_ids 101/102, team 2 has rp_ids 201/202.
 * Optionally pre-scored. The default is all 18 holes filled for every
 * player (so isRoundLocallyComplete is true on both teams immediately).
 */
function buildTwoTeamSeed(opts: {
  preExistingSubmittedTeams?: number[];
  scoreEveryHole?: boolean;
} = {}): FakeData {
  const { preExistingSubmittedTeams = [], scoreEveryHole = true } = opts;
  const holes = [];
  for (const teeId of [1, 2]) {
    for (let n = 1; n <= 18; n++) {
      holes.push({
        id: holes.length + 1,
        tee_id: teeId,
        hole_number: n,
        par: 4,
        yardage: 350,
        stroke_index: n,
      });
    }
  }
  const scores: any[] = [];
  if (scoreEveryHole) {
    for (const rpId of [101, 102, 201, 202]) {
      for (let h = 1; h <= 18; h++) {
        scores.push({
          id: scores.length + 1,
          round_player_id: rpId,
          hole_number: h,
          strokes: 4,
          created_at: new Date().toISOString(),
        });
      }
    }
  }
  return {
    rounds: [
      {
        id: 1,
        played_on: "2026-05-18",
        course_id: 1,
        is_complete: false,
        format: "2_ball",
        format_config: {
          basis: "net",
          best_n: 2,
          override_holes: [],
          submitted_teams: preExistingSubmittedTeams,
        },
        format_locked_at: "2026-05-18T00:00:00Z",
        created_at: "2026-05-18T00:00:00Z",
      },
    ],
    tees: [
      { id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 },
      { id: 2, color: "Yellow", slope_rating: 115, course_rating: 68, par: 72, sort_order: 2 },
    ],
    holes,
    round_players: [
      { id: 101, round_id: 1, player_id: 301, tee_id: 1, team_number: 1, course_handicap: 10 },
      { id: 102, round_id: 1, player_id: 302, tee_id: 1, team_number: 1, course_handicap: 12 },
      { id: 201, round_id: 1, player_id: 303, tee_id: 1, team_number: 2, course_handicap: 8 },
      { id: 202, round_id: 1, player_id: 304, tee_id: 1, team_number: 2, course_handicap: 14 },
    ],
    players: [
      { id: 301, full_name: "Alice A", display_name: "Alice A", handicap_index: 10, preferred_tee_id: 1 },
      { id: 302, full_name: "Bob B",   display_name: "Bob B",   handicap_index: 12, preferred_tee_id: 1 },
      { id: 303, full_name: "Carol C", display_name: "Carol C", handicap_index: 8,  preferred_tee_id: 1 },
      { id: 304, full_name: "Dave D",  display_name: "Dave D",  handicap_index: 14, preferred_tee_id: 1 },
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

async function renderAndLoad(team: string) {
  Object.defineProperty(window, "location", {
    value: new URL(`http://localhost/round/1/scorecard?team=${team}`),
    writable: true,
  });
  render(<ScorecardPage />);
  await settle(10);
  await settle(0);
}

async function tapSubmitAndConfirm() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /submit final scores/i }));
  });
  // DangerModal confirm button has a 1.5s delay.
  await settle(1600);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  });
  await settle(50);
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

describe("D.1 hotfix — Submit Final Scores", () => {
  it("Submit button is disabled until every hole is scored", async () => {
    // Same seed minus the score rows → isRoundLocallyComplete is false.
    fakeRef.current = new FakeSupabase(
      buildTwoTeamSeed({ scoreEveryHole: false }),
    );
    await renderAndLoad("1");
    const btn = screen.getByRole("button", { name: /submit final scores/i });
    expect(btn).toBeDisabled();
    expect(fakeRef.current.rpcCalls).toHaveLength(0);
  });

  it("Submit appends my team to format_config.submitted_teams", async () => {
    fakeRef.current = new FakeSupabase(buildTwoTeamSeed());
    await renderAndLoad("1");

    const btn = screen.getByRole("button", { name: /submit final scores/i });
    expect(btn).toBeEnabled();

    await tapSubmitAndConfirm();

    const updated = fakeRef.current.data.rounds[0].format_config as {
      submitted_teams?: number[];
    };
    expect(updated.submitted_teams).toEqual([1]);
  });

  it("does NOT fire the RPC when only my team has submitted", async () => {
    fakeRef.current = new FakeSupabase(buildTwoTeamSeed());
    await renderAndLoad("1");
    await tapSubmitAndConfirm();

    // The RPC should not have fired — team 2 is still scoring.
    expect(fakeRef.current.rpcCalls).toHaveLength(0);
  });

  it("fires the RPC exactly once when MY submit closes the set", async () => {
    // Team 2 already submitted; team 1 about to.
    fakeRef.current = new FakeSupabase(
      buildTwoTeamSeed({ preExistingSubmittedTeams: [2] }),
    );
    await renderAndLoad("1");
    await tapSubmitAndConfirm();

    expect(fakeRef.current.rpcCalls).toHaveLength(1);
    expect(fakeRef.current.rpcCalls[0].name).toBe(
      "finalize_round_with_blind_draws",
    );
    expect(fakeRef.current.rpcCalls[0].args).toEqual({ p_round_id: 1 });
  });

  it("renders 'Final scores submitted' + hides Submit after my team is in submitted_teams", async () => {
    fakeRef.current = new FakeSupabase(
      buildTwoTeamSeed({ preExistingSubmittedTeams: [1] }),
    );
    await renderAndLoad("1");
    expect(screen.getByText(/final scores submitted/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /submit final scores/i }),
    ).toBeNull();
  });

  it("renders the pre-fire banner when this team is the last not-yet-submitted", async () => {
    fakeRef.current = new FakeSupabase(
      buildTwoTeamSeed({ preExistingSubmittedTeams: [2] }),
    );
    await renderAndLoad("1");
    expect(
      screen.getByText(/all other teams have submitted/i),
    ).toBeInTheDocument();
  });
});
