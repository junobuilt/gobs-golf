// @vitest-environment jsdom
// DOM tests for the public match-play scorecard (/tournament/match/[matchId]).
// loadMatch is mocked to return LoadedMatch fixtures (keeping the real error
// classes so the page's instanceof checks work); the write queues are mocked to
// capture enqueue calls. Rendered outcomes/headers come from the same pure
// engine the loader uses — the surface does no arithmetic of its own.

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { makeLoaded } from "../support/matchFixture";

const mocks = vi.hoisted(() => ({
  loadMatch: vi.fn(),
  loadSessionMatches: vi.fn(),
  scoreEnqueue: vi.fn(),
  teamEnqueue: vi.fn(),
  scoreItems: [] as Array<{ state: string }>,
  teamItems: [] as Array<{ state: string }>,
}));

// loadMatch.ts imports the supabase client at module load; stub it (we never
// call the real loader — it's mocked below) so no real client is constructed.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/lib/tournament/loadMatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tournament/loadMatch")>();
  return { ...actual, loadMatch: mocks.loadMatch, loadSessionMatches: mocks.loadSessionMatches };
});

vi.mock("@/lib/writeQueue", () => ({
  getWriteQueue: () => ({
    enqueue: mocks.scoreEnqueue,
    getItems: (f?: { state?: string }) => (f?.state ? mocks.scoreItems.filter((i) => i.state === f.state) : mocks.scoreItems),
    subscribe: () => () => {},
  }),
  getTeamWriteQueue: () => ({
    enqueue: mocks.teamEnqueue,
    getItems: (f?: { state?: string }) => (f?.state ? mocks.teamItems.filter((i) => i.state === f.state) : mocks.teamItems),
    subscribe: () => () => {},
  }),
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ matchId: "500" }) }));

import MatchScorecardPage from "@/app/tournament/match/[matchId]/page";
import { MixedTeesInMatchError } from "@/lib/tournament/loadMatch";

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
async function renderPage() {
  render(<MatchScorecardPage />);
  await act(async () => {
    await flush();
  });
}

beforeEach(() => {
  cleanup();
  mocks.loadMatch.mockReset();
  mocks.loadSessionMatches.mockReset();
  mocks.scoreEnqueue.mockReset();
  mocks.teamEnqueue.mockReset();
  mocks.scoreItems = [];
  mocks.teamItems = [];
});

describe("match scorecard — four-ball rendering + counting ball", () => {
  it("renders header/outcome from the engine and marks the winning ball", async () => {
    // Stroke flip: A P2 (CH20) net 3 beats A P1 (CH0) net 4; B best 6. A wins hole 1.
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "four_ball_match",
        a: [{ playerId: 1, ch: 0, scored: { 1: 4 } }, { playerId: 2, ch: 20, scored: { 1: 5 } }],
        b: [{ playerId: 3, ch: 0, scored: { 1: 6 } }, { playerId: 4, ch: 0, scored: { 1: 7 } }],
      }),
    );
    await renderPage();

    const header = screen.getByTestId("match-header-500");
    expect(header).toHaveTextContent("USA 1");
    expect(header).toHaveTextContent("CANADA 0");
    expect(header).toHaveTextContent("USA 1 UP");
    expect(header).toHaveTextContent("thru 1");

    expect(screen.getByTestId("hole-outcome-500")).toHaveTextContent("USA wins the hole");
    // The counting ← is on P2 (the ball the stroke made count), not P1.
    expect(screen.getByTestId("player-2-counting")).toBeInTheDocument();
    expect(screen.queryByTestId("player-1-counting")).not.toBeInTheDocument();
  });
});

describe("match scorecard — alternate shot writes one team_scores row at ball_index 1", () => {
  it("tapping the side box enqueues exactly one team write at ball_index 1, never 2", async () => {
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "greensomes",
        a: [{ playerId: 1, ch: 5, scored: {} }, { playerId: 2, ch: 15, scored: {} }],
        b: [{ playerId: 3, ch: 10, scored: {} }, { playerId: 4, ch: 20, scored: {} }],
        teamA_number: 3,
        teamB_number: 4,
      }),
    );
    await renderPage();

    const boxA = screen.getByTestId("greensomes-a");
    await act(async () => {
      fireEvent.click(within(boxA).getByTestId("ball-1-plus")); // par-anchor → 4
      await flush();
    });

    expect(mocks.teamEnqueue).toHaveBeenCalledTimes(1);
    expect(mocks.teamEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ round_id: 50, team_number: 3, hole_number: 1, ball_index: 1, strokes: 4 }),
      expect.anything(),
    );
    // never a ball_index = 2 row, and never an individual score for greensomes.
    expect(mocks.teamEnqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({ ball_index: 2 }),
      expect.anything(),
    );
    expect(mocks.scoreEnqueue).not.toHaveBeenCalled();
  });
});

describe("match scorecard — offline recompute", () => {
  it("entering scores updates the header immediately without reloading", async () => {
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "singles_match",
        a: [{ playerId: 1, ch: 0, scored: {} }],
        b: [{ playerId: 2, ch: 0, scored: {} }],
      }),
    );
    await renderPage();
    expect(screen.getByTestId("match-header-500")).toHaveTextContent("not started");

    // Each tap is its own event in real use — flush between so the stepper
    // re-renders with the updated value before the next tap (par-anchor + inc).
    const tap = async (testid: string) => {
      await act(async () => {
        fireEvent.click(within(screen.getByTestId(testid)).getByTestId("ball-1-plus"));
        await flush();
      });
    };
    await tap("player-1"); // A = 4
    await tap("player-2"); // B = 4
    await tap("player-2"); // B = 5

    const header = screen.getByTestId("match-header-500");
    expect(header).toHaveTextContent("USA 1");
    expect(header).toHaveTextContent("USA 1 UP");
    expect(header).toHaveTextContent("thru 1");
    // No reload happened — loadMatch called exactly once (mount).
    expect(mocks.loadMatch).toHaveBeenCalledTimes(1);
    expect(mocks.scoreEnqueue).toHaveBeenCalled(); // writes still queued (offline-tolerant)
  });
});

describe("match scorecard — singles: two independent matches on one card", () => {
  it("one match closes out and shows its banner while the other stays live", async () => {
    const matchA = makeLoaded({
      id: 500,
      matchNumber: 1,
      format: "singles_match",
      groupNumber: 7,
      a: [{ playerId: 1, ch: 0, scored: winMap([1, 2, 3, 4, 5], [], range(6, 14)).a }],
      b: [{ playerId: 2, ch: 0, scored: winMap([1, 2, 3, 4, 5], [], range(6, 14)).b }],
    });
    const matchB = makeLoaded({
      id: 501,
      matchNumber: 2,
      format: "singles_match",
      groupNumber: 7,
      teamA_number: 3,
      teamB_number: 4,
      a: [{ playerId: 3, ch: 0, scored: { 1: 4 } }],
      b: [{ playerId: 4, ch: 0, scored: { 1: 5 } }],
    });
    mocks.loadMatch.mockResolvedValue(matchA);
    mocks.loadSessionMatches.mockResolvedValue([matchA, matchB]);
    await renderPage();

    // Match A closed out (5&4) → banner, no inputs.
    const cardA = screen.getByTestId("match-card-500");
    expect(within(cardA).getByTestId("finish-banner")).toHaveTextContent("USA wins 5&4");
    expect(within(cardA).queryByTestId("player-1")).not.toBeInTheDocument();

    // Match B still live → shows player boxes, no banner.
    const cardB = screen.getByTestId("match-card-501");
    expect(within(cardB).queryByTestId("finish-banner")).not.toBeInTheDocument();
    expect(within(cardB).getByTestId("player-3")).toBeInTheDocument();
  });
});

describe("match scorecard — closeout", () => {
  it("hides inputs, shows the margin, and notes scores beyond the closeout", async () => {
    // A wins 1-5, halves 6-14 → 5&4 at 14; hole 15 also scored → scoredBeyondCloseout.
    const { a, b } = winMap([1, 2, 3, 4, 5], [], range(6, 14));
    a[15] = 4;
    b[15] = 5;
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "singles_match",
        a: [{ playerId: 1, ch: 0, scored: a }],
        b: [{ playerId: 2, ch: 0, scored: b }],
      }),
    );
    await renderPage();

    expect(screen.getByTestId("finish-banner")).toHaveTextContent("Match over — USA wins 5&4.");
    expect(screen.getByTestId("scored-beyond-note")).toBeInTheDocument();
    expect(screen.queryByTestId("player-1")).not.toBeInTheDocument(); // inputs hidden
  });
});

describe("match scorecard — missing hole", () => {
  it("shows a persistent amber prompt with the real hole numbers and keeps it across holes", async () => {
    // Holes 1,2 scored; 3 blank; 4 scored → gap at 3.
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "singles_match",
        a: [{ playerId: 1, ch: 0, scored: { 1: 4, 2: 4, 4: 4 } }],
        b: [{ playerId: 2, ch: 0, scored: { 1: 5, 2: 5, 4: 5 } }],
      }),
    );
    await renderPage();

    const amber = screen.getByTestId("missing-hole-500");
    expect(amber).toHaveTextContent("Hole 3 has no score");
    expect(amber).toHaveTextContent("past hole 2");

    // Navigate forward — the amber is carried onto later holes.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Next Hole/ }));
      await flush();
    });
    expect(screen.getByTestId("missing-hole-500")).toBeInTheDocument();
  });
});

describe("match scorecard — friendly error states", () => {
  it("renders the friendly setup state on MixedTeesInMatchError, not a crash", async () => {
    mocks.loadMatch.mockRejectedValue(new MixedTeesInMatchError(500, [1, 2]));
    await renderPage();
    expect(screen.getByText(/isn’t set up correctly/)).toBeInTheDocument();
  });
});

describe("match scorecard — visible write failure", () => {
  it("surfaces a banner when a queued write went terminal", async () => {
    mocks.scoreItems = [{ state: "terminal_failure" }];
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "singles_match",
        a: [{ playerId: 1, ch: 0, scored: {} }],
        b: [{ playerId: 2, ch: 0, scored: {} }],
      }),
    );
    await renderPage();
    expect(screen.getByTestId("sync-failed-banner")).toBeInTheDocument();
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────
function range(lo: number, hi: number): number[] {
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}
function winMap(aWins: number[], bWins: number[], halves: number[]): { a: Record<number, number>; b: Record<number, number> } {
  const a: Record<number, number> = {};
  const b: Record<number, number> = {};
  for (const h of aWins) { a[h] = 4; b[h] = 5; }
  for (const h of bWins) { a[h] = 5; b[h] = 4; }
  for (const h of halves) { a[h] = 4; b[h] = 4; }
  return { a, b };
}
