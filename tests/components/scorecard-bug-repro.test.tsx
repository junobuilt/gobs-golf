// @vitest-environment jsdom
/**
 * Phase 3 scorecard bug-reproduction tests.
 *
 * Sequences A-E from the Bug 1 / Bug 2 investigation. Each test simulates the
 * exact user sequence Dad reported, using an in-memory FakeSupabase so we can
 * inspect both DOM state and "DB" state after each step.
 *
 * Failing test = bug reproduced. Passing test = mechanism ruled out (in jsdom;
 * iOS-Safari-specific touch behavior is not modeled here).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { FakeSupabase, buildSeed } from "./fake-supabase";

// vi.hoisted lets us reference the fake from the vi.mock factory below, which
// is hoisted to the top of the file before any imports execute.
const fakeRef = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: routerPush }),
}));

// Import AFTER mocks so the scorecard picks up the fakes.
import ScorecardPage from "@/app/round/[id]/scorecard/page";

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
});

afterEach(() => {
  cleanup();
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
  // Bonus — direct repro of the suspected Bug 1 failure mode that the
  // Sequence D success path doesn't exercise: write FAILS while user is
  // navigating away. Models the iOS "tab evicted mid-write" scenario.
  it("Sequence D' — write fails mid-flight + remount: confirms data-loss path", async () => {
    const utils = await renderAndWaitForLoad();

    // Configure the fake to fail any write into the scores table.
    // Phase A: setScore is now a single upsert; match both insert (legacy
    // code paths) and upsert (current).
    fakeRef.current.setOptions({
      failWrite: op =>
        (op.type === "insert" || op.type === "upsert") && op.table === "scores",
    });

    // Enter a score for Alice on hole 1. The optimistic state shows "4"
    // immediately but the INSERT fails silently (no try/catch in setScore).
    await tapPlus(0);
    await flushPendingPromises(50);

    // DOM shows the score (optimistic state wasn't rolled back).
    const plusButtonsBefore = screen.getAllByRole("button", { name: "+" });
    const aliceRowBefore = plusButtonsBefore[0].closest("div")!.parentElement!;
    expect(aliceRowBefore.textContent).toMatch(/4/);

    // DB has NO row for Alice hole 1 — the write failed.
    expect(
      fakeRef.current.data.scores.filter(s => s.round_player_id === 101 && s.hole_number === 1),
    ).toHaveLength(0);

    // User backgrounds the app → tab evicted → remount.
    utils.unmount();
    fakeRef.current.setOptions({ failWrite: undefined }); // future writes OK
    render(<ScorecardPage />);
    await screen.findByText("Hole 1");

    // Alice's hole-1 score is now MISSING — load() hydrated from empty DB,
    // overwriting the lost optimistic value. This is the Bug 1 mechanism.
    const plusButtonsAfter = screen.getAllByRole("button", { name: "+" });
    const aliceRowAfter = plusButtonsAfter[0].closest("div")!.parentElement!;
    // Score area shows "—" not "4".
    expect(aliceRowAfter.textContent).toMatch(/—/);
    expect(aliceRowAfter.textContent).not.toMatch(/[^0-9]4[^0-9]/);
  });
});
