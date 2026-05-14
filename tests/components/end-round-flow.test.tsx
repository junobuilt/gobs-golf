// @vitest-environment jsdom
/**
 * Phase D — End-Round reconciliation flow integration tests.
 *
 * Pattern: vi.useFakeTimers() is on for the whole test. After render(),
 * advanceTimersByTimeAsync drives the load() useEffect to completion;
 * after that, getByText is reliable (no findByText polling, which fights
 * with fake timers). The DangerModal's 1.5s confirm-delay is also a
 * fake-time advance.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { FakeSupabase, buildSeed } from "./fake-supabase";

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
  useRouter: () => ({ push: routerPush }),
}));

import ScorecardPage from "@/app/round/[id]/scorecard/page";
import { resetWriteQueueForTesting } from "@/lib/writeQueue";

function seededFake() {
  const seed = buildSeed();
  seed.round_players[0].course_handicap = 9;
  seed.round_players[1].course_handicap = 11;
  seed.round_players[2].course_handicap = 6;
  return new FakeSupabase(seed);
}

async function flushMicrotasks(rounds = 6) {
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

/**
 * Render + drive load() to "Hole 1 visible" state. Use after fake timers
 * are active.
 */
async function renderAndLoad() {
  render(<ScorecardPage />);
  await settle(10);
  await settle(0);
}

/** Walk through "End round early" + DangerModal confirm. */
async function tapEndRoundAndConfirm() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /end round early/i }));
  });
  // DangerModal confirm button has a 1.5s delay.
  await settle(1600);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish Round" }));
  });
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: new URL("http://localhost/round/1/scorecard"),
    writable: true,
  });
  routerPush.mockReset();
  globalThis.localStorage.clear();
  resetWriteQueueForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  resetWriteQueueForTesting();
  vi.useRealTimers();
});

describe("End-Round flow — happy path", () => {
  it("empty queue → spinner phase resolves → finalize → router.push to summary", async () => {
    fakeRef.current = seededFake();
    await renderAndLoad();
    expect(screen.getByText("Hole 1")).toBeInTheDocument();

    await tapEndRoundAndConfirm();
    await settle(100);

    expect(routerPush).toHaveBeenCalledWith("/round/1/summary");
    expect(screen.queryByText("Finishing up…")).not.toBeInTheDocument();
    expect(screen.queryByText(/didn't sync/)).not.toBeInTheDocument();
  });
});

describe("End-Round flow — stuck writes", () => {
  async function setupAndStuck() {
    fakeRef.current = seededFake();
    fakeRef.current.setOptions({
      failWrite: op => op.type === "upsert" && op.table === "scores",
    });
    await renderAndLoad();
    // Enter a score for Alice on hole 1 — the upsert will fail.
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "+" })[0]);
    });
    await settle(50);
    // Confirm the write went to the queue but not the DB.
    expect(
      fakeRef.current.data.scores.filter(s => s.round_player_id === 101),
    ).toHaveLength(0);
    await tapEndRoundAndConfirm();
    // Drive the hail-mary timeout (30s) to completion.
    await settle(35_000);
  }

  it("persistent failure → first-attempt dialog with stuck item listed", async () => {
    await setupAndStuck();

    expect(screen.getByText("1 score didn't sync")).toBeInTheDocument();
    expect(screen.getByText(/Hole 1 — Alice A/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry sync" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip and finish" })).toBeInTheDocument();
    expect(screen.queryByText("Finishing up…")).not.toBeInTheDocument();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("Retry sync after first dialog — drain succeeds → finalize", async () => {
    await setupAndStuck();

    // Network recovers.
    fakeRef.current.setOptions({ failWrite: undefined });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry sync" }));
    });
    // After retryTerminal, items become pending and hail-mary processes
    // them. Drain succeeds and finalizeRound runs.
    await settle(100);

    expect(routerPush).toHaveBeenCalledWith("/round/1/summary");
    expect(screen.queryByText(/didn't sync/)).not.toBeInTheDocument();
    expect(
      fakeRef.current.data.scores.filter(s => s.round_player_id === 101),
    ).toHaveLength(1);
  });

  it("Retry sync fails again → second-attempt dialog appears", async () => {
    await setupAndStuck();

    // Failure persists.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry sync" }));
    });
    await settle(35_000);

    expect(screen.getByText("Still couldn't sync 1 score.")).toBeInTheDocument();
    expect(
      screen.getByText(/Try again later when you have better signal/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish anyway" })).toBeInTheDocument();
  });

  it("Skip and finish on first dialog → finalize without retry", async () => {
    await setupAndStuck();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skip and finish" }));
    });
    await settle();

    expect(routerPush).toHaveBeenCalledWith("/round/1/summary");
  });

  it("Finish anyway on second dialog → finalize, queue keeps the terminal item", async () => {
    await setupAndStuck();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry sync" }));
    });
    await settle(35_000);
    expect(screen.getByText("Still couldn't sync 1 score.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Finish anyway" }));
    });
    await settle();

    expect(routerPush).toHaveBeenCalledWith("/round/1/summary");
    const { getWriteQueue } = await import("@/lib/writeQueue");
    const terminalForRound = getWriteQueue()
      .getItems({ state: "terminal_failure" })
      .filter(i => i.payload.round_id === 1);
    expect(terminalForRound).toHaveLength(1);
  });

  it("Copy details writes formatted text to clipboard and shows 'Copied ✓'", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await setupAndStuck();

    // Go through Retry to land on second dialog.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry sync" }));
    });
    await settle(35_000);
    expect(screen.getByText("Still couldn't sync 1 score.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    });
    await settle();

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("GOBS Golf — failed sync");
    expect(copied).toContain("Hole 1, Alice A: 4 strokes");
    expect(screen.getByRole("button", { name: "Copied ✓" })).toBeInTheDocument();

    // After 2s, label reverts.
    await settle(2100);
    expect(screen.getByRole("button", { name: "Copy details" })).toBeInTheDocument();
  });
});
