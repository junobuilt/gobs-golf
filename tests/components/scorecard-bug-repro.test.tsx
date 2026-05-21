// @vitest-environment jsdom
/**
 * Scorecard bug-reproduction tests.
 *
 * Sequences A-E: original Phase 3 repros (Bug 1 / Bug 2 mechanisms). All pass
 * with Phase A + Phase C wiring — happy paths are queue-transparent.
 * Sequence F: Phase C addition — failed write + unmount + remount → queue
 *             drains on next mount → DB has value. Demonstrates Bug 1 fix.
 * Sequence G: Phase C addition — 18 holes × 4 players entered rapid-fire with
 *             random failures sprinkled → all values eventually land in DB.
 *
 * Failing test = bug reproduced. Passing test = mechanism ruled out (in jsdom;
 * iOS-Safari-specific touch behavior is not modeled here).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { FakeSupabase, buildSeed } from "./fake-supabase";

// vi.hoisted lets us reference the fake from the vi.mock factory below, which
// is hoisted to the top of the file before any imports execute.
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
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/round/1/scorecard",
}));

// Import AFTER mocks so the scorecard picks up the fakes.
import ScorecardPage from "@/app/round/[id]/scorecard/page";
import { getWriteQueue, resetWriteQueueForTesting } from "@/lib/writeQueue";

/**
 * Render the scorecard and wait for load() to finish (Hole 1 header visible).
 * Players in the seed have correct course_handicap values pre-computed so the
 * LT1 self-heal doesn't fire spurious writes.
 */
async function renderAndWaitForLoad(seed = buildSeed()) {
  // Seed correct course_handicap to skip the LT1 self-heal writes.
  seed.round_players[0].course_handicap = 9; // Alice HI=10
  seed.round_players[1].course_handicap = 11; // Bob HI=12
  seed.round_players[2].course_handicap = 6; // Carol HI=8
  fakeRef.current = new FakeSupabase(seed);
  const utils = render(<ScorecardPage />);
  await screen.findByText("Hole 1");
  return utils;
}

/**
 * Tap "+" inside player N's row (0=Alice, 1=Bob, 2=Carol). First tap writes
 * par for the current hole.
 */
async function tapPlus(playerIndex: number) {
  const buttons = screen.getAllByRole("button", { name: "+" });
  await act(async () => {
    fireEvent.click(buttons[playerIndex]);
  });
}

async function tapNextHole() {
  const next = screen.getByRole("button", { name: /next hole/i });
  await act(async () => {
    fireEvent.click(next);
  });
}

async function tapBack() {
  const back = screen.getByRole("button", { name: /back/i });
  await act(async () => {
    fireEvent.click(back);
  });
}

async function flushPendingPromises(ms = 0) {
  await act(async () => {
    await new Promise(r => setTimeout(r, ms));
  });
}

beforeEach(() => {
  // Default window.location.search to empty (no team filter)
  Object.defineProperty(window, "location", {
    value: new URL("http://localhost/round/1/scorecard"),
    writable: true,
  });
  routerPush.mockReset();
  // Phase C: the write queue is a module-level singleton living across
  // mounts intentionally. Tests need a clean slate per case — clear
  // localStorage (the queue's persistence layer) and tear down the
  // singleton so the next getWriteQueue() builds fresh.
  globalThis.localStorage.clear();
  resetWriteQueueForTesting();
});

afterEach(() => {
  cleanup();
  resetWriteQueueForTesting();
});

describe("Scorecard — Phase 3 bug repro", () => {
  // ─────────────────────────────────────────────────────────────────────────
  it("Sequence A — basic persistence: hole 12 scores survive Next→Back", async () => {
    await renderAndWaitForLoad();

    // Enter Alice's score on each hole 1..12, navigating forward as we go.
    for (let h = 1; h <= 12; h++) {
      await tapPlus(0); // par-4 first tap → 4
      await flushPendingPromises(); // let DB writes flush
      if (h < 12) await tapNextHole();
    }

    expect(screen.getByText("Hole 12")).toBeInTheDocument();

    // Tap "Next Hole" then "← Back" — round-trip back to hole 12.
    await tapNextHole();
    expect(screen.getByText("Hole 13")).toBeInTheDocument();
    await tapBack();
    expect(screen.getByText("Hole 12")).toBeInTheDocument();

    // DB state: Alice (rpid 101) should have rows for holes 1..12, all strokes=4.
    const aliceScores = fakeRef.current.data.scores
      .filter(s => s.round_player_id === 101)
      .sort((a, b) => a.hole_number - b.hole_number);
    expect(aliceScores).toHaveLength(12);
    expect(aliceScores.map(s => s.hole_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(aliceScores.every(s => s.strokes === 4)).toBe(true);

    // DOM check: Alice's hole-12 score should display "4". Use a structural
    // check — the score sits between the −/+ buttons in Alice's row.
    const plusButtons = screen.getAllByRole("button", { name: "+" });
    const aliceRow = plusButtons[0].closest("div")!.parentElement!;
    expect(aliceRow.textContent).toMatch(/4/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  it("Sequence B — snap-back repro: + on hole 13 lands on 13, not 12", async () => {
    await renderAndWaitForLoad();

    // Get to hole 12 with a score entered.
    for (let h = 1; h <= 12; h++) {
      await tapPlus(0);
      await flushPendingPromises();
      if (h < 12) await tapNextHole();
    }

    expect(screen.getByText("Hole 12")).toBeInTheDocument();
    const aliceHole12Before = fakeRef.current.data.scores.find(
      s => s.round_player_id === 101 && s.hole_number === 12,
    );
    expect(aliceHole12Before?.strokes).toBe(4);

    // Tap Next Hole → expect hole 13 visible immediately.
    await tapNextHole();
    expect(screen.getByText("Hole 13")).toBeInTheDocument();

    // Immediately tap + on Alice's row — this is the "fast tap after nav"
    // case. The +/- closure should have captured the NEW currentHole=13.
    await tapPlus(0);
    await flushPendingPromises();

    // Still on hole 13.
    expect(screen.getByText("Hole 13")).toBeInTheDocument();

    // Alice's hole-13 score should now be 4 (first +/− tap writes par).
    const aliceHole13 = fakeRef.current.data.scores.find(
      s => s.round_player_id === 101 && s.hole_number === 13,
    );
    expect(aliceHole13?.strokes).toBe(4);

    // Hole-12 score should be UNCHANGED.
    const aliceHole12After = fakeRef.current.data.scores.find(
      s => s.round_player_id === 101 && s.hole_number === 12,
    );
    expect(aliceHole12After?.strokes).toBe(4);
  });

  // ─────────────────────────────────────────────────────────────────────────
  it("Sequence C — slow network: score persists when nav happens before write resolves", async () => {
    await renderAndWaitForLoad();
    fakeRef.current.setOptions({ writeDelayMs: 500 });

    // Enter a score on hole 1 for Alice; do NOT wait for write to settle.
    await act(async () => {
      const buttons = screen.getAllByRole("button", { name: "+" });
      fireEvent.click(buttons[0]);
    });

    // Local state is updated optimistically — display shows "4" already.
    // Immediately navigate to hole 2 without awaiting the in-flight write.
    await tapNextHole();
    expect(screen.getByText("Hole 2")).toBeInTheDocument();

    // Navigate back to hole 1.
    await tapBack();
    expect(screen.getByText("Hole 1")).toBeInTheDocument();

    // Wait for the slow write to flush.
    await flushPendingPromises(800);

    // DB now contains the score for hole 1.
    const aliceHole1 = fakeRef.current.data.scores.find(
      s => s.round_player_id === 101 && s.hole_number === 1,
    );
    expect(aliceHole1).toBeDefined();
    expect(aliceHole1!.strokes).toBe(4);

    // Local state preserved across the navigation.
    const plusButtons = screen.getAllByRole("button", { name: "+" });
    const aliceRow = plusButtons[0].closest("div")!.parentElement!;
    expect(aliceRow.textContent).toMatch(/4/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  it("Sequence D — mount/unmount cycle: scores hydrate from DB on remount", async () => {
    const utils = await renderAndWaitForLoad();

    // Enter scores on holes 1-3 for Alice.
    for (let h = 1; h <= 3; h++) {
      await tapPlus(0);
      await flushPendingPromises();
      if (h < 3) await tapNextHole();
    }

    // Confirm all 3 made it to the fake DB before unmount.
    expect(fakeRef.current.data.scores.filter(s => s.round_player_id === 101)).toHaveLength(3);

    // Unmount the component (simulates iOS tab eviction with completed writes).
    utils.unmount();

    // Re-render with the SAME fake instance — DB state is preserved.
    render(<ScorecardPage />);
    await screen.findByText("Hole 1");

    // The reloaded scorecard should pull scores from DB. Navigate to hole 3.
    await tapNextHole();
    await tapNextHole();
    expect(screen.getByText("Hole 3")).toBeInTheDocument();

    // Alice's hole-3 score should still show in DOM.
    const plusButtons = screen.getAllByRole("button", { name: "+" });
    const aliceRow = plusButtons[0].closest("div")!.parentElement!;
    expect(aliceRow.textContent).toMatch(/4/);

    // DB has the 3 scores.
    expect(
      fakeRef.current.data.scores
        .filter(s => s.round_player_id === 101)
        .map(s => s.hole_number)
        .sort((a, b) => a - b),
    ).toEqual([1, 2, 3]);
  });

  // ─────────────────────────────────────────────────────────────────────────
  it("Sequence E — concurrent multi-player writes land correctly", async () => {
    await renderAndWaitForLoad();

    // Tap + on all 3 players in rapid succession on hole 1.
    const buttons = screen.getAllByRole("button", { name: "+" });
    await act(async () => {
      fireEvent.click(buttons[0]);
      fireEvent.click(buttons[1]);
      fireEvent.click(buttons[2]);
    });

    // Wait for all DB writes to flush.
    await flushPendingPromises(50);

    // All 3 players should have a hole-1 score of 4 in the DB.
    const hole1Scores = fakeRef.current.data.scores
      .filter(s => s.hole_number === 1)
      .sort((a, b) => a.round_player_id - b.round_player_id);
    expect(hole1Scores).toHaveLength(3);
    expect(hole1Scores.map(s => s.round_player_id)).toEqual([101, 102, 103]);
    expect(hole1Scores.every(s => s.strokes === 4)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Sequence F — Phase C Bug 1 fix demonstration.
  //
  // Previously (Phase 3 Sequence D'): write fails → unmount → remount →
  // load() rehydrates from empty DB → score lost. With the queue wired
  // (Phase C), the optimistic write is durable: it sits in localStorage
  // through the unmount, and on the next mount load() drains the queue
  // before rehydrating. The write retries against the now-recovered
  // network, lands in the DB, and the user sees the score they entered.
  it("Sequence F — failed write + unmount + remount: queue drains on next mount", async () => {
    const utils = await renderAndWaitForLoad();

    // Force every score upsert to fail.
    fakeRef.current.setOptions({
      failWrite: op => op.type === "upsert" && op.table === "scores",
    });

    // Enter a score for Alice on hole 1.
    await tapPlus(0);
    await flushPendingPromises(50);

    // Optimistic state: UI shows score even though the upsert failed.
    const plusButtonsMid = screen.getAllByRole("button", { name: "+" });
    const aliceRowMid = plusButtonsMid[0].closest("div")!.parentElement!;
    expect(aliceRowMid.textContent).toMatch(/4/);

    // DB has no row for Alice hole 1 — the write failed and the queue is
    // holding the item for retry.
    expect(
      fakeRef.current.data.scores.filter(s => s.round_player_id === 101 && s.hole_number === 1),
    ).toHaveLength(0);

    // Simulate tab eviction → background → reopen.
    utils.unmount();

    // Network is now recovered.
    fakeRef.current.setOptions({ failWrite: undefined });

    // Remount. load() drains the queue before rehydrating from DB. The
    // item's backoff is 1s into the future at this point, so load()'s
    // drain respects it (D10 — normal drains honor next_attempt_at). To
    // keep the test deterministic without 30+ seconds of real-time wait
    // for the backstop interval, simulate the eventual auto-drain
    // (backstop / online / visibilitychange) by force-firing with
    // ignoreBackoff. In production this happens within 30 seconds via
    // the backstop or sooner via visibilitychange when the user returns
    // to the tab. The Bug 1 fix is that the item is durable across the
    // remount — when it eventually drains, the DB is consistent.
    render(<ScorecardPage />);
    await screen.findByText("Hole 1");
    await flushPendingPromises(50);
    await act(async () => {
      await getWriteQueue().drain({ ignoreBackoff: true });
    });

    // DB now has the score — the queue's retry succeeded and persisted it.
    const aliceScores = fakeRef.current.data.scores.filter(
      s => s.round_player_id === 101 && s.hole_number === 1,
    );
    expect(aliceScores).toHaveLength(1);
    expect(aliceScores[0].strokes).toBe(4);

    // DOM still shows the score (via DB rehydrate after successful drain).
    const plusButtonsAfter = screen.getAllByRole("button", { name: "+" });
    const aliceRowAfter = plusButtonsAfter[0].closest("div")!.parentElement!;
    expect(aliceRowAfter.textContent).toMatch(/4/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Sequence G — Phase C resilience demo.
  //
  // 18 holes × 4 players entered rapid-fire with every other upsert failing.
  // After clearing the failure injection and advancing through the retry
  // backoff windows, every score must have landed exactly once in the DB.
  // No duplicates (the unique constraint + upsert idempotency); no losses
  // (the queue retains failed items and retries forever during the round).
  it("Sequence G — 18 holes × 4 players with random failures, all land", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(0);

    // Extend the seed to 4 players.
    const seed = buildSeed();
    seed.round_players[0].course_handicap = 9; // Alice HI=10
    seed.round_players[1].course_handicap = 11; // Bob HI=12
    seed.round_players[2].course_handicap = 6; // Carol HI=8
    seed.round_players.push({
      id: 104,
      round_id: 1,
      player_id: 204,
      tee_id: 1,
      team_number: 1,
      course_handicap: 9,
    });
    seed.players.push({
      id: 204,
      full_name: "Dan D",
      display_name: "Dan D",
      handicap_index: 9,
      preferred_tee_id: 1,
    });
    fakeRef.current = new FakeSupabase(seed);
    resetWriteQueueForTesting();

    // Fail every other upsert (deterministic via call index).
    fakeRef.current.setOptions({
      failWrite: (op, idx) =>
        op.type === "upsert" && op.table === "scores" && idx % 2 === 0,
    });

    render(<ScorecardPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // findByText with fake timers is unreliable — drive the load directly.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    // Sanity: rendered scorecard, players visible.
    expect(screen.getByText("Hole 1")).toBeInTheDocument();

    // Tap + once per player per hole, navigating after each hole.
    for (let h = 1; h <= 18; h++) {
      for (let p = 0; p < 4; p++) {
        const buttons = screen.getAllByRole("button", { name: "+" });
        await act(async () => {
          fireEvent.click(buttons[p]);
        });
        // Let the enqueue + drain microtasks settle.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
      }
      if (h < 18) {
        const next = screen.getByRole("button", { name: /next hole/i });
        await act(async () => {
          fireEvent.click(next);
        });
      }
    }

    // Disable failure injection so retries succeed.
    fakeRef.current.setOptions({ failWrite: undefined });

    // Advance through backoff windows: schedule cumulates to ~241s through
    // attempt 8 (1+2+4+8+16+30+60+120). Hammer 10s steps for 5 minutes
    // of fake time to cover any item that landed in steady-state 120s.
    for (let i = 0; i < 35; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }

    // All 72 (player, hole) combinations should be in the DB exactly once.
    const dbScores = fakeRef.current.data.scores;
    expect(dbScores).toHaveLength(72);
    const keys = new Set(dbScores.map(s => `${s.round_player_id}:${s.hole_number}`));
    expect(keys.size).toBe(72);
    // Every score was a first-tap "par" (4).
    expect(dbScores.every(s => s.strokes === 4)).toBe(true);

    vi.useRealTimers();
  }, 30_000);
});
