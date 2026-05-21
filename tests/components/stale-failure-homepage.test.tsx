// @vitest-environment jsdom
/**
 * Phase E — homepage integration tests for the stale-failure prompt.
 *
 * Verifies the on-mount check + sessionStorage suppress behavior +
 * Retry/Forget/Dismiss paths against a fake Supabase + pre-populated
 * write-queue.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import HomePage from "@/app/page";
import { resetWriteQueueForTesting } from "@/lib/writeQueue";

const QUEUE_KEY = "gobs:write-queue:v1";
const SUPPRESS_KEY = "gobs:stale-failure-dismissed";

function makeTerminalItem(overrides: Partial<{
  id: string;
  round_id: number;
  round_player_id: number;
  hole_number: number;
  strokes: number;
  player_name: string;
  hole_label: string;
  round_date: string | null;
  enqueued_at: number;
}> = {}) {
  return {
    id: overrides.id ?? "item-" + Math.random().toString(36).slice(2),
    kind: "score_upsert" as const,
    payload: {
      round_id: overrides.round_id ?? 90,
      round_player_id: overrides.round_player_id ?? 553,
      hole_number: overrides.hole_number ?? 3,
      strokes: overrides.strokes ?? 5,
    },
    enqueued_at: overrides.enqueued_at ?? Date.now() - 3600_000,
    attempts: 8,
    last_attempt_at: Date.now() - 60_000,
    next_attempt_at: Date.now() + 120_000,
    state: "terminal_failure" as const,
    display: {
      player_name: overrides.player_name ?? "Wayne H",
      hole_label: overrides.hole_label ?? "Hole 3",
      round_date: overrides.round_date ?? "2026-05-11",
    },
  };
}

function seedQueue(items: ReturnType<typeof makeTerminalItem>[]) {
  globalThis.localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

async function flushMicrotasks(rounds = 30) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: new URL("http://localhost/"),
    writable: true,
  });
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  resetWriteQueueForTesting();
  fakeRef.current = new FakeSupabase(buildSeed());
});

afterEach(() => {
  cleanup();
  resetWriteQueueForTesting();
  vi.useRealTimers();
});

describe("Homepage stale-failure prompt — appearance", () => {
  it("does NOT show the dialog when the queue is empty", async () => {
    render(<HomePage />);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(screen.queryByText(/still need(?:s)? to sync/i)).not.toBeInTheDocument();
  });

  it("shows the dialog when terminal items exist for the current session", async () => {
    seedQueue([
      makeTerminalItem({ id: "a", hole_number: 3, player_name: "Wayne H", hole_label: "Hole 3" }),
      makeTerminalItem({ id: "b", hole_number: 7, player_name: "Kevin I", hole_label: "Hole 7", strokes: 4 }),
    ]);
    render(<HomePage />);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(
      screen.getByText(/2 scores from your last round still need to sync/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hole 3 — Wayne H/)).toBeInTheDocument();
    expect(screen.getByText(/Hole 7 — Kevin I/)).toBeInTheDocument();
  });

  it("suppresses the dialog when sessionStorage flag is set", async () => {
    seedQueue([makeTerminalItem()]);
    globalThis.sessionStorage.setItem(SUPPRESS_KEY, "1");
    render(<HomePage />);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(screen.queryByText(/still need(?:s)? to sync/i)).not.toBeInTheDocument();
  });
});

describe("Homepage stale-failure prompt — Retry path", () => {
  it("Retry success → dialog closes, items synced to DB", async () => {
    vi.useFakeTimers();
    seedQueue([makeTerminalItem({ id: "a" })]);
    render(<HomePage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText(/still need(?:s)? to sync/i)).toBeInTheDocument();

    // Network is fine — the fake will accept the upsert.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    // Advance through the hail-mary stagger (~100ms per item + microtasks).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(screen.queryByText(/still need(?:s)? to sync/i)).not.toBeInTheDocument();
    const dbScores = fakeRef.current.data.scores.filter(
      s => s.round_player_id === 553 && s.hole_number === 3,
    );
    expect(dbScores).toHaveLength(1);
    expect(dbScores[0].strokes).toBe(5);
  });

  it("Retry failure → escalates to second-attempt dialog", async () => {
    vi.useFakeTimers();
    seedQueue([makeTerminalItem({ id: "a" })]);
    fakeRef.current.setOptions({
      failWrite: op => op.type === "upsert" && op.table === "scores",
    });
    render(<HomePage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(screen.getByText(/Still couldn't sync/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forget" })).toBeInTheDocument();
  });
});

describe("Homepage stale-failure prompt — Forget path", () => {
  it("Forget opens confirmation; confirm calls queue.forget with user_forget_stale", async () => {
    vi.useFakeTimers();
    const { captureMessage } = await import("@sentry/nextjs");
    const captureSpy = vi.mocked(captureMessage);
    captureSpy.mockClear();

    seedQueue([makeTerminalItem({ id: "a" })]);
    render(<HomePage />);
    await act(async () => {
      await flushMicrotasks();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    });
    expect(
      screen.getByText("Permanently delete these unsaved scores?"),
    ).toBeInTheDocument();

    // DangerModal's 1.5s delay before confirm enables.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    // Now two "Forget" buttons exist (the dialog's + the DangerModal's
    // confirm). The DangerModal is appended after the dialog, so the
    // last match is the confirm button.
    await act(async () => {
      const forgetButtons = screen.getAllByRole("button", { name: "Forget" });
      fireEvent.click(forgetButtons[forgetButtons.length - 1]);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    // Dialog closes.
    expect(screen.queryByText(/still need(?:s)? to sync/i)).not.toBeInTheDocument();
    // Sentry got the user_forget_stale event.
    const forgetCalls = captureSpy.mock.calls.filter(
      c => c[0] === "writeQueue.forget",
    );
    expect(forgetCalls.length).toBeGreaterThanOrEqual(1);
    // The Sentry reporter wraps captureMessage as `Sentry.captureMessage(msg,
    // { level: "warning", extra: ctx })` — so the reason field lives at
    // `.extra.reason`, not at the top level. The Sentry types union
    // `captureContext | severityLevel` for the second arg; in our case
    // it's always the object form.
    const ctx = forgetCalls[forgetCalls.length - 1][1] as { extra?: Record<string, unknown> };
    expect(ctx.extra).toEqual(
      expect.objectContaining({ reason: "user_forget_stale" }),
    );
    // Queue is empty.
    expect(globalThis.localStorage.getItem(QUEUE_KEY)).toEqual(
      expect.stringMatching(/^\[\]$/),
    );
  });
});

describe("Homepage stale-failure prompt — Dismissal", () => {
  it("Escape sets sessionStorage flag + closes dialog", async () => {
    seedQueue([makeTerminalItem()]);
    render(<HomePage />);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(screen.getByText(/still need(?:s)? to sync/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByText(/still need(?:s)? to sync/i)).not.toBeInTheDocument();
    expect(globalThis.sessionStorage.getItem(SUPPRESS_KEY)).toBe("1");
  });

  it("overlay click dismisses + sets sessionStorage flag", async () => {
    seedQueue([makeTerminalItem()]);
    render(<HomePage />);
    await act(async () => {
      await flushMicrotasks();
    });

    const overlay = screen.getByTestId("stale-failure-overlay");
    await act(async () => {
      fireEvent.click(overlay);
    });
    expect(screen.queryByText(/still need(?:s)? to sync/i)).not.toBeInTheDocument();
    expect(globalThis.sessionStorage.getItem(SUPPRESS_KEY)).toBe("1");
  });
});
