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
  scoreItems: [] as Array<{ state: string; payload?: Record<string, number> }>,
  teamItems: [] as Array<{ state: string; payload?: Record<string, number> }>,
  storedPlayerId: null as number | null,
  setMatchScorer: vi.fn(),
  setMatchFlag: vi.fn(),
}));

// loadMatch.ts imports the supabase client at module load; stub it (we never
// call the real loader — it's mocked below) so no real client is constructed.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// Device identity (Relay A) — controllable per test.
vi.mock("@/lib/deviceMemory", () => ({
  getStoredPlayerId: () => mocks.storedPlayerId,
  setStoredPlayerId: vi.fn(),
  clearStoredPlayerId: vi.fn(),
}));

// Claim/flag coordination writes — capture without hitting the (stubbed) client.
vi.mock("@/lib/tournament/mutations", () => ({
  setMatchScorer: mocks.setMatchScorer,
  setMatchFlag: mocks.setMatchFlag,
}));

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
import { MixedTeesInMatchError, MatchLoadError, MatchNotFoundError } from "@/lib/tournament/loadMatch";

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
  mocks.storedPlayerId = null;
  mocks.setMatchScorer.mockReset();
  mocks.setMatchScorer.mockResolvedValue(undefined);
  mocks.setMatchFlag.mockReset();
  mocks.setMatchFlag.mockResolvedValue(undefined);
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

    // Match A closed out (5&4) → banner AND still-live inputs (soft closeout).
    const cardA = screen.getByTestId("match-card-500");
    expect(within(cardA).getByTestId("finish-banner")).toHaveTextContent("USA wins 5&4");
    expect(within(cardA).getByTestId("player-1")).toBeInTheDocument();

    // Match B still live → shows player boxes, no banner.
    const cardB = screen.getByTestId("match-card-501");
    expect(within(cardB).queryByTestId("finish-banner")).not.toBeInTheDocument();
    expect(within(cardB).getByTestId("player-3")).toBeInTheDocument();
  });
});

describe("match scorecard — soft closeout", () => {
  it("shows the banner + note but KEEPS inputs live (correctable) on a decided match", async () => {
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
    // Soft closeout: inputs stay editable so a premature stray tap is correctable.
    expect(screen.getByTestId("player-1")).toBeInTheDocument();
    expect(within(screen.getByTestId("player-1")).getByTestId("ball-1-plus")).toBeInTheDocument();
  });
});

// ── Soft closeout: a decided match keeps live, correctable inputs ─────────────
describe("match scorecard — soft closeout keeps inputs correctable", () => {
  it("singles: decided match renders banner AND editable inputs", async () => {
    const { a, b } = winMap([1, 2, 3, 4, 5], [], range(6, 14)); // 5&4
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({ format: "singles_match", a: [{ playerId: 1, ch: 0, scored: a }], b: [{ playerId: 2, ch: 0, scored: b }] }),
    );
    await renderPage();
    expect(screen.getByTestId("finish-banner")).toBeInTheDocument();
    expect(within(screen.getByTestId("player-1")).getByTestId("ball-1-plus")).toBeInTheDocument();
  });

  it("four-ball: decided match renders banner AND editable inputs", async () => {
    // A wins holes 1-10 (net 3 vs 5), one ball each side → closeout at 10.
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "four_ball_match",
        a: [{ playerId: 1, ch: 0, scored: fill(10, 3) }, { playerId: 2, ch: 0, scored: {} }],
        b: [{ playerId: 3, ch: 0, scored: fill(10, 5) }, { playerId: 4, ch: 0, scored: {} }],
      }),
    );
    await renderPage();
    expect(screen.getByTestId("finish-banner")).toBeInTheDocument();
    expect(within(screen.getByTestId("player-1")).getByTestId("ball-1-plus")).toBeInTheDocument();
  });

  it("greensomes: decided match renders banner AND editable inputs", async () => {
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "greensomes",
        a: [{ playerId: 1, ch: 0, scored: {} }, { playerId: 2, ch: 0, scored: {} }],
        b: [{ playerId: 3, ch: 0, scored: {} }, { playerId: 4, ch: 0, scored: {} }],
        teamA: fill(10, 3),
        teamB: fill(10, 5),
      }),
    );
    await renderPage();
    expect(screen.getByTestId("finish-banner")).toBeInTheDocument();
    expect(within(screen.getByTestId("greensomes-a")).getByTestId("ball-1-plus")).toBeInTheDocument();
  });

  it("correcting a stroke that un-decides a match clears the banner; inputs stay editable", async () => {
    const { a, b } = winMap([1, 2, 3, 4, 5], [], range(6, 14)); // A 5&4; A wins hole 5 (4 vs 5)
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({ format: "singles_match", a: [{ playerId: 1, ch: 0, scored: a }], b: [{ playerId: 2, ch: 0, scored: b }] }),
    );
    await renderPage();
    expect(screen.getByTestId("finish-banner")).toBeInTheDocument();

    // Go to hole 5 and bump Adam 4 → 5 (a halve) — match is no longer 5&4.
    await act(async () => {
      fireEvent.click(screen.getByTestId("hole-dot-5"));
      await flush();
    });
    await act(async () => {
      fireEvent.click(within(screen.getByTestId("player-1")).getByTestId("ball-1-plus"));
      await flush();
    });

    // Banner auto-cleared (derived from the recompute); inputs still editable.
    expect(screen.queryByTestId("finish-banner")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("player-1")).getByTestId("ball-1-plus")).toBeInTheDocument();
  });

  it("singles: correcting the decided match clears only its banner; the other is untouched", async () => {
    const win = winMap([1, 2, 3, 4, 5], [], range(6, 14));
    const matchA = makeLoaded({
      id: 500,
      matchNumber: 1,
      format: "singles_match",
      groupNumber: 7,
      a: [{ playerId: 1, ch: 0, scored: win.a }],
      b: [{ playerId: 2, ch: 0, scored: win.b }],
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

    expect(within(screen.getByTestId("match-card-500")).getByTestId("finish-banner")).toBeInTheDocument();
    expect(within(screen.getByTestId("match-card-501")).queryByTestId("finish-banner")).not.toBeInTheDocument();

    // Shared nav → hole 5; correct match A's Adam (player-1 lives only in card 500).
    await act(async () => {
      fireEvent.click(screen.getByTestId("hole-dot-5"));
      await flush();
    });
    await act(async () => {
      fireEvent.click(within(screen.getByTestId("player-1")).getByTestId("ball-1-plus"));
      await flush();
    });

    // Match A's banner cleared; match B unchanged (never had one, inputs live).
    expect(within(screen.getByTestId("match-card-500")).queryByTestId("finish-banner")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("match-card-501")).queryByTestId("finish-banner")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("match-card-501")).getByTestId("player-3")).toBeInTheDocument();
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

// ── F2: offline background refetch must not crash the live card ───────────────
describe("match scorecard — offline background refresh (F2)", () => {
  function singlesFixture() {
    return makeLoaded({
      format: "singles_match",
      a: [{ playerId: 1, ch: 0, scored: { 1: 4 } }],
      b: [{ playerId: 2, ch: 0, scored: { 1: 5 } }],
    });
  }

  it("a failed background refetch does NOT clear the card or render not-found", async () => {
    mocks.loadMatch.mockResolvedValueOnce(singlesFixture()); // mount succeeds → USA 1
    await renderPage();
    expect(screen.getByTestId("match-card-500")).toBeInTheDocument();
    expect(screen.getByTestId("match-header-500")).toHaveTextContent("USA 1");

    // Background refetch now fails (offline).
    mocks.loadMatch.mockRejectedValue(new MatchLoadError("Failed to fetch"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await flush();
    });

    // Card survives; the score is preserved; NO not-found copy.
    expect(screen.getByTestId("match-card-500")).toBeInTheDocument();
    expect(screen.getByTestId("match-header-500")).toHaveTextContent("USA 1");
    expect(screen.queryByText(/couldn’t be found/i)).not.toBeInTheDocument();
  });

  it("a network error on INITIAL load classifies as offline (retry), not not-found", async () => {
    mocks.loadMatch.mockRejectedValue(new MatchLoadError("Failed to fetch"));
    await renderPage();
    expect(screen.getByText(/you may be offline/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t be found/i)).not.toBeInTheDocument();
  });

  it("a genuine missing match (bad ID) still renders the not-found state on initial load", async () => {
    mocks.loadMatch.mockRejectedValue(new MatchNotFoundError(500));
    await renderPage();
    expect(screen.getByText(/couldn’t be found/i)).toBeInTheDocument();
  });

  it("self-recovers from offline when a later refresh succeeds (online event, no tab switch)", async () => {
    mocks.loadMatch.mockRejectedValueOnce(new MatchLoadError("Failed to fetch")); // mount offline
    await renderPage();
    expect(screen.getByText(/you may be offline/i)).toBeInTheDocument();

    // Signal returns → `online` fires → backgroundRefresh promotes offline → ready.
    mocks.loadMatch.mockResolvedValue(singlesFixture());
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await flush();
    });
    expect(screen.getByTestId("match-card-500")).toBeInTheDocument();
    expect(screen.queryByText(/you may be offline/i)).not.toBeInTheDocument();
  });

  it("reconcile: a background success overlays server truth AND keeps a pending un-synced entry", async () => {
    // Mount with no server scores, but a pending local edit for P1 hole 1 = 3.
    mocks.scoreItems = [
      { state: "pending", payload: { round_id: 50, round_player_id: 1001, hole_number: 1, strokes: 3 } },
    ];
    mocks.loadMatch.mockResolvedValueOnce(
      makeLoaded({
        format: "singles_match",
        a: [{ playerId: 1, ch: 0, scored: {} }],
        b: [{ playerId: 2, ch: 0, scored: {} }],
      }),
    );
    await renderPage();
    // Pending overlay applied at mount.
    expect(within(screen.getByTestId("player-1")).getByTestId("ball-1-value")).toHaveTextContent("3");

    // A background success now brings a server entry for P2 (another scorer).
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "singles_match",
        a: [{ playerId: 1, ch: 0, scored: {} }],
        b: [{ playerId: 2, ch: 0, scored: { 1: 5 } }],
      }),
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await flush();
    });
    // Server truth picked up (P2 = 5) AND the pending local P1 = 3 survived.
    expect(within(screen.getByTestId("player-2")).getByTestId("ball-1-value")).toHaveTextContent("5");
    expect(within(screen.getByTestId("player-1")).getByTestId("ball-1-value")).toHaveTextContent("3");
  });
});

// ── F1: per-hole context ──────────────────────────────────────────────────────
describe("match scorecard — hole context (F1)", () => {
  it("renders hole #, par, yardage, and stroke index once per card", async () => {
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "four_ball_match",
        a: [{ playerId: 1, ch: 0, scored: {} }, { playerId: 2, ch: 0, scored: {} }],
        b: [{ playerId: 3, ch: 0, scored: {} }, { playerId: 4, ch: 0, scored: {} }],
      }),
    );
    await renderPage();
    const ctx = screen.getByTestId("hole-context-500");
    expect(ctx).toHaveTextContent("Hole 1");
    expect(ctx).toHaveTextContent("Par 4");
    expect(ctx).toHaveTextContent("300 yds"); // fixture yardage = 300 + (hole-1)*10
    expect(ctx).toHaveTextContent("SI 1");
  });
});

// ── A: soft scorer-claim + one-tap takeover ──────────────────────────────────
describe("match scorecard — soft scorer-claim (A)", () => {
  function singles(scorerLabel: string | null = null) {
    return makeLoaded({
      format: "singles_match",
      a: [{ playerId: 1, ch: 0, scored: {} }],
      b: [{ playerId: 2, ch: 0, scored: {} }],
      scorerLabel,
    });
  }

  it("first score on an unclaimed match soft-claims it for this device", async () => {
    mocks.storedPlayerId = 1;
    mocks.loadMatch.mockResolvedValue(singles(null));
    await renderPage();
    // Unclaimed → no claim banner, inputs live.
    expect(screen.queryByTestId("scorer-claim-500")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(screen.getByTestId("player-1")).getByTestId("ball-1-plus"));
      await flush();
    });

    // Claimed for player 1 (as text) + the score still enqueued.
    expect(mocks.setMatchScorer).toHaveBeenCalledWith(500, 1);
    expect(mocks.scoreEnqueue).toHaveBeenCalled();
    expect(screen.getByTestId("scoring-me-500")).toBeInTheDocument();
  });

  it("someone else scoring → read-only-styled inputs + a Take over button (no confirm)", async () => {
    mocks.storedPlayerId = 1; // I am player 1; the claim is player 2.
    mocks.loadMatch.mockResolvedValue(singles("2"));
    await renderPage();

    expect(screen.getByTestId("scorer-claim-500")).toHaveTextContent("P2 is scoring");
    expect(screen.getByTestId("take-over-500")).toBeInTheDocument();
    // Read-only STYLING: the stepper is disabled (a signal, not a data lock).
    expect(within(screen.getByTestId("player-1")).getByTestId("ball-1-plus")).toBeDisabled();
  });

  it("one-tap takeover reassigns the claim AND lets this device write (never hard-locked)", async () => {
    mocks.storedPlayerId = 1;
    mocks.loadMatch.mockResolvedValue(singles("2"));
    await renderPage();

    // One tap — no confirmation modal in between.
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-over-500"));
      await flush();
    });
    expect(mocks.setMatchScorer).toHaveBeenCalledWith(500, 1);
    expect(screen.queryByTestId("scorer-claim-500")).not.toBeInTheDocument();

    // Inputs are now live and a write goes through — nobody is stranded.
    const plus = within(screen.getByTestId("player-1")).getByTestId("ball-1-plus");
    expect(plus).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(plus);
      await flush();
    });
    expect(mocks.scoreEnqueue).toHaveBeenCalled();
  });

  it("claim state rides the refresh path — a background refresh surfaces a new scorer", async () => {
    mocks.storedPlayerId = 1;
    mocks.loadMatch.mockResolvedValueOnce(singles(null)); // mount: unclaimed
    await renderPage();
    expect(screen.queryByTestId("scorer-claim-500")).not.toBeInTheDocument();

    // Another device claimed it; a background refetch reads the new scorer_label.
    mocks.loadMatch.mockResolvedValue(singles("2"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await flush();
    });
    expect(screen.getByTestId("scorer-claim-500")).toHaveTextContent("P2 is scoring");
  });

  it("an unidentified device can still score, but claims nothing", async () => {
    mocks.storedPlayerId = null; // never picked "who are you?"
    mocks.loadMatch.mockResolvedValue(singles(null));
    await renderPage();
    await act(async () => {
      fireEvent.click(within(screen.getByTestId("player-1")).getByTestId("ball-1-plus"));
      await flush();
    });
    expect(mocks.scoreEnqueue).toHaveBeenCalled(); // write not blocked
    expect(mocks.setMatchScorer).not.toHaveBeenCalled(); // but no claim written
  });
});

// ── B: "Flag this hole" — opposing-side escape valve (metadata only) ──────────
describe("match scorecard — flag this hole (B)", () => {
  function singles(opts: { scorerLabel?: string | null; flaggedHole?: number | null } = {}) {
    return makeLoaded({
      format: "singles_match",
      a: [{ playerId: 1, ch: 0, scored: {} }],
      b: [{ playerId: 2, ch: 0, scored: {} }],
      scorerLabel: opts.scorerLabel ?? null,
      flaggedHole: opts.flaggedHole ?? null,
    });
  }

  it("a non-scorer flags the current hole — metadata write, no score touched", async () => {
    mocks.storedPlayerId = 1; // P2 is scoring; I'm the opposing P1.
    mocks.loadMatch.mockResolvedValue(singles({ scorerLabel: "2" }));
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByTestId("flag-hole-500")); // current hole = 1
      await flush();
    });

    expect(mocks.setMatchFlag).toHaveBeenCalledWith(500, 1);
    expect(mocks.scoreEnqueue).not.toHaveBeenCalled(); // never a score write
    expect(screen.getByTestId("flag-marker-500")).toHaveTextContent("Hole 1 flagged");
  });

  it("the flag rides the refresh path — a background refresh surfaces it to the scorer", async () => {
    mocks.storedPlayerId = 1;
    mocks.loadMatch.mockResolvedValueOnce(singles({ scorerLabel: "2", flaggedHole: null }));
    await renderPage();
    expect(screen.queryByTestId("flag-marker-500")).not.toBeInTheDocument();

    mocks.loadMatch.mockResolvedValue(singles({ scorerLabel: "2", flaggedHole: 5 }));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await flush();
    });
    expect(screen.getByTestId("flag-marker-500")).toHaveTextContent("Hole 5 flagged");
  });

  it("correcting the flagged hole's score clears the flag automatically", async () => {
    mocks.storedPlayerId = 1; // unclaimed → I'm the scorer; hole 1 is flagged.
    mocks.loadMatch.mockResolvedValue(singles({ scorerLabel: null, flaggedHole: 1 }));
    await renderPage();
    expect(screen.getByTestId("flag-marker-500")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(screen.getByTestId("player-1")).getByTestId("ball-1-plus")); // correct hole 1
      await flush();
    });

    expect(mocks.setMatchFlag).toHaveBeenCalledWith(500, null);
    expect(screen.queryByTestId("flag-marker-500")).not.toBeInTheDocument();
  });

  it("the scorer can dismiss the flag; a non-scorer has no flag button on an unclaimed match", async () => {
    mocks.storedPlayerId = 1;
    mocks.loadMatch.mockResolvedValue(singles({ scorerLabel: null, flaggedHole: 3 }));
    await renderPage();
    // Unclaimed → I'm scorer → no "Flag this hole" button (that's the opposing view).
    expect(screen.queryByTestId("flag-hole-500")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("flag-dismiss-500"));
      await flush();
    });
    expect(mocks.setMatchFlag).toHaveBeenCalledWith(500, null);
    expect(screen.queryByTestId("flag-marker-500")).not.toBeInTheDocument();
  });
});

// ── C: read-only 18-hole review grid ─────────────────────────────────────────
describe("match scorecard — 18-hole review grid (C)", () => {
  it("expands a read-only grid whose hole outcomes read the canonical MatchState", async () => {
    // A wins hole 1 (P1 net 4 vs B best 6); B wins hole 2 (5 vs 4).
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "four_ball_match",
        a: [{ playerId: 1, ch: 0, scored: { 1: 4, 2: 5 } }, { playerId: 2, ch: 0, scored: {} }],
        b: [{ playerId: 3, ch: 0, scored: { 1: 6, 2: 4 } }, { playerId: 4, ch: 0, scored: {} }],
      }),
    );
    await renderPage();

    // Collapsed by default.
    expect(screen.queryByTestId("review-grid-500")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId("review-toggle-500"));
      await flush();
    });

    const grid = screen.getByTestId("review-grid-500");
    // Both sides + all four players (four-ball) render.
    expect(within(grid).getByTestId("review-side-a")).toHaveTextContent("P1");
    expect(within(grid).getByTestId("review-side-a")).toHaveTextContent("P2");
    expect(within(grid).getByTestId("review-side-b")).toHaveTextContent("P3");

    // Hole outcomes are READ from the engine, not recomputed here.
    expect(within(grid).getByTestId("review-outcome-1")).toHaveTextContent("A");
    expect(within(grid).getByTestId("review-outcome-2")).toHaveTextContent("B");
    expect(within(grid).getByTestId("review-outcome-3")).toHaveTextContent(""); // unresolved

    // Read-only: no steppers anywhere in the grid.
    expect(within(grid).queryAllByTestId("ball-1-plus")).toHaveLength(0);
    // 18 holes rendered (PlayerHoleGrid + strip both carry hole 18).
    expect(within(grid).getAllByText("18").length).toBeGreaterThan(0);
  });

  it("a flagged hole is marked on the review grid", async () => {
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "singles_match",
        a: [{ playerId: 1, ch: 0, scored: {} }],
        b: [{ playerId: 2, ch: 0, scored: {} }],
        flaggedHole: 7,
      }),
    );
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId("review-toggle-500"));
      await flush();
    });
    // The flagged hole's cell in the strip carries the ⚑ marker.
    const grid = screen.getByTestId("review-grid-500");
    expect(within(grid).getByText("⚑")).toBeInTheDocument();
  });
});

// ── D: match-card polish is presentation-only ────────────────────────────────
describe("match scorecard — functional polish (D)", () => {
  it("renders stroke dots above the number and the counting arrow inline — no engine change", async () => {
    // Singles, P1 off 18 vs P2 off 0 → P1 gets 1 match stroke on every hole
    // (SI 1..18). Enter hole-1 grosses so the hole resolves.
    mocks.loadMatch.mockResolvedValue(
      makeLoaded({
        format: "four_ball_match",
        a: [{ playerId: 1, ch: 18, scored: { 1: 5 } }, { playerId: 2, ch: 0, scored: { 1: 9 } }],
        b: [{ playerId: 3, ch: 0, scored: { 1: 6 } }, { playerId: 4, ch: 0, scored: { 1: 7 } }],
      }),
    );
    await renderPage();

    // Dots row above the stepper carries P1's one stroke on hole 1 (SI 1).
    const dots = within(screen.getByTestId("player-1")).getByTestId("player-1-dots");
    expect(dots.childElementCount).toBe(1);
    // The stepper (reused) is present below the dots.
    expect(within(screen.getByTestId("player-1")).getByTestId("ball-1-plus")).toBeInTheDocument();
    // P1 net 4 (5−1) beats B best 6 → A wins hole 1, and P1 is the counting ball.
    expect(screen.getByTestId("hole-outcome-500")).toHaveTextContent("USA wins the hole");
    expect(screen.getByTestId("player-1-counting")).toBeInTheDocument();
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────
function range(lo: number, hi: number): number[] {
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}
function fill(n: number, v: number): Record<number, number> {
  return Object.fromEntries(range(1, n).map((h) => [h, v]));
}
function winMap(aWins: number[], bWins: number[], halves: number[]): { a: Record<number, number>; b: Record<number, number> } {
  const a: Record<number, number> = {};
  const b: Record<number, number> = {};
  for (const h of aWins) { a[h] = 4; b[h] = 5; }
  for (const h of bWins) { a[h] = 5; b[h] = 4; }
  for (const h of halves) { a[h] = 4; b[h] = 4; }
  return { a, b };
}
